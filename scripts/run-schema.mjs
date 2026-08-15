#!/usr/bin/env node
// 스키마 적용. env 없으면 file:./local.db 에 적용한다.
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

// ⚠ 이 스크립트만 loadEnv 를 안 부르고 있었다. 그래서 셸에 TURSO_* 가 없으면
// **조용히 local.db 에 적용**되고, 정작 원격에는 테이블이 안 생긴다.
// "스키마는 OK 인데 다음 스크립트가 no such table 로 죽는" 상황이 그렇게 나온다.
// 다른 스크립트 15개는 전부 loadEnv 를 부른다 — 여기만 예외였다.
loadEnv()

const here = dirname(fileURLToPath(import.meta.url))

// --local 은 .env.local 의 TURSO 설정을 무시하고 개발용 파일 DB 를 쓴다.
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const client = authToken ? createClient({ url, authToken }) : createClient({ url })

const files = readdirSync(here)
  .filter((f) => /^\d{3}-.*\.sql$/.test(f))
  .sort()

console.log(`[schema] target=${url}`)

for (const f of files) {
  const sql = readFileSync(join(here, f), "utf8")
  // 주석 줄을 걷어내고 세미콜론 단위로 나눈다(이 스키마엔 트리거·함수가 없다).
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)

  for (const stmt of statements) {
    await client.execute(stmt)
  }
  console.log(`[schema] ${f} → ${statements.length} statements OK`)
}

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pc_%' ORDER BY name",
)
console.log(`[schema] 테이블 ${tables.rows.length}개:`, tables.rows.map((r) => r.name).join(", "))
