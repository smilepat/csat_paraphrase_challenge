#!/usr/bin/env node
// ============================================================
// 유형 3 검수 결과 적용.  npm run tasks:review3 [-- --apply] [-- --local]
//
// 30건을 사람이 전수로 읽고 판정한 결과다. 자동화하지 않은 이유:
// "되받는 이름이 **직전 문장**을 가리키는가"는 의미 판단이고, 채굴기의 기본값이
// 틀렸을 때 그대로 승인하면 **제대로 표시한 학생이 오답 처리된다.**
// 유형 1 처럼 규칙으로 거를 수 있는 문제가 아니다.
//
// 반려 사유는 크게 넷:
//   ① 선행사가 직전 문장이 아니다(더 앞에 있다) — 학생이 맞혀도 틀리게 된다
//   ② 되받기가 아니다 — 새 화제를 여는 정관사구
//   ③ 자기 자신을 가리킨다 — 자극이 정답 범위 안에 있다
//   ④ 범위에 빈칸 마커·배점 표시가 섞였다
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()
const local = process.argv.includes("--local")
const apply = process.argv.includes("--apply")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

/** 반려 목록과 사유. 여기 없는 유형 3 태스크는 승인한다. */
const REJECT = {
  "CSAT_B_2014_34#t3-01": "선행사가 더 앞이다 — 직전 문장은 원숭이 예시이고 '이 의도적 오류'는 그 앞의 설명을 받는다",
  "CSAT_B_2014_34#t3-02": "'The evolutionary benefits' 는 앞 문장이 아니라 현상 자체를 가리킨다",
  "CSAT_EVEN_2017_34#t3-01": "정답 범위에 빈칸이 들어 있다(‘have come .’)",
  "CSAT_EVEN_2018_21#t3-01": "'The purpose' 는 직전 문장(‘동시에 던지고 받기 어렵다’)을 되받지 않는다",
  "CSAT_EVEN_2018_33#t3-02": "'The essential argument' 는 문단 전체를 받는다 — 직전 한 문장이 아니다",
  "CSAT_EVEN_2018_34#t3-01": "자극이 정답 범위 안에 있다(자기 자신을 가리킨다)",
  "CSAT_EVEN_2019_20#t3-01": "직전 문장이 인용문이라 'The concept' 의 선행사가 아니다",
  "CSAT_EVEN_2019_32#t3-02": "정답 범위에 빈칸이 들어 있다(‘the way .’)",
  "CSAT_EVEN_2022_21#t3-01": "정답 범위가 배점 표시 '[3점]' 에서 시작한다",
  "CSAT_EVEN_2022_23#t3-01": "직전 문장에 이미 'these various elements' 가 있다 — 진짜 선행사는 더 앞이다",
  "CSAT_EVEN_2022_40#t3-02": "'The other view' 는 되받기가 아니라 **새 관점을 여는** 표현이다",
}

// ⚠ 이 스크립트의 기본값은 **"목록에 없으면 승인"** 이다. 2026-08-14 의 30건에는
// 맞았지만, 그 뒤 §40 이 두 판정이 갈린 문항을 raw 로 되돌려 두기 시작했다.
// 그대로 돌리면 사람이 보려고 세워 둔 자리를 통째로 승인한다. 그래서 뺀다.
const { rows } = await db.execute({
  sql: `SELECT id FROM pc_tasks
        WHERE type=3 AND review_status='raw'
          AND COALESCE(notes,'') NOT LIKE '%확인 필요%'
        ORDER BY id`,
  args: [],
})
const heldCount = (await db.execute({
  sql: "SELECT count(*) c FROM pc_tasks WHERE type=3 AND review_status='raw' AND COALESCE(notes,'') LIKE '%확인 필요%'",
  args: [],
})).rows[0].c
if (heldCount) console.log(`사람 확인 대기 ${heldCount}건은 이 스크립트가 건드리지 않습니다 (§40)\n`)

const reject = rows.map((r) => String(r.id)).filter((id) => REJECT[id])
const approve = rows.map((r) => String(r.id)).filter((id) => !REJECT[id])

console.log(`[review3] target=${url}`)
console.log(`대기 ${rows.length}건 → 승인 ${approve.length} · 반려 ${reject.length}${apply ? "" : "  (미리보기)"}\n`)
for (const id of reject) console.log(`  반려 ${id}\n        ${REJECT[id]}`)

const unknown = Object.keys(REJECT).filter((id) => !rows.some((r) => String(r.id) === id))
if (unknown.length) console.warn(`\n⚠ 목록에 있으나 대기열에 없는 것: ${unknown.join(", ")}`)

if (apply) {
  for (const [ids, status] of [[approve, "approved"], [reject, "rejected"]]) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      if (!chunk.length) continue
      await db.execute({
        sql: `UPDATE pc_tasks SET review_status=?, updated_at=datetime('now')
              WHERE review_status='raw' AND id IN (${chunk.map(() => "?").join(",")})`,
        args: [status, ...chunk],
      })
    }
  }
  const st = await db.execute(
    "SELECT type, review_status, count(*) c FROM pc_tasks GROUP BY 1,2 ORDER BY 1,2",
  )
  console.log("\n현황:", st.rows.map((r) => `유형${r.type}/${r.review_status}=${r.c}`).join(" "))
}
