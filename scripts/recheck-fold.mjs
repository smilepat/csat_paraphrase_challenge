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

// ── 재개방된 자리 승인 ──────────────────────────────────────
// recheck → mine 을 돌리면 반려된 자리에 새 후보가 raw 로 들어온다. 그 후보는
// 이미 현재 기준을 통과한 것들이므로 여기서 바로 승인한다. 골드 스텁만 남긴다 —
// 빈칸 (A)/(B) 가 곧 정답이라 사람이 정답 쌍을 채워야 나갈 수 있다.
if (process.argv.includes("--approve-new")) {
  const { rows: raws } = await db.execute({
    sql: `SELECT id, origin, gold, stimulus_text s FROM pc_tasks
          WHERE type=2 AND direction='fold' AND review_status='raw'`,
    args: [],
  })
  const ok = []
  const hold = []
  for (const r of raws) {
    const gold = JSON.parse(String(r.gold ?? "null"))
    const filled = Array.isArray(gold) && gold.length > 0 && !/\([AB]\)/.test(gold[0]?.text ?? "")
    const pass = String(r.origin) === "gold" ? filled : isFoldable(String(r.s))
    ;(pass ? ok : hold).push(String(r.id))
  }
  console.log(`\n재개방 후보 ${raws.length}건 → 승인 ${ok.length}건 · 보류(골드 미기입) ${hold.length}건`)
  for (let i = 0; i < ok.length; i += 100) {
    const c = ok.slice(i, i + 100)
    await db.execute({
      sql: `UPDATE pc_tasks SET review_status='approved', updated_at=datetime('now')
            WHERE id IN (${c.map(() => "?").join(",")})`,
      args: c,
    })
  }
}

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
}

if (process.argv.some((a) => a === "--apply" || a === "--approve-new")) {
  const st = await db.execute(
    `SELECT type, direction, review_status, count(*) c FROM pc_tasks
     GROUP BY 1,2,3 ORDER BY 1,2,3`,
  )
  console.log(
    "현황:",
    st.rows.map((r) => `유형${r.type}${r.direction ? "/" + r.direction : ""}/${r.review_status}=${r.c}`).join(" "),
  )
}
