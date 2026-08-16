#!/usr/bin/env node
// ============================================================
// LLM 이 채굴한 유형 3 문항 검수.  npm run tasks:audit3 [-- --apply] [-- --local]
//
// 100건을 사람이 다 볼 수는 없다. 그렇다고 일괄 승인하면 안 된다 —
// review-type3.mjs 가 경고한 그대로다: 정답 범위가 틀리면 **제대로 표시한 학생이
// 오답 처리된다.** 채점 기준이 틀린 문항은 없느니만 못하다.
//
// 그래서 두 단계로 거른다.
//   ① 기계 점검 — 규칙으로 잡히는 것(빈칸 마커·배점 표시·한정사·길이·자기참조)
//   ② 독립 판정 — **채굴 때와 다른 프롬프트**로 다시 묻는다. 채굴 프롬프트를
//      그대로 쓰면 같은 근거로 같은 답을 하므로 검증이 아니다. 여기서는
//      후보를 주고 **반증하게** 한다.
//
// 판정이 ok 인 것만 승인한다. 애매하면 반려한다 — 유형 3 은 공급이 목적이 아니라
// 정확한 정답 범위가 목적이다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv, callGemini, parseGeminiJson, logUsage } from "./_shared.mjs"

loadEnv()
const args = process.argv.slice(2)
const local = args.includes("--local")
const apply = args.includes("--apply")
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity

const BATCH = 6

const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute({
  sql: `SELECT t.id, t.stimulus_text s, t.stimulus_start, t.answer_start, t.answer_end,
               t.context_start, t.context_end, p.body
        FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
        WHERE t.type=3 AND t.origin='llm' AND t.review_status='raw'
        ORDER BY t.id`,
  args: [],
})
const targets = rows.slice(0, limit === Infinity ? undefined : limit)
console.log(`[audit3] target=${url} · LLM 채굴 유형3 raw ${rows.length}건 → 이번 ${targets.length}건\n`)
if (!targets.length) process.exit(0)

// ── ① 기계 점검 ─────────────────────────────────────────────
// 되받는 이름은 **한정된 명사구**다. 이 한정사로 시작하지 않으면 되받기가 아니다.
const DETERMINER = /^\s*(this|these|those|that|such|the|his|her|its|their|our)\b/i

const flagged = []
const clean = []
for (const r of targets) {
  const stim = String(r.s)
  const body = String(r.body)
  const gold = body.slice(Number(r.answer_start), Number(r.answer_end))
  const bad = []

  if (!DETERMINER.test(stim)) bad.push("한정사로 시작하지 않음")
  if (/[.!?]\s*\S/.test(stim)) bad.push("문장이 둘 이상")
  const words = stim.trim().split(/\s+/).length
  if (words < 2) bad.push("한 낱말")
  if (words > 8) bad.push(`${words}낱말로 긺`)

  // 빈칸 문항의 흔적. 정답 범위에 섞이면 학생이 맞힐 수 없다.
  if (/\(\s*[AB]\s*\)/.test(gold)) bad.push("정답 범위에 빈칸 표시")
  if (/\s\.(\s|$)/.test(gold)) bad.push("정답 범위에 빈칸 자리")
  if (/\[\s*\d\s*점\s*\]/.test(gold)) bad.push("정답 범위에 배점 표시")
  if (/[가-힣]/.test(gold) || /[가-힣]/.test(stim)) bad.push("한글")

  // 자기 자신을 가리키면 과제가 성립하지 않는다
  if (Number(r.answer_end) > Number(r.stimulus_start)) bad.push("정답 범위가 자극을 포함")
  if (Number(r.answer_end) <= Number(r.answer_start)) bad.push("정답 범위가 비었음")

  // 문맥 안에 정답 범위가 보여야 학생이 끌 수 있다
  if (Number(r.answer_start) < Number(r.context_start)) bad.push("정답 범위가 문맥 밖")

  if (bad.length) flagged.push({ id: String(r.id), s: stim, bad })
  else clean.push({ ...r, gold })
}
console.log(`① 기계 점검: 걸린 것 ${flagged.length}건 · 통과 ${clean.length}건`)
for (const f of flagged.slice(0, 8)) {
  console.log(`   [${f.bad.join(" · ")}] «${f.s.replace(/\s+/g, " ").slice(0, 70)}»`)
}
if (flagged.length > 8) console.log(`   … 외 ${flagged.length - 8}건`)

// ── ② 독립 판정 ─────────────────────────────────────────────
const SYSTEM = `You are checking someone else's work. A colleague claims that a noun phrase
in an English passage "encapsulates" (packs up) a specific earlier stretch of that passage.
Your job is to look for reasons the claim is WRONG. Approve only what clearly survives.`

