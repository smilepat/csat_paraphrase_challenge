#!/usr/bin/env node
// ============================================================
// 유형 2 의미 판정 캘리브레이션.  npm run typed:calibrate
//
// **실 API 를 호출한다(과금).** 기본은 1콜이다 — 아래 CASES 를 한 번에 배치로 보낸다.
//
// 무엇을 확인하는가: 프롬프트가 다섯 갈래를 실제로 **구별하는가**.
// 정답 라벨은 사람이 손으로 달았다(케이스마다 왜 그 라벨인지 주석에 있다).
// 심판 라벨로 심판을 평가하는 순환을 피하려고 LLM 에게 라벨을 만들게 하지 않았다.
//
// 통과 기준: 라벨 일치 80% 이상 + **reversed 를 same 으로 부르는 일이 0**.
// 뒤집힌 답을 정답으로 부르는 것은 다른 오류보다 훨씬 나쁘다.
// ============================================================
import { loadEnv } from "./_shared.mjs"
import { judgeType2Batch } from "../lib/scoring/typed/verdict2.ts"
import { checkStructure } from "../lib/scoring/typed/structure.ts"

loadEnv()

// 자극은 실제 채굴 결과에서 가져왔다. 답안은 각 갈래를 겨냥해 손으로 썼다.
//
// ⚠ 이 세트에는 오랫동안 **짧은 `the X of Y` 명사구만** 있었다. 그래서 학생이
//   실제로 쓰는 긴 명사구(후치 분사·that절 보문)에서 구조 검사가 무너지는 것을
//   여기서는 볼 수가 없었고, 85.7~92.9% 라는 숫자가 그 결함을 가렸다.
//   자가진단에서 앱 자신의 예시 답 124건 중 21건이 이 자리에서 떨어지는 것을
//   보고서야 드러났다. 아래 long-* 가 그 형태다 — 빼지 말 것.
const CASES = [
  // ── 학생이 실제로 쓰는 긴 명사구 (구조 검사 회귀 감시용) ──
  // 이 셋은 **구조**를 보려고 넣은 것이다. 그래서 의미 쪽은 논쟁이 없도록
  // 자극과 답안을 짝 맞춰 썼다 — 처음에 실제 문항에서 그대로 떠 왔더니
  // "a kind of" 나 화자 귀속이 빠져 판정기가 narrower/broader 라 했고,
  // 그쪽이 옳았다. **정답 라벨이 논쟁적인 항목은 지표를 오염시킨다.**
  { id: "long1", target: "noun_phrase",
    stimulus: "negative emotions provide a testimonial",
    answer: "the testimonial provided by negative emotions", expect: "same" },
  { id: "long2", target: "noun_phrase",
    stimulus: "outcomes are assessed based on personal control",
    answer: "the assessment of outcomes based on personal control", expect: "same" },
  { id: "long3", target: "noun_phrase",
    stimulus: "someone claimed that conflict results from animosity",
    answer: "the claim that conflict results from animosity", expect: "same" },

  // ── same ──
  { id: "s1", target: "clause", stimulus: "the controllability of the production process",
    answer: "the production process can be controlled", expect: "same" },
  { id: "s2", target: "noun_phrase", stimulus: "natural ingredients often vary in their composition",
    answer: "the variability of natural ingredients", expect: "same" },
  { id: "s3", target: "clause", stimulus: "the duration of the separation",
    answer: "how long they had been apart", expect: "same" },

  // ── narrower: 원문의 일부만 옮겼다 ──
  { id: "n1", target: "clause", stimulus: "the strength and duration of the social bond",
    answer: "how strong the bond is", expect: "narrower" },
  { id: "n2", target: "noun_phrase", stimulus: "synthetic ingredients are made precisely and tested carefully",
    answer: "the precise production of synthetic ingredients", expect: "narrower" },

  // ── broader: 원문이 말하지 않은 범위까지 말했다 ──
  { id: "b1", target: "clause", stimulus: "the controllability of the production process",
    answer: "every industrial process can be fully controlled", expect: "broader" },
  // 화제는 그대로 두고 **수량어 하나만** 넓힌다. 원래 케이스는 화제까지 바뀌어
  // broader 와 changed 가 겹쳤고, 그건 라벨이 모호한 것이지 모델이 틀린 게 아니었다.
  { id: "b2", target: "noun_phrase", stimulus: "some residents complain about traffic congestion",
    answer: "the complaints of all residents about traffic congestion", expect: "broader" },

  // ── changed: 원문에 없는 이야기 ──
  { id: "c1", target: "clause", stimulus: "the variability of natural ingredients",
    answer: "natural ingredients are cheaper to produce", expect: "changed" },
  { id: "c2", target: "noun_phrase", stimulus: "elephants greet each other after long absences",
    answer: "the migration routes of elephant herds", expect: "changed" },

  // ── reversed: 정반대 ──
  { id: "r1", target: "clause", stimulus: "the controllability of the production process",
    answer: "the production process cannot be controlled", expect: "reversed" },
  { id: "r2", target: "noun_phrase", stimulus: "natural ingredients vary greatly in their composition",
    answer: "the uniformity of natural ingredients", expect: "reversed" },

  // ── 형식을 못 바꾼 경우. 뜻은 같지만 목표 구조가 아니다.
  //    form 판정을 따로 재기 위한 케이스다 — meaning 만 재면 형식 오판이 안 보인다.
  { id: "f1", target: "clause", stimulus: "the controllability of the production process",
    answer: "the ability to control the production process", expect: "same", form: "noun_phrase" },
  { id: "f2", target: "noun_phrase", stimulus: "natural ingredients vary greatly",
    answer: "natural ingredients vary a lot", expect: "same", form: "clause" },
  // 원래 이 케이스를 same 으로 달았는데 틀렸다 — "food" 를 더하면 범위가 좁아진다.
  // 모델이 옳았고 라벨이 그른 경우다. 좁아짐 케이스로 옮겨 둔다.
  { id: "f3", target: "clause", stimulus: "the variability of natural ingredients",
    answer: "the variability of natural food ingredients", expect: "narrower", form: "noun_phrase" },
]

