#!/usr/bin/env node
// ============================================================
// 이미 승인된 유형 2 "묶기(fold)" 문항을 **현재 기준으로 다시 본다**.
//   npm run tasks:recheck-fold [-- --local] [-- --apply]
//
// 왜 따로 만드나: 승인은 한 번 하고 끝이지만 채굴 기준은 계속 좋아진다.
// 지금 승인돼 있는 fold 문항들은 "읽을 만한 문장 아무거나" 를 고르던 시절에
// 뽑힌 것이라, 관계절·삽입구·명령문이 섞여 있다. 그런 문장은 명사구 하나로
// 묶을 수가 없어서 **학생이 아무리 잘해도 좋은 답이 안 나온다.**
//
// 다시 채굴해 갈아끼울 수는 없다 — pc_attempts 가 task_id 를 참조하고 있어
// 삭제가 막힌다. 그래서 기준만 소급 적용해 반려한다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"
import { isFoldable } from "../lib/tasks/mine.ts"

loadEnv()
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute({
  sql: `SELECT id, stimulus_text s, origin FROM pc_tasks
        WHERE type=2 AND direction='fold' AND review_status='approved' ORDER BY id`,
  args: [],
})
console.log(`[recheck-fold] target=${url} · 승인된 묶기 ${rows.length}건\n`)

const fail = []
for (const r of rows) {
  // 골드(사람이 손으로 넣은 정답 쌍)는 기준의 대상이 아니다 — 사람이 이미 봤다.
  if (String(r.origin) === "gold") continue
  if (!isFoldable(String(r.s))) fail.push({ id: String(r.id), s: String(r.s) })
}

console.log(`기준 미달 ${fail.length}건 / 유지 ${rows.length - fail.length}건`)
for (const f of fail.slice(0, 12)) {
  console.log(`\n  «${f.s.replace(/\s+/g, " ").slice(0, 120)}»`)
}
if (fail.length > 12) console.log(`\n  … 외 ${fail.length - 12}건`)

if (process.argv.includes("--apply")) {
  const ids = fail.map((f) => f.id)
  let n = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const res = await db.execute({
      sql: `UPDATE pc_tasks SET review_status='rejected', updated_at=datetime('now')
            WHERE id IN (${chunk.map(() => "?").join(",")})`,
      args: chunk,
    })
    n += res.rowsAffected
  }
  console.log(`\n반려 ${n}건`)
  const st = await db.execute(
    `SELECT type, direction, review_status, count(*) c FROM pc_tasks
     GROUP BY 1,2,3 ORDER BY 1,2,3`,
  )
  console.log(
    "현황:",
    st.rows.map((r) => `유형${r.type}${r.direction ? "/" + r.direction : ""}/${r.review_status}=${r.c}`).join(" "),
  )
}
