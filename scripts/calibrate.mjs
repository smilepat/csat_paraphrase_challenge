#!/usr/bin/env node
// ============================================================
// 채점기 캘리브레이션 리포트 v2 — 축별로 따로 측정한다
//
//   npx vite-node scripts/calibrate.mjs             (= npm run calibrate)
//   npx vite-node scripts/calibrate.mjs -- --sweep  임계값 격자 탐색
//   ... --no-llm                                     모순 게이트 없이 측정
//
// v1 은 총점 하나로 뭉뚱그려 재다가 측정 도구 자체의 결함을 놓칠 뻔했다.
// v2 는 각 축을 그 축만 움직인 데이터로 잰다.
// ============================================================
import { readFileSync } from "node:fs"
import { loadEnv, embedBatch } from "./_shared.mjs"

loadEnv() // lib/gemini 가 env 를 지연 조회하므로 import 순서와 무관하다

const { scoreSubmission } = await import("../lib/scoring/index.ts")
const { MEANING } = await import("../lib/scoring/config.ts")
const { sentences } = await import("../lib/scoring/text.ts")
const { judgeBatch } = await import("../lib/scoring/verdict.ts")

const sweep = process.argv.includes("--sweep")
const useLlm = !process.argv.includes("--no-llm")

const set = JSON.parse(readFileSync("data/calibration/set.json", "utf8"))
const freq = JSON.parse(readFileSync("data/freq-rank.json", "utf8"))
const passageOf = (id) => set.passages.find((p) => p.id === id)

// ---- 임베딩 ----
const needed = new Set()
for (const p of set.passages) {
  p.propositions.forEach((t) => needed.add(t))
  p.modelAnswers.forEach((t) => needed.add(t))
}
for (const it of set.items) {
  needed.add(it.text)
  sentences(it.text).forEach((s) => needed.add(s))
}
const texts = [...needed]
console.log(`[calib] 임베딩 ${texts.length}건 (배치 ${Math.ceil(texts.length / 100)}회)`)
const vectors = await embedBatch(texts)
const vecOf = new Map(texts.map((t, i) => [t, vectors[i]]))
const answerVectorsOf = (t) =>
  [vecOf.get(t), ...sentences(t).map((s) => vecOf.get(s))].filter(Boolean)

// ---- LLM 판정 (모순 + 커버리지) ----
const contradictedBy = new Map()
const coveredBy = new Map()
if (useLlm) {
  let calls = 0
  for (const p of set.passages) {
    const targets = set.items.filter((i) => i.passageId === p.id && i.series !== "verbatim")
    for (let i = 0; i < targets.length; i += 10) {
      const chunk = targets.slice(i, i + 10)
      const verdicts = await judgeBatch(
        p.propositions,
        chunk.map((t, j) => ({ id: `${p.id}#${i + j}`, answer: t.text })),
      )
      calls++
      chunk.forEach((t, j) => {
        const v = verdicts.get(`${p.id}#${i + j}`)
        if (v) {
          contradictedBy.set(t.text, v.contradicted)
          coveredBy.set(t.text, v.covered)
        }
      })
    }
  }
  console.log(`[calib] 모순 게이트 판정 ${contradictedBy.size}건 (LLM 호출 ${calls}회)`)
}

// ---- 채점 ----
function score(it) {
  const p = passageOf(it.passageId)
  return scoreSubmission({
    answer: it.text,
    passageBody: p.body,
    targetWords: set.targetWords,
    freq,
    answerVectors: answerVectorsOf(it.text),
    propositionVectors: p.propositions.map((t) => vecOf.get(t)),
    modelVectors: p.modelAnswers.map((t) => vecOf.get(t)),
    modelAnswers: p.modelAnswers,
    contradictedIndices: contradictedBy.get(it.text) ?? [],
    coveredIndices: coveredBy.get(it.text),
    propositions: p.propositions,
  })
}

