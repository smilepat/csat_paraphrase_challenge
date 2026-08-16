#!/usr/bin/env node
// ============================================================
// 옛 설계의 유형 1 반려분에 사유를 적는다.
//   npm run tasks:legacy1 [-- --apply] [-- --local]
//
// 왜 지우지 않나: `유형1 rejected 108` 이라는 숫자는 "검수자가 108건을 걸러냈다"
// 로 읽힌다. 사실은 다르다 — **설계를 바꿔서 통째로 폐기한 것**이다(§29).
// 문장 전체를 주고 낱말을 하나씩 바꾸게 하던 방식이 유형 1 이 재려는 것과
// 달라서 구 단위로 다시 만들었고, 그때 옛 문항이 전부 반려로 남았다.
//
// 지우는 쪽도 생각했지만 두 가지가 걸린다.
//   ① 되돌릴 수 없다. 사유를 적는 것은 되돌릴 수 있다.
//   ② `pc_attempts` 가 참조하는 1건은 어차피 못 지운다. 107건만 지우면
//      "왜 하나만 남았나" 라는 새 수수께끼가 생긴다.
//
// 숫자가 오해를 부르는 것이 문제이지 행이 존재하는 것이 문제가 아니다.
// 그러니 행마다 사유를 적어 검수 화면에서 바로 보이게 한다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()
const local = process.argv.includes("--local")
const apply = process.argv.includes("--apply")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const NOTE =
  "옛 설계(문장 전체 → 낱말 치환)로 만든 문항입니다. " +
  "유형 1 을 구 단위로 재설계하면서 폐기했습니다(HANDOFF §29). " +
  "검수자가 개별 판단으로 반려한 것이 아닙니다."

// 옛 설계의 표식: 자극이 **문장**이다. 새 설계의 자극은 구라서 짧고 마침표가 없다.
// 낱말 수로 가른다 — 새 설계는 audit1 에서 6낱말 이하만 통과시킨다.
const { rows } = await db.execute({
  sql: `SELECT id, stimulus_text s, notes FROM pc_tasks
        WHERE type=1 AND review_status='rejected' ORDER BY id`,
  args: [],
})

const legacy = rows.filter((r) => String(r.s).trim().split(/\s+/).length > 6)
const other = rows.length - legacy.length

console.log(`[legacy1] target=${url}`)
console.log(`  유형1 반려 ${rows.length}건 → 옛 설계로 보이는 것 ${legacy.length}건 · 그 외 ${other}건`)
console.log(`  이미 사유가 적힌 것: ${legacy.filter((r) => String(r.notes ?? "").includes("옛 설계")).length}건`)

console.log("\n── 표본 3건 ──")
for (const r of legacy.slice(0, 3)) {
  console.log(`  «${String(r.s).replace(/\s+/g, " ").slice(0, 95)}»`)
}

if (!apply) {
  console.log("\n(--apply 를 붙이면 사유를 적습니다)")
  process.exit(0)
}

let n = 0
for (const r of legacy) {
  const res = await db.execute({
    sql: "UPDATE pc_tasks SET notes=?, updated_at=datetime('now') WHERE id=? AND review_status='rejected'",
    args: [NOTE, String(r.id)],
  })
  n += res.rowsAffected
}
console.log(`\n사유 기재 ${n}건`)
