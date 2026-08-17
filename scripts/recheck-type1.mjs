#!/usr/bin/env node
// ============================================================
// 승인된 유형 1 자극이 **구인가 조각인가**.
//   npm run tasks:recheck1 [--apply] [--local]
//
// 왜: 채굴기가 드문 낱말을 머리로 잡고 왼쪽으로만 확장했다. 그 낱말이 형용사면
// 머리 명사가 오른쪽에 남아 **조각**이 된다 — `doing multiple`(+things),
// `giving Apocalypse`(+Now), `chronologically eighty`(+years).
// 학생에게 문법적으로 성립하지 않는 것을 다시 쓰라고 시키는 셈이다.
// 고1 학생으로 직접 써 보다가 만났고, 재 보니 승인분의 33%가 뒤에 내용어를
// 달고 있었다(§43).
//
// 채굴기는 고쳤지만 **이미 승인된 것은 그대로 남는다.** recheck-fold 와 같은
// 방식으로 소급 적용한다: 조각을 반려 → 재채굴 → 새 후보 승인.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"
import { firstVerbLike } from "../lib/scoring/typed/structure.ts"

loadEnv()
const args = process.argv.slice(2)
const local = args.includes("--local")
const apply = args.includes("--apply")

const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

/** 이 낱말이 뒤따르면 구가 거기서 끝난 것이다(mine.ts 의 PHRASE_STOP 과 같은 취지). */
const STOP = new Set(`
and or but that which who whom whose where when while because although though if
to of in on at for with by from as than into onto upon within about over under
is are was were be been being am has have had do does did
can could may might will would shall should must not
a an the this these those its their his her our your my it they he she we you i
there here so then thus however moreover therefore
`.trim().split(/\s+/))

const BAD_TAIL = new Set(`
one ones other others more most less least better worse best worst
own same such very quite rather too also just even still ever never
`.trim().split(/\s+/))

const { rows } = await db.execute({
  sql: `SELECT t.id, t.stimulus_text s, t.stimulus_end, p.body
        FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
        WHERE t.type=1 AND t.review_status='approved' ORDER BY t.id`,
  args: [],
})

const bad = []
for (const r of rows) {
  const s = String(r.s).replace(/\s+/g, " ").trim()
  const tail = s.split(/\s+/).pop().toLowerCase()
  const why = []

  if (/ly$/.test(tail) || BAD_TAIL.has(tail)) why.push("부사·비교급으로 끝남")

  const after = String(r.body).slice(Number(r.stimulus_end)).match(/^\s+([A-Za-z][A-Za-z'-]*)/)
  if (after) {
    const w = after[1]
    if (!STOP.has(w.toLowerCase()) && !firstVerbLike(w)) why.push(`뒤에 «${w}» 가 남음`)
  }

  if (why.length) bad.push({ id: String(r.id), s, why: why.join(" · ") })
}

console.log(`[recheck1] target=${url} · 승인된 유형1 ${rows.length}건`)
console.log(`  조각으로 보이는 것 ${bad.length}건 (${((bad.length / rows.length) * 100).toFixed(0)}%)\n`)
for (const b of bad.slice(0, 15)) console.log(`  [${b.why}] «${b.s}»`)
if (bad.length > 15) console.log(`  … 외 ${bad.length - 15}건`)

if (!apply) {
  console.log("\n(--apply 를 붙이면 반려합니다. 그 뒤 tasks:mine → tasks:audit1 --apply)")
  process.exit(0)
}

let n = 0
const ids = bad.map((b) => b.id)
for (let i = 0; i < ids.length; i += 100) {
  const c = ids.slice(i, i + 100)
  const res = await db.execute({
    sql: `UPDATE pc_tasks SET review_status='rejected', updated_at=datetime('now'),
            notes = COALESCE(notes,'') || ' / 구가 아니라 조각 — 채굴기 수정 전(§43)'
          WHERE review_status='approved' AND id IN (${c.map(() => "?").join(",")})`,
    args: c,
  })
  n += res.rowsAffected
}
const st = await db.execute(
  "SELECT review_status, count(*) c FROM pc_tasks WHERE type=1 GROUP BY 1 ORDER BY 1",
)
console.log(`\n반려 ${n}건`)
console.log("유형1 현황:", st.rows.map((r) => `${r.review_status}=${r.c}`).join(" "))
console.log("\n다음: npm run tasks:mine   →   npm run tasks:audit1 -- --apply")