/** 임베딩만으로 채점(LLM 폴백 경로 측정용). */
function scoreEmbeddingOnly(it) {
  const p = passageOf(it.passageId)
  return scoreSubmission({
    answer: it.text,
    passageBody: p.body,
    targetWords: set.targetWords,
    freq,
    answerVectors: answerVectorsOf(it.text),
    propositionVectors: p.propositions.map((t) => vecOf.get(t)),
    modelVectors: p.modelAnswers.map((t) => vecOf.get(t)),
    modelAnswers: p.modelAnswers,
  })
}

// ---- Spearman (동점 평균 순위) ----
function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const out = new Array(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg
    i = j + 1
  }
  return out
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), n = a.length
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(ra), mb = mean(rb)
  let num = 0, da = 0, dbv = 0
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    dbv += (rb[i] - mb) ** 2
  }
  return da === 0 || dbv === 0 ? 0 : num / Math.sqrt(da * dbv)
}

const pick = (s) => set.items.filter((i) => i.series === s)
const line = (label, rho, bar, n) => {
  const ok = rho >= bar
  console.log(
    `  ${label.padEnd(28)} ρ = ${rho.toFixed(3)}  (n=${String(n).padStart(2)}, 합격선 ${bar})  ` +
    `${ok ? "PASS" : "FAIL"}`,
  )
  return ok
}

console.log("\n" + "=".repeat(70))
console.log("축별 측정 — 각 계열은 해당 축만 변화시킨 데이터다")
console.log("=".repeat(70))

// 1) 의미 축: 담은 명제 수만 변화
// 정답은 "생성 시 요청한 사양"(specCovered)을 쓴다. 심판 LLM 의 라벨을 정답으로 쓰면
// LLM 커버리지 채점을 자기 자신과 비교하는 순환이 된다.
const cov = pick("coverage").map((it) => ({
  it, r: score(it), rEmb: scoreEmbeddingOnly(it), gold: it.specCovered.length / it.n,
}))
const covOk = line(
  "의미 — LLM 커버리지",
  spearman(cov.map((x) => x.gold), cov.map((x) => x.r.meaning)), 0.7, cov.length,
)
line(
  "의미 — 임베딩 폴백",
  spearman(cov.map((x) => x.gold), cov.map((x) => x.rEmb.meaning)), 0.7, cov.length,
)

// 2) 쉬움 축: 어휘 난이도만 변화
const ez = pick("ease").map((it) => ({ it, r: score(it), gold: it.goldEase }))
const ezOk = line("쉬움(어휘 난이도)", spearman(ez.map((x) => x.gold), ez.map((x) => x.r.ease)), 0.7, ez.length)

// 3) 간결 축: 길이만 변화.
// 정답을 "요청한 길이 버킷"이 아니라 "실제 단어 수"로 잡는다 — 생성기가 요청 길이를
// 정확히 맞추지 못한 것까지 채점기 결함으로 계산되면 측정이 오염된다.
const br = pick("brevity").map((it) => ({ it, r: score(it) }))
const brOk = line(
  "간결(실제 단어 수 대비)",
  spearman(br.map((x) => -x.r.words), br.map((x) => x.r.brevity)), 0.9, br.length,
)

// ---- 커버리지 구간별 평균 ----
console.log("\n담은 명제 비율별 의미 점수 (단조 증가해야 정상)")
const buckets = new Map()
for (const c of cov) {
  const k = c.gold.toFixed(2)
  if (!buckets.has(k)) buckets.set(k, [])
  buckets.get(k).push([c.r.meaning, c.rEmb.meaning])
}
for (const [k, vs] of [...buckets].sort((a, b) => Number(b[0]) - Number(a[0]))) {
  const m = vs.reduce((s, v) => s + v[0], 0) / vs.length
  const e = vs.reduce((s, v) => s + v[1], 0) / vs.length
  console.log(
    `  커버리지 ${k}  (n=${String(vs.length).padStart(2)})  ` +
    `LLM ${m.toFixed(1)} / 50    임베딩폴백 ${e.toFixed(1)} / 50`,
  )
}

