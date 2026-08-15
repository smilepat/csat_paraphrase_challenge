#!/usr/bin/env node
// ============================================================
// 유형 1 의미 판정 캘리브레이션.  npm run typed:calibrate1
// **실 API 1콜(8건).** --dry 는 가짜 판정으로 무과금.
//
// 유형 2 와 같은 다섯 갈래를 쓰므로 여기서 확인할 것은 **틀 바꾸기**가
// 통하는지다: 목표 구조가 없고 "낱말을 실제로 바꿨는가"가 추가된 형태.
// ============================================================
import { loadEnv } from "./_shared.mjs"
import { judgeType1Batch } from "../lib/scoring/typed/verdict1.ts"

loadEnv()
if (process.argv.includes("--dry")) process.env.PARAPHRASE_FAKE_LLM = "1"

const CASES = [
  { id: "a1", stimulus: "natural ingredients often vary in their composition",
    answer: "raw materials from nature frequently differ in what they contain", expect: "same", reworded: true },
  { id: "a2", stimulus: "the position of the architect rose during the Roman Empire",
    answer: "architects gained higher standing under Roman rule", expect: "same", reworded: true },
  // 낱말을 안 바꿨다 — meaning 은 same 이되 reworded 가 false 여야 한다
  { id: "a3", stimulus: "natural ingredients often vary in their composition",
    answer: "natural ingredients vary in composition often", expect: "same", reworded: false },
  { id: "a4", stimulus: "scattered attention harms your ability to let go of stress",
    answer: "a divided focus makes it harder to release tension", expect: "same", reworded: true },
  // 일부만 옮겼다
  { id: "a5", stimulus: "elephants greet each other with elaborate displays after long absences",
    answer: "elephants greet each other", expect: "narrower", reworded: false },
  // 원문보다 크게
  { id: "a6", stimulus: "some residents complain about traffic congestion",
    answer: "every resident objects to traffic congestion", expect: "broader", reworded: true },
  // 다른 이야기
  { id: "a7", stimulus: "the variability of natural ingredients makes testing difficult",
    answer: "natural ingredients cost less to produce", expect: "changed", reworded: true },
  // 정반대
  { id: "a8", stimulus: "synthetic ingredients can be produced under precise control",
    answer: "synthetic ingredients cannot be produced reliably", expect: "reversed", reworded: true },
]

const verdicts = await judgeType1Batch(CASES)
if (verdicts.size === 0) { console.error("판정이 비었습니다 — GEMINI_API_KEY 확인"); process.exit(1) }

let ok = 0, rwOk = 0
console.log("id  기대        판정        reworded(기대/판정)  일치")
for (const c of CASES) {
  const v = verdicts.get(c.id)
  const hit = v?.meaning === c.expect
  const rw = v?.reworded === c.reworded
  if (hit) ok++
  if (rw) rwOk++
  console.log(`${c.id}  ${c.expect.padEnd(11)} ${String(v?.meaning).padEnd(11)} ${String(c.reworded).padEnd(5)}/${String(v?.reworded).padEnd(5)}        ${hit ? "O" : "X"}${rw ? "" : " (rw X)"}`)
  if (!hit && v) console.log(`     피드백: ${v.koreanFeedback}`)
}
const acc = (ok / CASES.length) * 100
console.log(`\n의미 라벨 일치 ${ok}/${CASES.length} (${acc.toFixed(1)}%)`)
console.log(`낱말 교체 판정 일치 ${rwOk}/${CASES.length} (${((rwOk / CASES.length) * 100).toFixed(1)}%)`)
const fatal = CASES.filter((c) => c.expect === "reversed" && ["same", "narrower"].includes(verdicts.get(c.id)?.meaning))
console.log(`뒤집힌 답을 정답 계열로 부른 건수: ${fatal.length}`)
if (acc < 80 || fatal.length > 0) { console.error("\n[calibrate-type1] 기준 미달"); process.exit(1) }
console.log("\n[calibrate-type1] 통과")
