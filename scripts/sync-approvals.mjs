#!/usr/bin/env node
// ============================================================
// 로컬에서 한 검수 결과를 프로덕션에 옮긴다.  npm run tasks:sync
//
// 승인은 사람의 판단이라 **한 번만** 해야 한다. 두 DB 에서 따로 누르면
// 두 벌의 판단이 생기고 어느 쪽이 맞는지 알 수 없게 된다.
//
// ⚠ 채굴 규칙을 고쳤다면 순서가 있다:
//     1) 기계적으로 승인한 것을 raw 로 되돌린다(--reset)
//     2) npm run tasks:mine 으로 새 내용을 덮는다
//     3) 다시 승인하고 이 스크립트로 옮긴다
//   채굴기는 검수본을 건드리지 않으므로, 이 순서를 건너뛰면 **옛 내용이 승인된 채
//   남는다.** 실제로 그렇게 잘린 자극이 프로덕션에 올라갔었다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()

const url = process.env.TURSO_DATABASE_URL?.trim()
if (!url) {
  console.error("TURSO_DATABASE_URL 이 없습니다 — 옮길 대상이 없습니다.")
  process.exit(1)
}
const local = createClient({ url: "file:./local.db" })
const remote = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, ""),
})

if (process.argv.includes("--reset")) {
  for (const [name, db] of [["local", local], ["remote", remote]]) {
    const r = await db.execute(
      "UPDATE pc_tasks SET review_status='raw' WHERE type=2 AND origin<>'gold' AND review_status='approved'",
    )
    console.log(`${name}: 기계 승인 ${r.rowsAffected}건을 raw 로 되돌렸습니다`)
  }
  process.exit(0)
}

const { rows } = await local.execute(
  "SELECT id, review_status FROM pc_tasks WHERE review_status <> 'raw'",
)
console.log(`로컬 검수본 ${rows.length}건을 ${url} 로 옮깁니다`)

let n = 0
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100)
  for (const r of chunk) {
    const res = await remote.execute({
      sql: "UPDATE pc_tasks SET review_status=?, updated_at=datetime('now') WHERE id=? AND review_status='raw'",
      args: [String(r.review_status), String(r.id)],
    })
    n += res.rowsAffected
  }
}
console.log(`반영 ${n}건`)

const s = await remote.execute(
  "SELECT type, review_status, count(*) c FROM pc_tasks GROUP BY 1,2 ORDER BY 1,2",
)
console.log("프로덕션 현황:", s.rows.map((r) => `유형${r.type}/${r.review_status}=${r.c}`).join(" "))
