#!/usr/bin/env node
// ============================================================
// 프로덕션 문항을 로컬로 받아 온다.  npm run tasks:pull [-- --apply]
//
// tasks:sync 의 반대 방향이다. 왜 필요한가:
//
//   검수·재판정은 프로덕션에서 돌린 적이 많고(§35 §40 §43), 채굴은 로컬에서
//   돌린다. 그래서 두 DB 가 **양방향으로** 갈라진다. 실측(2026-08-18):
//   로컬에만 22건 · 프로덕션에만 72건 · 상태 불일치 31건.
//
//   이 상태로 tasks:sync 를 돌리면 로컬의 낡은 판정이 프로덕션의 새 판정을
//   덮는다. 특히 **사람이 보려고 raw 로 되돌려 둔 자리**가 지워진다.
//
// 그래서 이어서 하기 전에 이걸 먼저 돌린다. 프로덕션이 정본이다 —
// 사람이 누른 승인과 두 번째 판정이 거기에만 있다.
//
// 로컬에만 있는 행은 **지우지 않는다.** 아직 안 올린 채굴 결과일 수 있고,
// 지우면 그 자리의 반려 기록까지 날아간다. 세어서 알려 주기만 한다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()

const apply = process.argv.includes("--apply")
const url = process.env.TURSO_DATABASE_URL?.trim()
if (!url) {
  console.error("TURSO_DATABASE_URL 이 없습니다 — 받아 올 곳이 없습니다.")
  process.exit(1)
}

const local = createClient({ url: "file:./local.db" })
const remote = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, ""),
})

// 스키마가 갈라져도 멈추지 않게 양쪽에 다 있는 열만 옮긴다.
const cols = async (db) =>
  (await db.execute("SELECT name FROM pragma_table_info('pc_tasks')")).rows.map((r) => String(r.name))
const [lc, rc] = await Promise.all([cols(local), cols(remote)])
const shared = rc.filter((c) => lc.includes(c))
const onlyRemoteCols = rc.filter((c) => !lc.includes(c))
if (onlyRemoteCols.length) console.warn(`⚠ 로컬에 없는 열은 건너뜁니다: ${onlyRemoteCols.join(", ")}`)

const [rrows, lrows] = await Promise.all([
  remote.execute(`SELECT ${shared.join(", ")} FROM pc_tasks`),
  local.execute("SELECT id, review_status, stimulus_text, updated_at FROM pc_tasks"),
])
const L = new Map(lrows.rows.map((r) => [String(r.id), r]))

const added = []
const changed = []
const same = []
for (const r of rrows.rows) {
  const id = String(r.id)
  const l = L.get(id)
  if (!l) { added.push(id); continue }
  if (l.review_status !== r.review_status || l.stimulus_text !== r.stimulus_text) {
    changed.push(`${id}  ${l.review_status} -> ${r.review_status}`)
  } else same.push(id)
}
const onlyLocal = [...L.keys()].filter((id) => !rrows.rows.some((r) => String(r.id) === id))

console.log(`[pull] ${url}`)
console.log(`프로덕션 ${rrows.rows.length}건 · 로컬 ${L.size}건`)
console.log(`  새로 받음 ${added.length} · 내용 바뀜 ${changed.length} · 그대로 ${same.length}`)
console.log(`  로컬에만 있는 것 ${onlyLocal.length}건 (건드리지 않습니다)`)
for (const c of changed.slice(0, 20)) console.log(`    ${c}`)
if (changed.length > 20) console.log(`    ... 그 외 ${changed.length - 20}건`)

if (!apply) {
  console.log("\n미리보기입니다. 실제로 받으려면 --apply")
  process.exit(0)
}

const ph = shared.map(() => "?").join(", ")
const setList = shared.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(", ")
let n = 0
for (const r of rrows.rows) {
  await local.execute({
    sql: `INSERT INTO pc_tasks (${shared.join(", ")}) VALUES (${ph})
          ON CONFLICT(id) DO UPDATE SET ${setList}`,
    args: shared.map((c) => r[c] ?? null),
  })
  n++
}
console.log(`\n로컬에 ${n}건 반영했습니다.`)

const st = await local.execute(
  "SELECT type, review_status, count(*) c FROM pc_tasks GROUP BY 1,2 ORDER BY 1,2",
)
console.log("로컬 현황:", st.rows.map((r) => `유형${r.type}/${r.review_status}=${r.c}`).join(" "))
