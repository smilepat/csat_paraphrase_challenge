#!/usr/bin/env node
// ============================================================
// 사람 확인 대기열 복구.  npm run tasks:restore-queue [-- --apply]
//
// §40 은 두 판정이 갈린 문항을 지우지 않고 raw 로 되돌려 사람 앞에 놓는다.
// 그런데 그 표시는 notes 에만 있고 review_status 는 다른 스크립트가 언제든
// 덮을 수 있다. 실제로 2026-08-18 에 tasks:sync 한 번으로 4건이 덮였다(§44).
//
// 그래서 이 스크립트는 **notes 를 진실로 보고 상태를 되돌린다.**
//   notes 에 '확인 필요' 가 있는데 review_status 가 raw 가 아니면 → raw
//
// 사람이 실제로 판정한 것은 notes 에서 그 표시를 지우면 된다. 표시가 남아
// 있는 한 이 스크립트를 몇 번 돌려도 결과는 같다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()

const KNOWN = ["--apply", "--local"]
const unknown = process.argv.slice(2).filter((a) => !KNOWN.includes(a))
if (unknown.length) {
  console.error(`모르는 인자입니다: ${unknown.join(" ")}  (쓸 수 있는 것: ${KNOWN.join(" ")})`)
  process.exit(2)
}
const apply = process.argv.includes("--apply")
const useLocal = process.argv.includes("--local")

const url = (!useLocal && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = useLocal ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute(
  `SELECT id, review_status, updated_at FROM pc_tasks
   WHERE COALESCE(notes,'') LIKE '%확인 필요%' AND review_status <> 'raw'
   ORDER BY id`,
)

console.log(`[restore-queue] ${url}`)
if (!rows.length) {
  console.log("덮인 문항이 없습니다 — 대기열이 온전합니다.")
  process.exit(0)
}
console.log(`덮인 문항 ${rows.length}건:`)
for (const r of rows) console.log(`  ${r.id}  ${r.review_status} -> raw   (덮인 시각 ${r.updated_at})`)

if (!apply) {
  console.log("\n미리보기입니다. 되돌리려면 --apply")
  process.exit(0)
}

let n = 0
for (const r of rows) {
  const res = await db.execute({
    sql: "UPDATE pc_tasks SET review_status='raw', updated_at=datetime('now') WHERE id=?",
    args: [String(r.id)],
  })
  n += res.rowsAffected
}
console.log(`\n${n}건을 대기열로 되돌렸습니다.`)

const st = await db.execute(
  "SELECT count(*) c FROM pc_tasks WHERE COALESCE(notes,'') LIKE '%확인 필요%' AND review_status='raw'",
)
console.log(`사람 확인 대기: ${st.rows[0].c}건`)
