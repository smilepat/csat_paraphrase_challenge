#!/usr/bin/env node
// ============================================================
// 캘리브레이션 세트 v2 — 축을 하나씩만 움직인다
//
// v1 은 등급마다 길이·어휘·명제 커버리지를 한꺼번에 바꿨다. 그래서 진단해 보니
// 5/4/3등급의 명제 유사도가 0.827 / 0.826 / 0.858 로 정답 순서 자체가 신호에
// 없었다 — 채점기가 아니라 측정 도구가 잘못된 것이었다.
//
// v2 설계:
//   coverage 계열 — 길이·어휘를 고정하고 담는 명제 수만 k = n..1 로 줄인다
//   contradict 계열 — 명제 하나를 정반대로 진술 (LLM 게이트 검증용)
//   ease 계열     — 의미·길이 고정, 어휘 난이도만 4단계
//   brevity 계열  — 의미·어휘 고정, 길이만 4단계
//   verbatim 계열 — 원문 잘라내기 (가드 검증용)
//
// 정답 라벨은 "요청한 사양"이 아니라 "LLM 심판이 확인한 실제 커버리지"로 확정한다.
// 사양과 심판이 어긋난 항목은 버리고 몇 개 버렸는지 보고한다.
// ============================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createClient } from "@libsql/client"
import { loadEnv, callGemini, parseGeminiJson } from "./_shared.mjs"

loadEnv()

const TARGET_WORDS = 25
const FIXED_LEN = "18-22 words total"
const EASY_VOCAB =
  "Use only words a Korean middle-school student knows. Short simple sentences."

const url = process.env.TURSO_DATABASE_URL?.trim() || "file:./local.db"
const authToken = process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const { rows } = await db.execute(`
  SELECT id, title, body, question_type, propositions, model_answers
  FROM pc_passages
  WHERE propositions IS NOT NULL AND question_type IN ('빈칸 추론','요지','주장')
  GROUP BY question_type
  ORDER BY question_type, id
`)
console.log(`[calib] 지문 ${rows.length}개:`, rows.map((r) => r.id).join(", "))

const SYSTEM = `You produce test fixtures for an automatic paraphrase scorer.
Follow the spec exactly, including its deliberate flaws. Do not improve on the spec.
When told to omit a claim, the answer must contain nothing that states or implies it.`

const gen = async (prompt) => {
  const raw = await callGemini(prompt, SYSTEM, { json: true, temperature: 0.85 })
  const a = parseGeminiJson(raw)
  if (!Array.isArray(a)) throw new Error("배열 아님")
  return a.map((x) => String(x).trim()).filter(Boolean)
}

const RAW_PATH = "data/calibration/raw-items.json"
const regen = process.argv.includes("--regen")

let items = []

// 생성은 비싸다. 검증 단계에서 실패해도 생성분을 버리지 않도록 먼저 캐시한다.
if (!regen && existsSync(RAW_PATH)) {
  items = JSON.parse(readFileSync(RAW_PATH, "utf8"))
  console.log(`[calib] 캐시된 생성분 ${items.length}개 재사용 (--regen 으로 재생성)`)
}

for (const p of items.length ? [] : rows) {
  const props = JSON.parse(p.propositions)
  const n = props.length
  const list = props.map((x, i) => `${i}. ${x}`).join("\n")
  const head = `PASSAGE:\n${p.body}\n\nCLAIMS THE PASSAGE MAKES:\n${list}\n`

  // --- coverage: 길이·어휘 고정, 담는 명제 수만 변화 ---
  for (let k = n; k >= 1; k--) {
    const keep = [...Array(k).keys()]
    const drop = [...Array(n).keys()].slice(k)
    const answers = await gen(
      `${head}
Write 3 different student answers that state EXACTLY these claims: ${keep.join(", ")}.
They must say NOTHING about these claims: ${drop.length ? drop.join(", ") : "(none)"}.
Every answer: ${FIXED_LEN}. ${EASY_VOCAB}
Do not copy phrases from the passage.
Return ONLY a JSON array of 3 strings.`,
    )
    for (const text of answers.slice(0, 3)) {
      items.push({ passageId: p.id, series: "coverage", specCovered: keep, k, n, text })
    }
    console.log(`[calib] ${p.id} coverage k=${k}/${n}`)
  }

  // --- contradiction: 명제 0 을 정반대로 ---
  const contra = await gen(
    `${head}
Write 3 student answers that state the EXACT OPPOSITE of claim 0, while correctly
stating the other claims. The English must be fluent and confident so that it looks
right to someone who did not read the passage.
Every answer: ${FIXED_LEN}. ${EASY_VOCAB}
Return ONLY a JSON array of 3 strings.`,
  )
  for (const text of contra.slice(0, 3)) {
    items.push({ passageId: p.id, series: "contradict", specContradicted: [0], text })
  }
  console.log(`[calib] ${p.id} contradict`)

  // --- ease: 의미·길이 고정, 어휘 난이도만 ---
  const easeLevels = [
    { gold: 4, spec: "very easy words only (top-1000 frequency), short clauses" },
    { gold: 3, spec: "ordinary everyday words" },
    { gold: 2, spec: "some formal academic words, longer clauses" },
    { gold: 1, spec: "dense academic register, nominalisations, rare Latinate words" },
  ]
  for (const lv of easeLevels) {
    const answers = await gen(
      `${head}
Write 2 student answers that state ALL the claims, each ${FIXED_LEN}.
Vocabulary level: ${lv.spec}.
The MEANING must be identical across levels — only the wording difficulty changes.
Return ONLY a JSON array of 2 strings.`,
    )
    for (const text of answers.slice(0, 2)) {
      items.push({ passageId: p.id, series: "ease", goldEase: lv.gold, text })
    }
  }
  console.log(`[calib] ${p.id} ease`)

  // --- brevity: 의미·어휘 고정, 길이만 ---
  for (const [gold, words] of [[4, 15], [3, 25], [2, 35], [1, 48]]) {
    const answers = await gen(
      `${head}
Write 2 student answers that state ALL the claims in about ${words} words each
(within 2 words of ${words}). ${EASY_VOCAB}
Return ONLY a JSON array of 2 strings.`,
    )
    for (const text of answers.slice(0, 2)) {
      items.push({ passageId: p.id, series: "brevity", goldBrevity: gold, targetLen: words, text })
    }
  }
  console.log(`[calib] ${p.id} brevity`)

  // --- verbatim: 원문 잘라내기 (결정론적) ---
  const words = p.body.split(/\s+/)
  for (const start of [0, 40]) {
    items.push({
      passageId: p.id, series: "verbatim", text: words.slice(start, start + TARGET_WORDS).join(" "),
    })
  }
}

