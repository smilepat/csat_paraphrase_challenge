#!/usr/bin/env node
// ============================================================
// 유형 3 LLM 채굴 — 정규식이 못 잡는 "되받는 이름" 을 찾는다.
//   node scripts/mine-type3-llm.mjs [--limit N] [--dry] [--local] [--redo]
//
// 왜 필요한가: 정규식은 `This/These/Such/The + 껍데기 이름` 만 본다. 껍데기 이름은
// 손으로 적은 고정 목록이라 거기 없는 낱말(예: "this trade-off", "such a reversal")
// 은 영영 안 걸린다. 313편 전수 실측에서 정규식 상한이 24건/23편이었다.
//
// ⚠ **오프셋을 모델에게 묻지 않는다.** 모델이 세는 문자 위치는 거의 항상 틀린다.
//   원문 그대로의 인용문만 받고 위치는 이쪽에서 indexOf 로 찾는다. 인용이 원문과
//   한 글자라도 다르면 그 후보는 버린다 — 지어낸 것이기 때문이다.
//
// 결과는 전부 review_status='raw' · origin='llm' 이다. 검수를 거쳐야 학생에게 간다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv, callGemini, parseGeminiJson, logUsage } from "./_shared.mjs"
import { splitSummaryBlock, sentences } from "../lib/tasks/segment.ts"
import { CAPS } from "../lib/tasks/mine.ts"

loadEnv()
const args = process.argv.slice(2)
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity
const dry = args.includes("--dry")
const local = args.includes("--local")
const redo = args.includes("--redo")

const BATCH = 4 // 지문 4개. 지문이 길어서 5 를 넘기면 응답이 잘린다.

const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

// ── 대상 고르기 ─────────────────────────────────────────────
// 유형 3 문항이 상한에 못 미치는 지문만 본다. 이미 찬 지문에 더 넣어 봐야
// 한 지문이 문제 은행을 독차지할 뿐이다(정규식 채굴과 같은 방침).
const { rows: all } = await db.execute({
  sql: `SELECT p.id, p.body, count(t.id) n
        FROM pc_passages p
        LEFT JOIN pc_tasks t ON t.passage_id = p.id AND t.type = 3
             AND t.review_status <> 'rejected'
        GROUP BY p.id
        ORDER BY p.id`,
  args: [],
})
// --redo 가 아니면 LLM 채굴을 이미 돌린 지문은 건너뛴다(같은 지문에 돈을 두 번 쓰지 않는다)
const { rows: done } = await db.execute({
  sql: "SELECT DISTINCT passage_id id FROM pc_tasks WHERE type=3 AND origin='llm'",
  args: [],
})
const doneIds = new Set(done.map((r) => String(r.id)))

const targets = all
  .filter((r) => Number(r.n) < CAPS.type3)
  .filter((r) => redo || !doneIds.has(String(r.id)))
  .slice(0, limit === Infinity ? undefined : limit)

console.log(`[mine3-llm] target=${url}`)
console.log(
  `  전체 지문 ${all.length}편 · 유형3 이 상한(${CAPS.type3})에 못 미치는 지문 ${all.filter((r) => Number(r.n) < CAPS.type3).length}편` +
    ` · 이번 대상 ${targets.length}편${dry ? " (dry-run)" : ""}\n`,
)
if (!targets.length) process.exit(0)

const SYSTEM = `You analyse English reading passages for a Korean EFL exercise about
"encapsulation": a noun phrase that packages up something already said, so that the
writer can refer to it as one thing. Typical shapes are "this tendency", "such a
reversal", "the trade-off", "these two forces". You must quote the passage exactly.`

function buildPrompt(batch) {
  const items = batch
    .map((p, i) => `### PASSAGE ${i + 1} (id: ${p.id})\n${clean(p.body)}`)
    .join("\n\n")

  return `Find every ENCAPSULATING NOUN PHRASE in each passage below.

${items}

An encapsulating noun phrase:
- is a noun phrase that refers BACKWARD and packs up content stated EARLIER in the passage
- names that content as one thing, instead of repeating it
- usually begins with this / these / such / those / the

It is NOT encapsulation when the noun phrase:
- refers forward, or to something outside the passage
- names a concrete thing already named by the same word ("the thermometer" after "a thermometer")
- is the grammatical subject of the passage's very first sentence (nothing precedes it)
- introduces a NEW idea the passage has not stated yet, even if it sounds summarising
  ("the ability to recover quickly" when nothing before it mentioned recovering)

THE TEST: you must be able to DELETE the earlier text and put the noun phrase in its
place, and the sentence still says the same thing. If the noun phrase names something
the earlier text never said, it fails the test — omit it.

For EACH one you find, return:
- "id": the passage id exactly as given
- "expression": the encapsulating noun phrase, COPIED CHARACTER FOR CHARACTER from the
  passage. 2-6 words. Do not normalise spacing, quotes, dashes or capitalisation.
- "refersTo": the stretch of passage text it packs up, COPIED CHARACTER FOR CHARACTER,
  starting at the beginning of a sentence and ending at a sentence-final period.
  It must appear BEFORE the expression. One or two sentences.
  Choose the SMALLEST stretch that the noun phrase actually replaces. Do not include
  neighbouring sentences just because they are on the same topic.
- "packs": in Korean, max 25 characters, WHAT CONTENT the phrase packs up — name the
  content, not the fact that it summarises. Write "야간 학습이 집중된다는 믿음",
  not "이전 내용을 요약". If you cannot name it in Korean, omit the item.
- "confidence": "high" if it clearly passes THE TEST, "low" otherwise.

Both "expression" and "refersTo" must be exact substrings of the passage. If you cannot
copy them exactly, omit that item. Accuracy matters far more than quantity — return an
empty list for a passage rather than an approximate quote or a doubtful item.

Return ONLY a JSON array:
[{"id":"...","expression":"...","refersTo":"...","packs":"...","confidence":"high"}]`
}

