#!/usr/bin/env node
// ============================================================
// 옛 진단명을 새 이름으로 옮긴다.  npm run tasks:rename-errors [-- --apply] [-- --local]
//
// §48 에서 화면의 말을 바꿨는데, 이미 쌓인 시도 기록에는 **옛 이름이 그대로**
// 남는다. "자주 나오는 실수" 는 이름으로 세므로 같은 실수가 옛 이름과 새 이름
// 둘로 갈려 잡히고, 학생 화면에는 이제 쓰지 않는 말이 나온다.
//
// 점수·판정은 건드리지 않는다. **이름만** 바꾼다.
//
// 표에 없는 이름은 그대로 둔다 — 모르는 값을 뭉개면 나중에 원인을 못 찾는다.
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

/** 옛 이름 → 새 이름. §48 의 표와 같은 내용이다. */
const RENAME = {
  "원문 단어를 아직 안 바꿈": "원문 표현 그대로",
  "비슷하지만 다른 말": "뜻이 달라짐",
  "절반만 맞는 말": "내용 일부 빠짐",
  "원문보다 크게 말한 것": "원문보다 넓은 뜻",
  "뜻은 맞는데 방향이 반대": "뜻이 반대",
  "구조를 바꾸지 않음": "문장 구조 그대로",
  "되받는 범위를 못 찾음": "가리키는 곳을 찾지 못함",
  "범위 경계가 어긋남": "선택 범위가 어긋남",
  "범위는 맞지만 이름이 어긋남": "범위는 맞지만 표현이 어긋남",
}

const url = (!useLocal && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = useLocal ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute(
  "SELECT error_name AS name, count(*) AS n FROM pc_attempts WHERE error_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC",
)

console.log(`[rename-errors] ${url}`)
if (!rows.length) {
  console.log("기록된 진단명이 없습니다.")
  process.exit(0)
}

let target = 0
for (const r of rows) {
  const name = String(r.name)
  const to = RENAME[name]
  console.log(`  ${String(r.n).padStart(3)}건  ${name}${to ? `  →  ${to}` : "  (그대로 둠)"}`)
  if (to) target += Number(r.n)
}
console.log(`바꿀 기록 ${target}건`)

if (!target) process.exit(0)
if (!apply) {
  console.log("\n미리보기입니다. 실제로 바꾸려면 --apply")
  process.exit(0)
}

let n = 0
for (const [from, to] of Object.entries(RENAME)) {
  const res = await db.execute({
    sql: "UPDATE pc_attempts SET error_name = ? WHERE error_name = ?",
    args: [to, from],
  })
  n += res.rowsAffected
}
console.log(`\n${n}건의 이름을 옮겼습니다.`)

const after = await db.execute(
  "SELECT error_name AS name, count(*) AS n FROM pc_attempts WHERE error_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC",
)
console.log("현황:", after.rows.map((r) => `${r.name}=${r.n}`).join(" · ") || "(없음)")