mkdirSync("data/calibration", { recursive: true })
if (!existsSync(RAW_PATH) || regen) {
  writeFileSync(RAW_PATH, JSON.stringify(items, null, 2), "utf8")
  console.log(`[calib] 생성분 ${items.length}개 캐시 → ${RAW_PATH}`)
}

// ---- 정답 라벨 검증: 심판 LLM 이 실제 커버리지를 확인한다 ----
// 사양대로 생성됐는지 믿지 않는다. 어긋난 항목은 버린다.
console.log("\n[calib] 생성 결과 검증 중...")
const JUDGE_SYSTEM = `You verify test fixtures. Report only what each answer actually states.
Omitting a claim is not a contradiction. Be strict about vague implication: only count a
claim as stated if the answer really says it.`

let dropped = 0
for (const p of rows) {
  const props = JSON.parse(p.propositions)
  const targets = items.filter(
    (i) => i.passageId === p.id && (i.series === "coverage" || i.series === "contradict"),
  )
  for (let i = 0; i < targets.length; i += 6) {
    const chunk = targets.slice(i, i + 6)
    const raw = await callGemini(
      `Claims:\n${props.map((x, j) => `${j}. ${x}`).join("\n")}\n\nAnswers:\n` +
        chunk.map((t, j) => `[${j}] ${t.text}`).join("\n") +
        `\n\nFor each answer return {"i":<index>,"covered":[claim indices actually stated],` +
        `"contradicted":[claim indices stated in reverse]}.\nReturn ONLY a JSON array.`,
      JUDGE_SYSTEM,
      { json: true, temperature: 0, maxOutputTokens: 8192 },
    )
    const verdicts = parseGeminiJson(raw)
    if (!Array.isArray(verdicts) || verdicts.length < chunk.length) {
      console.warn(`[calib] 심판 응답 ${verdicts?.length ?? 0}/${chunk.length} — 부족분은 탈락 처리`)
    }
    for (const v of Array.isArray(verdicts) ? verdicts : []) {
      const item = chunk[Number(v.i)]
      if (!item) continue
      item.judgedCovered = Array.isArray(v.covered) ? v.covered.map(Number) : []
      item.judgedContradicted = Array.isArray(v.contradicted) ? v.contradicted.map(Number) : []
    }
  }
}

const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
const kept = items.filter((it) => {
  if (it.series === "coverage") {
    if (!it.judgedCovered) return false
    // 심판이 확인한 커버리지를 정답으로 쓴다(사양과 다르면 심판을 따른다).
    it.goldCoverage = it.judgedCovered.length / it.n
    // 모순이 섞였으면 coverage 실험에서 제외한다(축이 섞이므로).
    if (it.judgedContradicted?.length) { dropped++; return false }
    return true
  }
  if (it.series === "contradict") {
    if (!same(it.judgedContradicted ?? [], it.specContradicted)) { dropped++; return false }
    return true
  }
  return true
})

writeFileSync(
  "data/calibration/set.json",
  JSON.stringify({
    targetWords: TARGET_WORDS,
    note:
      "정답 라벨은 심판 LLM 이 확인한 실제 커버리지다. 사양과 어긋난 항목은 제외했다. " +
      "교사 검증은 여전히 별도로 필요하다.",
    passages: rows.map((r) => ({
      id: r.id, title: r.title, questionType: r.question_type, body: r.body,
      propositions: JSON.parse(r.propositions), modelAnswers: JSON.parse(r.model_answers),
    })),
    items: kept,
  }, null, 2),
  "utf8",
)

const bySeries = {}
for (const i of kept) bySeries[i.series] = (bySeries[i.series] || 0) + 1
console.log(`\n[calib] 총 ${kept.length}개 (검증 탈락 ${dropped}개) → data/calibration/set.json`)
console.log("[calib] 계열별:", Object.entries(bySeries).map(([s, n]) => `${s} ${n}`).join(", "))
