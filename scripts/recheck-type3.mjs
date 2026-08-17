#!/usr/bin/env node
// ============================================================
// 승인된 유형 3 문항의 **두 번째 판정**.  npm run tasks:recheck3 [-- --apply] [-- --local]
//
// 왜 또 보나: 지금 승인된 55건은 판정기 **한 번**을 통과한 것이고 사람은 표본
// 6건만 봤다(§35). "독립 판정으로 걸렀다" 까지가 사실이고 그 이상은 아니었다.
// 정답 범위가 틀리면 **제대로 표시한 학생이 오답 처리된다** — 이 유형에서
// 가장 비싼 오류다.
//
// ⚠ 같은 질문을 다시 하는 것은 검증이 아니다. 첫 판정(audit-type3-llm.mjs)은
//   "이 주장이 맞는가" 를 물었다. 여기서는 **묻는 방식 자체를 바꾼다** —
//   후보를 보여 주지 않고 **범위를 직접 고르게 한 뒤**, 그 답이 저장된 범위와
//   겹치는지를 이쪽에서 센다. 모델이 무엇을 승인해야 하는지 모르는 채로 답한다.
//
// 두 판정이 엇갈린 것만 사람이 본다. 그것이 이 스크립트의 목적이다 —
// 55건을 다 보는 대신 몇 건만 보게 만드는 것.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv, callGemini, parseGeminiJson, logUsage } from "./_shared.mjs"
import { overlap, TYPE3 } from "../lib/scoring/typed/type3.ts"

loadEnv()
const args = process.argv.slice(2)
const local = args.includes("--local")
const apply = args.includes("--apply")
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity

const BATCH = 5

const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute({
  sql: `SELECT t.id, t.stimulus_text s, t.context_start, t.context_end,
               t.stimulus_start, t.answer_start, t.answer_end, p.body
        FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
        WHERE t.type=3 AND t.origin='llm' AND t.review_status='approved'
        ORDER BY t.id`,
  args: [],
})
const targets = rows.slice(0, limit === Infinity ? undefined : limit)
console.log(`[recheck3] target=${url} · 승인된 LLM 유형3 ${rows.length}건 → 이번 ${targets.length}건\n`)
if (!targets.length) process.exit(0)

const SYSTEM = `You are a careful reader of English expository prose. You will be shown a
passage excerpt and one noun phrase in it that refers back to something said earlier.
Your job is to quote the earlier text it refers to. You are not checking anyone's work.`

function buildPrompt(batch) {
  const items = batch
    .map((r, i) => {
      const body = String(r.body)
      // 문맥만 보여 준다. 저장된 정답 범위가 어디인지는 **알려 주지 않는다.**
      const from = Number(r.context_start)
      const to = Number(r.context_end)
      return `### ITEM ${i + 1} (id: ${r.id})
PASSAGE:
${body.slice(from, to).replace(/\s+/g, " ")}

PHRASE: «${String(r.s).replace(/\s+/g, " ")}»`
    })
    .join("\n\n")

  return `For each item, the PHRASE packs up something said earlier in the PASSAGE.

${items}

Quote the earlier stretch of the PASSAGE that the phrase packs up.

- "quote": copied CHARACTER FOR CHARACTER from the passage. Start at a sentence
  beginning and end at a sentence-final period. It must come BEFORE the phrase.
  Choose the SMALLEST stretch the phrase actually replaces.
- "refersBack": false if the phrase does NOT pack up earlier content at all — it opens a
  new idea, points forward, or just repeats a thing already named. Then "quote" is "".

Return ONLY a JSON array:
[{"id":"...","quote":"...","refersBack":true}]`
}

/** 공백을 무시하고 원문에서 인용 위치를 찾는다(mine-type3-llm 과 같은 규칙). */
function findLoose(body, quote) {
  const target = String(quote).replace(/\s+/g, " ").trim()
  if (target.length < 3) return null
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
  return { start: map[at], end: map[at + target.length - 1] + 1 }
}

const agree = []
const disagree = []
const denied = []
const unreadable = []

