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

// ⚠ 모르는 인자는 **실행하지 않는다.** 이 스크립트에는 미리보기가 없어서
// `--help` 같은 것을 붙여 보는 것만으로 프로덕션이 바뀐다. 실제로 그렇게
// `--help` 를 붙여 돌린 한 번에 사람 검수 대기 4건이 덮였다(§44).
const KNOWN = ["--reset", "--apply", "--force"]
const unknown = process.argv.slice(2).filter((a) => !KNOWN.includes(a))
if (unknown.length) {
  console.error(`모르는 인자입니다: ${unknown.join(" ")}`)
  console.error(`쓸 수 있는 것: ${KNOWN.join(" ")}  (인자 없이 돌리면 미리보기)`)
  process.exit(2)
}
// 기본값은 미리보기다. 사람 판단을 옮기는 일이라 손이 미끄러지면 되돌리기 어렵다.
const apply = process.argv.includes("--apply")
const force = process.argv.includes("--force")

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

// ============================================================
// 옮기기 전 두 가지를 확인한다. 둘 다 실제로 사고가 났던 자리다(§44).
// ============================================================

// ① 로컬이 프로덕션보다 낡았으면 옮기지 않는다.
//    검수·재판정은 프로덕션에서 돌린 적이 많아 프로덕션에만 있는 판단이 있다.
//    낡은 로컬을 밀어 넣으면 그 판단이 조용히 뒤집힌다. 먼저 tasks:pull.
const remoteIds = (await remote.execute("SELECT id, updated_at FROM pc_tasks")).rows
const localIds = new Map(
  (await local.execute("SELECT id, updated_at FROM pc_tasks")).rows.map((r) => [String(r.id), String(r.updated_at)]),
)
const missing = remoteIds.filter((r) => !localIds.has(String(r.id)))
const newer = remoteIds.filter((r) => {
  const l = localIds.get(String(r.id))
  return l && String(r.updated_at) > l
})
if ((missing.length || newer.length) && !force) {
  console.error(
    `\n중단합니다 — 로컬이 프로덕션보다 낡았습니다.\n` +
      `  프로덕션에만 있는 문항 ${missing.length}건 · 프로덕션이 더 최근인 문항 ${newer.length}건\n\n` +
      `  npm run tasks:pull -- --apply   로 먼저 받아 오세요.\n` +
      `  (그래도 밀어 넣어야 한다면 --force — 프로덕션의 판단이 사라집니다)`,
  )
  process.exit(3)
}

// ② 사람이 보려고 세워 둔 자리는 기계가 덮지 않는다.
//    두 판정이 갈려 raw 로 되돌린 문항이다(§40). 로컬에는 그 사실이 없어서
//    로컬 판정을 밀어 넣으면 대기열 자체가 사라진다.
const held = new Set(
  (await remote.execute(
    "SELECT id FROM pc_tasks WHERE review_status='raw' AND notes LIKE '%확인 필요%'",
  )).rows.map((r) => String(r.id)),
)

const { rows } = await local.execute(
  "SELECT id, review_status FROM pc_tasks WHERE review_status <> 'raw'",
)
const targets = rows.filter((r) => !held.has(String(r.id)))
const skipped = rows.length - targets.length

console.log(`로컬 검수본 ${rows.length}건을 ${url} 로 옮깁니다`)
if (skipped) console.log(`  사람 확인 대기 ${skipped}건은 건드리지 않습니다`)
if (!apply) {
  console.log("\n미리보기입니다. 실제로 옮기려면 --apply")
  process.exit(0)
}

let n = 0
for (let i = 0; i < targets.length; i += 100) {
  const chunk = targets.slice(i, i + 100)
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
