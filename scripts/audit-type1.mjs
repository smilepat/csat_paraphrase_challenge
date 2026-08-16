#!/usr/bin/env node
// ============================================================
// 유형 1 태스크 자동 점검.  npm run tasks:audit1 [-- --local]
//
// 237건을 사람이 다 볼 수는 없다. 걸릴 만한 것을 먼저 뽑아 그것만 눈으로 본다.
// 지문 검수(audit.ts)와 같은 취지이고, 통과한 것은 일괄 승인해도 위험이 작다.
//
//   --apply  통과분을 승인하고 걸린 것은 반려한다.
//
// 걸리는 것들(실제 표본): 빈칸 마커로 시작하는 조각 "(B) , the new generations…",
// 문장이 아니라 선택지 목록 "① necessity of parental intervention…",
// 고유명사만 바꾸라고 하는 것 "Horace, Petrarch, Shakespeare…".
// 전부 "다르게 표현" 과제가 성립하지 않는 것들이다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute({
  sql: "SELECT id, stimulus_text s, avoid_words a FROM pc_tasks WHERE type=1 AND review_status='raw' ORDER BY id",
  args: [],
})
console.log(`[audit1] target=${url} · 유형 1 raw ${rows.length}건\n`)

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const flagged = []

for (const r of rows) {
  const s = String(r.s).replace(/\s+/g, " ")
  const avoid = JSON.parse(String(r.a ?? "[]"))
  const bad = []

  if (/[가-힣]/.test(s)) bad.push("한글")
  if (/\(\s*[AB]\s*\)/.test(s)) bad.push("빈칸표시")
  if (s.length > 260) bad.push(`김 ${s.length}`)
  if (s.length < 60) bad.push(`짧음 ${s.length}`)
  if (avoid.length < 3) bad.push(`대상어 ${avoid.length}개`)

  // 대상 낱말이 자극에 실제로 있어야 한다(대소문자·굴절은 무시)
  const missing = avoid.filter((w) => !new RegExp(esc(w), "i").test(s))
  if (missing.length) bad.push(`자극에 없음: ${missing.join(",")}`)

  // 고유명사만 바꾸라고 하면 "다르게 표현"이 아니라 이름 바꾸기가 된다
  const propers = avoid.filter((w) => new RegExp(`\\b${esc(w[0].toUpperCase() + w.slice(1))}\\b`).test(s))
  if (propers.length >= avoid.length) bad.push("고유명사 위주")

  if (bad.length) flagged.push({ id: String(r.id), s, bad, avoid })
}

console.log(`걸린 것 ${flagged.length}건 / 통과 ${rows.length - flagged.length}건`)
for (const f of flagged.slice(0, 15)) {
  console.log(`\n  [${f.bad.join(" · ")}] ${f.id}`)
  console.log(`     «${f.s.slice(0, 110)}»`)
  console.log(`     대상: ${f.avoid.join(", ")}`)
}
if (flagged.length > 15) console.log(`\n  … 외 ${flagged.length - 15}건`)

if (process.argv.includes("--apply")) {
  const flaggedIds = new Set(flagged.map((f) => f.id))
  const passIds = rows.map((r) => String(r.id)).filter((id) => !flaggedIds.has(id))
  let approved = 0
  let rejected = 0
  for (const [ids, status] of [
    [passIds, "approved"],
    [[...flaggedIds], "rejected"],
  ]) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const res = await db.execute({
        sql: `UPDATE pc_tasks SET review_status=?, updated_at=datetime('now')
              WHERE review_status='raw' AND id IN (${chunk.map(() => "?").join(",")})`,
        args: [status, ...chunk],
      })
      if (status === "approved") approved += res.rowsAffected
      else rejected += res.rowsAffected
    }
  }
  console.log(`\n승인 ${approved}건 · 반려 ${rejected}건`)
  const st = await db.execute(
    "SELECT type, review_status, count(*) c FROM pc_tasks GROUP BY 1,2 ORDER BY 1,2",
  )
  console.log("현황:", st.rows.map((r) => `유형${r.type}/${r.review_status}=${r.c}`).join(" "))
}

console.log("\n── 통과분 무작위 표본 6건 ──")
const pass = rows.filter((r) => !flagged.some((f) => f.id === String(r.id)))
const step = Math.max(1, Math.floor(pass.length / 6))
for (let i = 0; i < pass.length && i < step * 6; i += step) {
  const r = pass[i]
  console.log(`\n  «${String(r.s).replace(/\s+/g, " ").slice(0, 118)}»`)
  console.log(`     대상: ${JSON.parse(String(r.a ?? "[]")).join(", ")}`)
}
