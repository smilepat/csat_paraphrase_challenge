#!/usr/bin/env node
// ============================================================
// 라이브 확인 — 실제 Gemini API 로 한 라운드를 채점해 본다.
//
//   npx vite-node scripts/live-check.mjs
//
// 보는 것:
//   1. 실제 임베딩·판정 경로가 끝까지 도는가
//   2. 답안 품질에 따라 점수가 상식적으로 갈리는가
//   3. 30명 라운드 1회에 API 를 몇 번 부르는가 (비용)
//   4. 캐시가 두 번째 호출을 막는가
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()

const { judgeRound } = await import("../lib/scoring/service.ts")

const db = createClient({ url: process.env.TURSO_DATABASE_URL?.trim() || "file:./local.db" })

const { rows } = await db.execute(`
  SELECT id, body, propositions, model_answers FROM pc_passages
  WHERE propositions IS NOT NULL ORDER BY id LIMIT 1
`)
if (!rows.length) {
  console.error("보강된 지문이 없습니다. npm run db:enrich 를 먼저 실행하세요.")
  process.exit(1)
}
const p = rows[0]
const passage = {
  id: String(p.id),
  body: String(p.body),
  propositions: JSON.parse(String(p.propositions)),
  modelAnswers: JSON.parse(String(p.model_answers)),
  refEmbedding: null,
}

console.log(`지문 ${passage.id} (${passage.body.split(/\s+/).length}단어)`)
console.log("핵심 명제:")
passage.propositions.forEach((x, i) => console.log(`  ${i}. ${x}`))

// 품질이 다른 답안을 이 지문에 맞춰 생성한다.
// (하드코딩하면 다른 지문을 골랐을 때 "좋은 요약"이 주제부터 어긋나 무의미해진다)
const { callGemini, parseGeminiJson } = await import("./_shared.mjs")
const generated = parseGeminiJson(
  await callGemini(
    `PASSAGE:\n${passage.body}\n\nCLAIMS:\n` +
      passage.propositions.map((x, i) => `${i}. ${x}`).join("\n") +
      `\n\nWrite three student answers, each 15-20 words in easy English:
1. "good"     — states ALL the claims
2. "partial"  — states ONLY claim 0 and nothing else
3. "reversed" — states the OPPOSITE of claim 0, fluently and confidently
Return ONLY {"good":"...","partial":"...","reversed":"..."}`,
    "You produce test fixtures. Follow the spec exactly, including its deliberate flaws.",
    { json: true, temperature: 0.7 },
  ),
)

const cases = [
  ["좋은 요약", generated.good],
  ["부분만", generated.partial],
  ["의미 역전", generated.reversed],
  ["원문 복붙", passage.body.split(/\s+/).slice(0, 25).join(" ")],
  ["너무 김", passage.body.split(/\s+/).slice(30, 90).join(" ")],
]

const before = await db.execute({
  sql: "SELECT kind, calls, items FROM pc_api_usage WHERE day = ?",
  args: [new Date().toISOString().slice(0, 10)],
})
const beforeCalls = before.rows.reduce((s, r) => s + Number(r.calls), 0)

const subs = cases.map(([label, text], i) => ({ id: `live-${i}`, nickname: label, text }))
const t0 = Date.now()
const results = await judgeRound(passage, 25, subs)
const elapsed = Date.now() - t0

console.log(`\n채점 ${results.size}건 / ${(elapsed / 1000).toFixed(1)}초\n`)
console.log("답안 유형        총점   의미   간결  쉬움  플래그")
console.log("-".repeat(72))
for (const s of subs) {
  const r = results.get(s.id)
  if (!r) { console.log(`${s.nickname.padEnd(12)}  (결과 없음)`); continue }
  const sc = r.scores
  console.log(
    `${s.nickname.padEnd(12)} ${String(sc.total).padStart(6)} ${String(sc.meaning).padStart(6)} ` +
    `${String(sc.brevity).padStart(6)} ${String(sc.ease).padStart(5)}  ` +
    (sc.flags.map((f) => f.kind).join(",") || "-"),
  )
  if (r.verdict?.koreanFeedback) console.log(`             피드백: ${r.verdict.koreanFeedback}`)
}

const after = await db.execute({
  sql: "SELECT kind, calls, items FROM pc_api_usage WHERE day = ?",
  args: [new Date().toISOString().slice(0, 10)],
})
const afterCalls = after.rows.reduce((s, r) => s + Number(r.calls), 0)
console.log(`\nAPI 호출 ${afterCalls - beforeCalls}회 (5명 기준)`)
console.log("  내역:", after.rows.map((r) => `${r.kind} ${r.calls}콜/${r.items}건`).join(", "))

// 캐시 확인 — 같은 답안을 다시 채점하면 호출이 0 이어야 한다
const t1 = Date.now()
await judgeRound(passage, 25, subs)
const again = await db.execute({
  sql: "SELECT SUM(calls) AS c FROM pc_api_usage WHERE day = ?",
  args: [new Date().toISOString().slice(0, 10)],
})
const delta = Number(again.rows[0].c) - afterCalls
console.log(
  `\n재채점 API 호출 ${delta}회 / ${((Date.now() - t1) / 1000).toFixed(1)}초  ` +
  `${delta === 0 ? "캐시 적중 PASS" : "FAIL — 캐시가 동작하지 않음"}`,
)
