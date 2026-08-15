#!/usr/bin/env node
// ============================================================
// 구조 검사(정형동사 판별)의 정확도를 **코퍼스로** 잰다.  npm run typed:measure
//
// 정답 라벨이 공짜로 나온다는 것이 이 측정의 요점이다:
//   · 채굴된 유형2 unfold 자극(`the X of Y`)은 **정의상 명사구** → finite=false 여야 한다
//   · 지문 문장은 **정의상 절**                                 → finite=true  여야 한다
// 사람이 라벨을 달 필요도, LLM 을 부를 필요도 없다.
//
// ⚠ 이 라벨은 완벽하지 않다. of 보문 근사가 술부를 삼킨 자극이 있으면 그 자극은
//   사실 절이다. 그래서 오분류 표본을 반드시 눈으로 본다 — 숫자만 보면
//   측정 도구의 결함을 채점기 성능으로 착각한다(CALIBRATION.md 의 교훈).
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"
import { findFiniteVerb } from "../lib/scoring/typed/structure.ts"
import { sentences, splitSummaryBlock, usableSentence } from "../lib/tasks/segment.ts"

loadEnv()

const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const passages = (await db.execute("SELECT id, body FROM pc_passages")).rows
const stimuli = (await db.execute(
  "SELECT id, stimulus_text FROM pc_tasks WHERE type=2 AND direction='unfold'",
)).rows

// ── 라벨 세트 ────────────────────────────────────────────────
const NP = stimuli.map((r) => ({ id: r.id, text: r.stimulus_text }))
const CLAUSE = []
for (const p of passages) {
  const { passageEnd } = splitSummaryBlock(p.body)
  for (const s of sentences(p.body.slice(0, passageEnd))) {
    if (usableSentence(s.text)) CLAUSE.push({ id: p.id, text: s.text })
  }
}

function evaluate(set, expectFinite) {
  const wrong = []
  let ok = 0
  for (const item of set) {
    const { finite, cue } = findFiniteVerb(item.text)
    if (finite === expectFinite) ok++
    else wrong.push({ ...item, cue })
  }
  return { n: set.length, ok, wrong }
}

const npRes = evaluate(NP, false)
const clRes = evaluate(CLAUSE, true)

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "0.0")

console.log(`[measure] target=${url}\n`)
console.log("정형동사 판별 정확도 — 라벨은 코퍼스에서 자동 생성")
console.log(`  명사구로 라벨된 자극  ${String(npRes.n).padStart(4)}건 → 맞춤 ${String(npRes.ok).padStart(4)} (${pct(npRes.ok, npRes.n)}%)`)
console.log(`  절로 라벨된 지문 문장 ${String(clRes.n).padStart(4)}건 → 맞춤 ${String(clRes.ok).padStart(4)} (${pct(clRes.ok, clRes.n)}%)`)

const total = npRes.n + clRes.n
const totalOk = npRes.ok + clRes.ok
console.log(`  전체                  ${String(total).padStart(4)}건 → 맞춤 ${String(totalOk).padStart(4)} (${pct(totalOk, total)}%)`)

console.log(`\n── 오분류: 명사구인데 동사가 있다고 본 것 (${npRes.wrong.length}건) ──`)
for (const w of npRes.wrong.slice(0, 12)) {
  console.log(`  [${w.cue}] ${w.text.replace(/\n/g, " ").slice(0, 100)}`)
}
console.log(`\n── 오분류: 절인데 동사를 못 찾은 것 (${clRes.wrong.length}건) ──`)
for (const w of clRes.wrong.slice(0, 12)) {
  console.log(`  ${w.text.replace(/\n/g, " ").slice(0, 110)}`)
}

// 놓친 절에서 어떤 낱말이 동사였는지 힌트를 준다 — 목록 보강의 근거
const missed = new Map()
for (const w of clRes.wrong) {
  for (const t of (w.text.toLowerCase().match(/[a-z]+(?:s|ed)\b/g) ?? [])) {
    missed.set(t, (missed.get(t) ?? 0) + 1)
  }
}
const top = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 20)
if (top.length) {
  console.log("\n놓친 절에 자주 나온 굴절형(목록 보강 후보):")
  console.log("  " + top.map(([w, n]) => `${w}(${n})`).join(" "))
}
