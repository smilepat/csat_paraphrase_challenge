#!/usr/bin/env node
// ============================================================
// pc_tasks 무결성 검사.  npm run tasks:verify
//
// 오프셋은 지문 본문에 붙어 있으므로 **지문이 수정되면 조용히 어긋난다.**
// 학생에게 엉뚱한 구간을 보여주는 사고를 막는 마지막 관문이라
// 실패하면 종료 코드 1 로 끝난다(CI 에서 그대로 쓸 수 있다).
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()

// --local 은 .env.local 의 TURSO 설정을 무시하고 개발용 파일 DB 를 쓴다.
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute(`
  SELECT t.*, p.body
  FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
  ORDER BY t.id
`)

console.log(`[verify] target=${url} · 태스크 ${rows.length}건`)

const problems = []
const push = (t, msg) => problems.push(`${t.id}  ${msg}`)

for (const t of rows) {
  const body = t.body

  // 1) 오프셋이 본문과 일치하는가 — 가장 중요한 검사
  if (body.slice(t.stimulus_start, t.stimulus_end) !== t.stimulus_text) {
    push(t, `자극 오프셋 불일치: DB="${t.stimulus_text.slice(0, 40)}" 본문="${body.slice(t.stimulus_start, t.stimulus_end).slice(0, 40)}"`)
  }

  // 2) 범위가 본문 안에 있는가
  for (const [name, a, b] of [
    ["context", t.context_start, t.context_end],
    ["stimulus", t.stimulus_start, t.stimulus_end],
    ["answer", t.answer_start, t.answer_end],
  ]) {
    if (a === null || b === null) continue
    if (a < 0 || b > body.length || a >= b) push(t, `${name} 범위 이상 (${a},${b}) body=${body.length}`)
  }

  // 3) 자극은 문맥 안에 있어야 한다 — 학생이 볼 수 없는 것을 조작할 수는 없다
  if (t.stimulus_start < t.context_start || t.stimulus_end > t.context_end) {
    push(t, `자극이 문맥 밖 (자극 ${t.stimulus_start}-${t.stimulus_end} / 문맥 ${t.context_start}-${t.context_end})`)
  }

  // 4) 한글이 섞이면 자극으로 못 쓴다(발문·배점 표시가 본문에 섞여 있는 지문이 있다)
  if (/[가-힣ㄱ-ㆎ]/.test(t.stimulus_text)) push(t, "자극에 한글 포함")

  // 5) 유형별 필수 필드
  if (t.type === 1 && !t.avoid_words) push(t, "유형1 인데 avoid_words 없음")
  if (t.type === 2 && !t.target_form) push(t, "유형2 인데 target_form 없음")
  if (t.type === 3) {
    if (t.answer_start === null) push(t, "유형3 인데 answer 범위 없음")
    else if (t.answer_end > t.stimulus_start) push(t, "유형3 의 되받는 범위가 자극보다 뒤에 있음")
  }
}

// ── 현황 ────────────────────────────────────────────────────
const stat = await db.execute(
  "SELECT type, review_status, origin, count(*) n FROM pc_tasks GROUP BY 1,2,3 ORDER BY 1,2,3",
)
for (const r of stat.rows) {
  console.log(`  유형${r.type} ${String(r.review_status).padEnd(9)} ${String(r.origin).padEnd(6)} ${r.n}`)
}

const approved = await db.execute(
  "SELECT type, count(*) n FROM pc_tasks WHERE review_status='approved' GROUP BY 1",
)
const okTypes = new Set(approved.rows.map((r) => Number(r.type)))
console.log(`\n승인된 유형: ${[1, 2, 3].map((t) => `${t}${okTypes.has(t) ? "O" : "X"}`).join(" ")}`)

if (problems.length) {
  console.error(`\n[verify] 문제 ${problems.length}건`)
  for (const p of problems.slice(0, 30)) console.error("  " + p)
  if (problems.length > 30) console.error(`  … 외 ${problems.length - 30}건`)
  process.exit(1)
}
console.log("\n[verify] 이상 없음")