// ---- 모순 게이트 ----
console.log("\n" + "-".repeat(70))
const contra = pick("contradict").map((it) => ({ it, r: score(it) }))
const full = cov.filter((c) => c.gold >= 0.99)
const caughtContra = contra.filter((c) => (contradictedBy.get(c.it.text) ?? []).length > 0).length
const contraRate = contra.length ? caughtContra / contra.length : 0
console.log(
  `모순 탐지 ${caughtContra}/${contra.length} (${(contraRate * 100).toFixed(0)}%)  ` +
  `${contraRate >= 0.8 ? "PASS" : "FAIL (합격선 80%)"}${useLlm ? "" : "  [LLM 꺼짐]"}`,
)
const avg = (xs, f) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0)
console.log(
  `  의미 점수 — 모순 답안 평균 ${avg(contra, (x) => x.r.meaning).toFixed(1)} ` +
  `vs 전체 커버 답안 평균 ${avg(full, (x) => x.r.meaning).toFixed(1)}`,
)
const contraMax = Math.max(...contra.map((x) => x.r.meaning))
const fullMin = Math.min(...full.map((x) => x.r.meaning))
console.log(
  `  구간 겹침 — 모순 최고 ${contraMax.toFixed(1)} vs 정답 최저 ${fullMin.toFixed(1)}  ` +
  `${contraMax < fullMin ? "분리됨 PASS" : "겹침 FAIL"}`,
)

// ---- 복붙 가드 ----
const vb = pick("verbatim").map((it) => ({ it, r: score(it) }))
const vbCaught = vb.filter((x) => x.r.flags.some((f) => f.kind === "verbatim")).length
const legit = [...cov, ...ez, ...br]
const vbFalse = legit.filter((x) => x.r.flags.some((f) => f.kind === "verbatim")).length
console.log(
  `복붙 탐지 ${vbCaught}/${vb.length} ${vbCaught === vb.length ? "PASS" : "FAIL"}  |  ` +
  `정상 답안 오탐 ${vbFalse}/${legit.length} ${vbFalse === 0 ? "PASS" : "FAIL"}`,
)
for (const x of legit.filter((y) => y.r.flags.some((f) => f.kind === "verbatim")).slice(0, 3)) {
  console.log(`   오탐: ${x.it.text.slice(0, 70)}`)
}

// ---- 임계값 탐색 (의미 축 기준) ----
if (sweep) {
  console.log("\n의미 축 임계값 탐색 중...")
  const save = { ...MEANING }
  let best = { rho: -2 }
  for (const pLo of [0.55, 0.6, 0.65, 0.7, 0.72, 0.75]) {
    for (const pHi of [0.78, 0.82, 0.85, 0.88, 0.92]) {
      if (pHi <= pLo) continue
      for (const gLo of [0.55, 0.65, 0.72]) {
        for (const gHi of [0.82, 0.88, 0.94]) {
          if (gHi <= gLo) continue
          MEANING.propLo = pLo; MEANING.propHi = pHi
          MEANING.gistLo = gLo; MEANING.gistHi = gHi
          const s = pick("coverage").map((it) => ({ gold: it.goldCoverage, r: score(it) }))
          const r = spearman(s.map((x) => x.gold), s.map((x) => x.r.meaning))
          if (r > best.rho) best = { rho: r, pLo, pHi, gLo, gHi }
        }
      }
    }
  }
  Object.assign(MEANING, save)
  console.log(`최적 의미 ρ = ${best.rho.toFixed(3)}`)
  console.log(`  propLo=${best.pLo} propHi=${best.pHi} gistLo=${best.gLo} gistHi=${best.gHi}`)
  console.log("  → lib/scoring/config.ts 의 MEANING 을 위 값으로 수정")
}

console.log("\n" + "=".repeat(70))
const pass =
  covOk && ezOk && brOk && contraRate >= 0.8 &&
  contraMax < fullMin && vbCaught === vb.length && vbFalse === 0
console.log(pass ? "전체 PASS" : "일부 FAIL — 위 항목 확인")
console.log("주의: 정답 라벨은 구성 사양 + 심판 LLM 확인이다. 교사 검증은 별도로 필요하다.")
console.log("=".repeat(70))
process.exitCode = pass ? 0 : 1
