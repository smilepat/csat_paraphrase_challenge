#!/usr/bin/env node
// 검수 자동 점검 요약 — 승인 전에 어디를 봐야 하는지 알려준다.
//   npx vite-node scripts/audit-passages.mjs
import { readFileSync } from "node:fs"
import { createClient } from "@libsql/client"

const { auditPassage, auditSeverity } = await import("../lib/scoring/audit.ts")

const freq = JSON.parse(readFileSync("data/freq-rank.json", "utf8"))
const db = createClient({ url: process.env.TURSO_DATABASE_URL?.trim() || "file:./local.db" })

const { rows } = await db.execute(
  "SELECT id, body, propositions, model_answers, review_status FROM pc_passages WHERE propositions IS NOT NULL",
)

const tally = { clean: 0, warn: 0, error: 0 }
const msgs = {}
const worst = []

for (const r of rows) {
  const issues = auditPassage({
    body: String(r.body),
    propositions: JSON.parse(String(r.propositions)),
    modelAnswers: JSON.parse(String(r.model_answers)),
    freq,
  })
  const sev = auditSeverity(issues)
  tally[sev]++
  for (const i of issues) {
    const key = i.message.replace(/\d+/g, "N")
    msgs[key] = (msgs[key] || 0) + 1
  }
  if (sev !== "clean") worst.push({ id: r.id, n: issues.length, sev, first: issues[0].message })
}

console.log(`지문 ${rows.length}개 — 무경고 ${tally.clean} / 경고 ${tally.warn} / 오류 ${tally.error}`)
console.log("\n빈도 높은 지적:")
Object.entries(msgs)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([m, n]) => console.log(`  ${String(n).padStart(3)}  ${m.slice(0, 90)}`))

console.log("\n먼저 볼 지문 (지적 많은 순):")
worst.sort((a, b) => (a.sev === b.sev ? b.n - a.n : a.sev === "error" ? -1 : 1))
  .slice(0, 8)
  .forEach((w) => console.log(`  [${w.sev}] ${w.id} (${w.n}건) — ${w.first.slice(0, 70)}`))