for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH)
  let parsed
  try {
    const raw = await callGemini(buildPrompt(batch), SYSTEM, { json: true, maxOutputTokens: 4096 })
    parsed = parseGeminiJson(raw)
  } catch (e) {
    console.warn(`\n  ⚠ 배치 ${Math.floor(i / BATCH) + 1} 실패: ${String(e).slice(0, 90)}`)
    continue
  }
  if (!Array.isArray(parsed)) continue

  for (const v of parsed) {
    const r = batch.find((b) => String(b.id) === String(v.id))
    if (!r) continue
    const body = String(r.body)
    const gold = { start: Number(r.answer_start), end: Number(r.answer_end) }
    const row = {
      id: String(r.id),
      s: String(r.s).replace(/\s+/g, " "),
      gold: body.slice(gold.start, gold.end).replace(/\s+/g, " "),
    }

    if (v.refersBack === false) {
      denied.push(row)
      continue
    }
    const found = findLoose(body, String(v.quote ?? ""))
    if (!found) {
      // 인용을 원문에서 못 찾으면 판정 자체를 믿을 수 없다. 사람에게 넘긴다.
      unreadable.push({ ...row, quote: String(v.quote ?? "").slice(0, 90) })
      continue
    }
    // 겹침으로 잰다. 채점기가 학생 답안을 재는 것과 **같은 자**를 쓴다 —
    // 다른 자를 쓰면 "판정은 통과인데 학생은 틀리는" 문항이 남는다.
    const iou = overlap(found, gold)
    const item = { ...row, iou, second: body.slice(found.start, found.end).replace(/\s+/g, " ") }
    if (iou >= TYPE3.hit) agree.push(item)
    else disagree.push(item)
  }
  process.stdout.write(`\r  진행 ${Math.min(i + BATCH, targets.length)}/${targets.length}건`)
}
console.log("")

const seen = agree.length + disagree.length + denied.length + unreadable.length
console.log(`\n두 판정이 **일치** ${agree.length}건 / 본 것 ${seen}건`)
console.log(`  엇갈림(범위가 다름)   ${disagree.length}건`)
console.log(`  되받기가 아니라고 함  ${denied.length}건`)
console.log(
  `  인용을 못 찾음        ${unreadable.length}건  ← 판정기가 실패한 것이지 문항에 대한 정보가 아니다(그대로 둔다)`,
)

console.log("\n── 엇갈린 것 (사람이 볼 목록) ──")
for (const d of [...denied, ...disagree].slice(0, 12)) {
  console.log(`\n  [${d.id}] «${d.s}»`)
  console.log(`    저장된 범위: «${d.gold.slice(0, 110)}»`)
  if (d.second) console.log(`    두 번째 판정: «${d.second.slice(0, 110)}»  (겹침 ${d.iou.toFixed(2)})`)
  else console.log(`    두 번째 판정: 되받기가 아니다`)
}
const rest = denied.length + disagree.length - 12
if (rest > 0) console.log(`\n  … 외 ${rest}건`)

if (!apply) {
  console.log("\n(--apply 를 붙이면 엇갈린 것을 raw 로 되돌려 검수 대기에 넣습니다)")
  process.exit(0)
}

// 지우지 않는다. **검수 대기로 되돌린다** — 판정 둘이 갈렸다는 것은
// "틀렸다" 가 아니라 "사람이 봐야 한다" 는 뜻이다.
//
// ⚠ `unreadable` 은 넣지 않는다. 그건 **판정기가 실패한 것**이지 이 문항에 대한
//   정보가 아니다. 정보 없음을 불일치처럼 다루면 근거 없이 문제은행만 줄어든다.
//   (실측 49건 중 5건이 그랬다 — 모델이 원문을 베끼지 않고 바꿔 썼다.)
const ids = [...denied, ...disagree].map((d) => d.id)
let n = 0
for (let i = 0; i < ids.length; i += 100) {
  const c = ids.slice(i, i + 100)
  const res = await db.execute({
    sql: `UPDATE pc_tasks SET review_status='raw', updated_at=datetime('now'),
            notes = COALESCE(notes,'') || ' / 두 번째 판정과 엇갈림 — 범위 확인 필요'
          WHERE review_status='approved' AND id IN (${c.map(() => "?").join(",")})`,
    args: c,
  })
  n += res.rowsAffected
}
await logUsage(db, "recheck3", Math.ceil(targets.length / BATCH), targets.length)

const st = await db.execute(
  "SELECT origin, review_status, count(*) c FROM pc_tasks WHERE type=3 GROUP BY 1,2 ORDER BY 1,2",
)
console.log(`\n검수 대기로 되돌림 ${n}건`)
console.log("유형3 현황:", st.rows.map((r) => `${r.origin}/${r.review_status}=${r.c}`).join(" "))
console.log("\n검수 화면: /admin/tasks?type=3&status=raw")