const dry = process.argv.includes("--dry")
if (dry) process.env.PARAPHRASE_FAKE_LLM = "1"

console.log(`[calibrate-type2] ${CASES.length}건 · ${dry ? "가짜 판정(무과금)" : "실 API 1콜"}`)

// 1단 구조 검사가 먼저 걸러 내는지도 같이 본다 — 여기서 떨어지면 유료 호출이 줄어든다
const structureFail = CASES.filter(
  (c) => checkStructure(c.answer, c.target).verdict === "fail",
)
if (structureFail.length) {
  console.log(`  구조에서 미리 걸러짐: ${structureFail.map((c) => c.id).join(", ")}`)
}

const verdicts = await judgeType2Batch(CASES)
if (verdicts.size === 0) {
  console.error("판정이 비었습니다 — GEMINI_API_KEY 와 네트워크를 확인하세요.")
  process.exit(1)
}

let ok = 0
const confusion = new Map()
console.log("\nid  기대        판정        form          일치")
for (const c of CASES) {
  const v = verdicts.get(c.id)
  const got = v?.meaning ?? "(없음)"
  const hit = got === c.expect
  if (hit) ok++
  confusion.set(`${c.expect}->${got}`, (confusion.get(`${c.expect}->${got}`) ?? 0) + 1)
  console.log(
    `${c.id.padEnd(3)} ${c.expect.padEnd(11)} ${String(got).padEnd(11)} ${String(v?.form ?? "-").padEnd(13)} ${hit ? "O" : "X"}`,
  )
  if (!hit && v) console.log(`     피드백: ${v.koreanFeedback}`)
}

const acc = (ok / CASES.length) * 100
console.log(`\n의미 라벨 일치 ${ok}/${CASES.length} (${acc.toFixed(1)}%)`)

// 형식 판정도 따로 잰다. 기대 form 은 명시가 없으면 목표 구조와 같다.
// 의미만 재면 형식 오판이 안 보이는데, 형식은 무료 구조 검사와 **경쟁 관계**라
// 어느 쪽을 믿을지 정하려면 둘 다 재야 한다.
let formOk = 0
const formMiss = []
for (const c of CASES) {
  const want = c.form ?? c.target
  const got = verdicts.get(c.id)?.form
  if (got === want) formOk++
  else formMiss.push(`${c.id}(${want}->${got})`)
}
console.log(`형식 판정 일치 ${formOk}/${CASES.length} (${((formOk / CASES.length) * 100).toFixed(1)}%)`)
if (formMiss.length) console.log("  형식 오판:", formMiss.join(" "))
console.log("  ※ 무료 구조 검사는 실측 95.9%(npm run typed:measure). 게다가 LLM 의 form 은")
console.log("     실행마다 흔들린다(같은 답안이 run 에 따라 clause/noun_phrase 로 갈렸다).")
console.log("     확신 있는 구조 판단을 우선하고 애매할 때만 LLM 을 쓰는 설계의 근거다.")

// 치명적 오류: 뒤집힌 답을 정답으로 부르는 것
const fatal = CASES.filter(
  (c) => c.expect === "reversed" && ["same", "narrower"].includes(verdicts.get(c.id)?.meaning),
)
console.log(`뒤집힌 답을 정답 계열로 부른 건수: ${fatal.length}${fatal.length ? " ← 치명적" : ""}`)

console.log("\n혼동:", [...confusion].filter(([k]) => k.split("->")[0] !== k.split("->")[1])
  .map(([k, n]) => `${k}×${n}`).join(" ") || "없음")

if (acc < 80 || fatal.length > 0) {
  console.error("\n[calibrate-type2] 기준 미달 — 프롬프트를 고쳐야 합니다.")
  process.exit(1)
}
console.log("\n[calibrate-type2] 통과")