/** 프롬프트에 넣을 때만 줄바꿈을 정리한다. 위치 계산은 **원문**으로 한다. */
function clean(body) {
  return body.replace(/\r\n/g, "\n")
}

// ── 검증 ────────────────────────────────────────────────────
// 모델이 준 인용을 원문에서 찾는다. 못 찾으면 지어낸 것이다.
//
// 원문은 줄바꿈이 문장 중간에 들어 있는데(수능 지문을 줄 단위로 받았다) 모델은
// 그것을 공백으로 바꿔서 답한다. 그래서 **공백을 무시한 채로** 찾은 다음,
// 원문 쪽의 실제 경계를 돌려준다. 그 외의 차이(낱말·구두점)는 허용하지 않는다.
function findLoose(body, quote) {
  const norm = (s) => s.replace(/\s+/g, " ")
  const target = norm(quote).trim()
  if (target.length < 3) return null

  // 원문 문자 → 공백 정규화 문자열에서의 위치를 대응시켜 둔다
  const map = []
  let flat = ""
  let prevSpace = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (/\s/.test(c)) {
      if (prevSpace) continue
      flat += " "
      map.push(i)
      prevSpace = true
    } else {
      flat += c
      map.push(i)
      prevSpace = false
    }
  }
  const at = flat.indexOf(target)
  if (at < 0) return null
  const start = map[at]
  const end = map[at + target.length - 1] + 1
  return { start, end }
}

const stats = { got: 0, lowConf: 0, noQuote: 0, notBefore: 0, inSummary: 0, dup: 0, tooLong: 0, oneWord: 0, kept: 0 }
const drafts = []

for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH)
  let parsed
  try {
    const raw = await callGemini(buildPrompt(batch), SYSTEM, { json: true, maxOutputTokens: 8192 })
    parsed = parseGeminiJson(raw)
  } catch (e) {
    console.warn(`  ⚠ 배치 ${i / BATCH + 1} 실패: ${String(e).slice(0, 120)}`)
    continue
  }
  if (!Array.isArray(parsed)) {
    console.warn(`  ⚠ 배치 ${i / BATCH + 1}: 배열이 아닌 응답`)
    continue
  }

  for (const item of parsed) {
    stats.got++
    const p = batch.find((b) => String(b.id) === String(item.id))
    if (!p) continue
    // 모델이 스스로 미심쩍다고 한 것은 받지 않는다. 검수 부담이 곧 비용이다.
    if (String(item.confidence ?? "").toLowerCase() !== "high") {
      stats.lowConf++
      continue
    }
    const body = String(p.body)
    const { passageEnd } = splitSummaryBlock(body)

    const expr = findLoose(body, String(item.expression ?? ""))
    const refs = findLoose(body, String(item.refersTo ?? ""))
    if (!expr || !refs) {
      stats.noQuote++
      continue
    }
    // 되받기는 **앞**을 받는다. 뒤를 가리키면 개념이 틀린 것이다.
    if (refs.end > expr.start) {
      stats.notBefore++
      continue
    }
    // 요약문 블록은 지문이 아니다
    if (expr.start >= passageEnd || refs.end > passageEnd) {
      stats.inSummary++
      continue
    }
    // 받는 범위가 지나치게 길면 "앞 내용 전체" 라 과제가 성립하지 않는다
    if (refs.end - refs.start > 420 || expr.end - expr.start > 60) {
      stats.tooLong++
      continue
    }
    // 한 낱말짜리("This")는 되받는 **이름**이 아니라 대명사다. 프롬프트에서 2~6낱말을
    // 요구해도 계속 섞여 나온다(24건 중 4건). 여기서 막는 편이 토큰이 덜 든다.
    if (body.slice(expr.start, expr.end).trim().split(/\s+/).length < 2) {
      stats.oneWord++
      continue
    }

    // 문맥은 되받는 표현이 든 문장과 그 앞 두 문장까지
    const sents = sentences(body).filter((s) => s.end <= passageEnd)
    const hostIdx = sents.findIndex((s) => s.start <= expr.start && expr.start < s.end)
    if (hostIdx < 1) {
      stats.notBefore++
      continue
    }
    const ctxStart = Math.min(refs.start, sents[Math.max(0, hostIdx - 2)].start)

    drafts.push({
      passageId: String(p.id),
      expr,
      refs,
      exprText: body.slice(expr.start, expr.end),
      refsText: body.slice(refs.start, refs.end),
      ctxStart,
      ctxEnd: sents[hostIdx].end,
      packs: String(item.packs ?? "").slice(0, 40),
    })
  }
  process.stdout.write(`\r  진행 ${Math.min(i + BATCH, targets.length)}/${targets.length}편`)
}
console.log("")