function buildPrompt(batch) {
  const items = batch
    .map((r, i) => {
      const body = String(r.body)
      // 판정에 필요한 만큼만 보여 준다 — 지문 전체를 넣으면 배치가 잘린다
      const from = Math.max(0, Number(r.answer_start) - 200)
      const to = Math.min(body.length, Number(r.stimulus_start) + 200)
      return `### ITEM ${i + 1} (id: ${r.id})
PASSAGE EXCERPT:
${body.slice(from, to).replace(/\s+/g, " ")}

CLAIMED ENCAPSULATING PHRASE: «${String(r.s).replace(/\s+/g, " ")}»
CLAIMED EARLIER CONTENT IT PACKS UP: «${r.gold.replace(/\s+/g, " ")}»`
    })
    .join("\n\n")

  return `For each item, decide whether the claim holds.

${items}

Judge each item with ONE of:
- "ok" — the phrase does refer backward, and the claimed earlier content is what it packs
  up: not a neighbouring topic, not a larger stretch, not a smaller piece of it.
- "span_wrong" — the phrase IS encapsulating, but the claimed earlier content is the wrong
  stretch (too big, too small, or a different sentence).
- "not_encapsulation" — the phrase does not pack up earlier content at all. It opens a new
  idea, refers forward, or simply repeats a concrete thing already named.

Be strict. If you are unsure whether the claimed stretch is exactly right, answer
"span_wrong", not "ok". A wrong answer key is worse than one fewer exercise.

Also return "note": Korean, max 30 characters, your reason. For "ok" write what it packs.

Return ONLY a JSON array in the same order:
[{"id":"...","verdict":"ok","note":"..."}]`
}

const verdicts = new Map()
for (let i = 0; i < clean.length; i += BATCH) {
  const batch = clean.slice(i, i + BATCH)
  try {
    const raw = await callGemini(buildPrompt(batch), SYSTEM, { json: true, maxOutputTokens: 4096 })
    const parsed = parseGeminiJson(raw)
    if (Array.isArray(parsed)) {
      for (const v of parsed) verdicts.set(String(v.id), v)
    }
  } catch (e) {
    console.warn(`\n  ⚠ 배치 ${i / BATCH + 1} 실패: ${String(e).slice(0, 100)}`)
  }
  process.stdout.write(`\r② 독립 판정 ${Math.min(i + BATCH, clean.length)}/${clean.length}건`)
}
console.log("")

const tally = { ok: [], span_wrong: [], not_encapsulation: [], 판정없음: [] }
for (const r of clean) {
  const v = verdicts.get(String(r.id))
  const key = v && tally[v.verdict] ? v.verdict : "판정없음"
  tally[key].push({ ...r, note: v?.note ?? "" })
}
console.log(
  `   ok ${tally.ok.length} · 범위 틀림 ${tally.span_wrong.length} · ` +
    `되받기 아님 ${tally.not_encapsulation.length} · 판정 없음 ${tally.판정없음.length}`,
)

console.log("\n── 승인 대상 표본 6건 ──")
const step = Math.max(1, Math.floor(tally.ok.length / 6))
for (let i = 0; i < tally.ok.length && i < step * 6; i += step) {
  const r = tally.ok[i]
  console.log(`\n  [${r.id}] ${r.note}`)
  console.log(`    되받는 이름: «${String(r.s).replace(/\s+/g, " ")}»`)
  console.log(`    받는 범위  : «${r.gold.replace(/\s+/g, " ").slice(0, 130)}»`)
}

console.log("\n── 반려 표본 4건 ──")
for (const r of [...tally.span_wrong, ...tally.not_encapsulation].slice(0, 4)) {
  console.log(`\n  [${r.note}] «${String(r.s).replace(/\s+/g, " ").slice(0, 60)}»`)
  console.log(`    받는 범위: «${r.gold.replace(/\s+/g, " ").slice(0, 110)}»`)
}

if (!apply) {
  console.log("\n(--apply 를 붙이면 반영합니다)")
  process.exit(0)
}

// ── 반영 ────────────────────────────────────────────────────
async function setStatus(ids, status) {
  let n = 0
  for (let i = 0; i < ids.length; i += 100) {
    const c = ids.slice(i, i + 100)
    const res = await db.execute({
      sql: `UPDATE pc_tasks SET review_status=?, updated_at=datetime('now')
            WHERE review_status='raw' AND id IN (${c.map(() => "?").join(",")})`,
      args: [status, ...c],
    })
    n += res.rowsAffected
  }
  return n
}

// 승인하면서 판정 근거를 notes 에 남긴다. 검수 화면(/admin/tasks)에서 이 문항이
// **사람이 아니라 독립 판정기로** 통과했다는 것과 그 이유가 보여야 한다.
for (const r of tally.ok) {
  await db.execute({
    sql: "UPDATE pc_tasks SET notes=? WHERE id=?",
    args: [`LLM 채굴 + 독립 판정 통과 — ${r.note}`, String(r.id)],
  })
}
const approved = await setStatus(tally.ok.map((r) => String(r.id)), "approved")
const rejected = await setStatus(
  [
    ...flagged.map((f) => f.id),
    ...tally.span_wrong.map((r) => String(r.id)),
    ...tally.not_encapsulation.map((r) => String(r.id)),
    ...tally.판정없음.map((r) => String(r.id)),
  ],
  "rejected",
)
await logUsage(db, "audit3", Math.ceil(clean.length / BATCH), clean.length)

const st = await db.execute(
  "SELECT origin, review_status, count(*) c FROM pc_tasks WHERE type=3 GROUP BY 1,2 ORDER BY 1,2",
)
console.log(`\n승인 ${approved}건 · 반려 ${rejected}건`)
console.log("유형3 현황:", st.rows.map((r) => `${r.origin}/${r.review_status}=${r.c}`).join(" "))