// ── 기존 문항과 겹치는 것 제거 ──────────────────────────────
// 정규식이 이미 잡은 자리를 LLM 이 다시 잡는 일이 흔하다. 같은 자리를 두 번
// 내보내면 학생이 같은 문제를 두 번 푼다.
const { rows: existing } = await db.execute({
  sql: "SELECT passage_id, stimulus_start FROM pc_tasks WHERE type=3",
  args: [],
})
const taken = new Set(existing.map((r) => `${r.passage_id}@${r.stimulus_start}`))
const perPassage = new Map()
const kept = []
for (const d of drafts) {
  const key = `${d.passageId}@${d.expr.start}`
  if (taken.has(key)) {
    stats.dup++
    continue
  }
  const n = perPassage.get(d.passageId) ?? 0
  if (n >= CAPS.type3) continue
  taken.add(key)
  perPassage.set(d.passageId, n + 1)
  kept.push(d)
}
stats.kept = kept.length

console.log(
  `\n받은 후보 ${stats.got} → 확신 낮음 ${stats.lowConf} · 인용 불일치 ${stats.noQuote} · 앞이 아님 ${stats.notBefore} · ` +
    `요약문 ${stats.inSummary} · 너무 긺 ${stats.tooLong} · 한 낱말 ${stats.oneWord} · 중복 ${stats.dup} → **남은 것 ${stats.kept}건 / ${perPassage.size}편**`,
)

console.log("\n── 표본 6건 ──")
const step = Math.max(1, Math.floor(kept.length / 6))
for (let i = 0; i < kept.length && i < step * 6; i += step) {
  const d = kept[i]
  console.log(`\n  [${d.passageId}] ${d.packs}`)
  console.log(`    되받는 이름: «${d.exprText.replace(/\s+/g, " ")}»`)
  console.log(`    받는 범위  : «${d.refsText.replace(/\s+/g, " ").slice(0, 150)}»`)
}

if (dry) {
  console.log("\n(dry-run — 저장하지 않았습니다)")
  process.exit(0)
}

// ── 적재 ────────────────────────────────────────────────────
let inserted = 0
const seq = new Map()
for (const d of kept) {
  const n = (seq.get(d.passageId) ?? 0) + 1
  seq.set(d.passageId, n)
  const id = `${d.passageId}#t3-llm-${String(n).padStart(2, "0")}`
  await db.execute({
    sql: `INSERT INTO pc_tasks
            (id, passage_id, type, direction, context_start, context_end,
             stimulus_start, stimulus_end, stimulus_text, target_form,
             answer_start, answer_end, avoid_words, gold, origin, review_status, notes, updated_at)
          VALUES (?,?,3,'span',?,?,?,?,?,NULL,?,?,NULL,NULL,'llm','raw',?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            context_start=excluded.context_start, context_end=excluded.context_end,
            stimulus_start=excluded.stimulus_start, stimulus_end=excluded.stimulus_end,
            stimulus_text=excluded.stimulus_text, answer_start=excluded.answer_start,
            answer_end=excluded.answer_end, notes=excluded.notes, updated_at=datetime('now')
          WHERE pc_tasks.review_status = 'raw'`,
    args: [
      id, d.passageId, d.ctxStart, d.ctxEnd,
      d.expr.start, d.expr.end, d.exprText,
      d.refs.start, d.refs.end,
      `LLM 채굴 — ${d.packs}. 받는 범위가 맞는지 확인할 것`,
    ],
  })
  inserted++
}

await logUsage(db, "mine3-llm", Math.ceil(targets.length / BATCH), targets.length)

const st = await db.execute(
  "SELECT origin, review_status, count(*) c FROM pc_tasks WHERE type=3 GROUP BY 1,2 ORDER BY 1,2",
)
console.log(`\n적재 ${inserted}건`)
console.log("유형3 현황:", st.rows.map((r) => `${r.origin}/${r.review_status}=${r.c}`).join(" "))
console.log("\n검수: npm run tasks:review3  또는  /admin/tasks?type=3&status=raw")
