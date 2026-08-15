import { describe, expect, it } from "vitest"
import { checkStructure, findFiniteVerb } from "../structure"
import { scoreType2 } from "../type2"

describe("findFiniteVerb", () => {
  it("조동사·계사를 잡는다", () => {
    expect(findFiniteVerb("ingredients can be made in a controlled fashion").finite).toBe(true)
    expect(findFiniteVerb("they are socially tied").finite).toBe(true)
  })

  it("맨 명사구에는 정형동사가 없다", () => {
    for (const np of [
      "the controllability of the production process",
      "the strength of the social bond between the individuals",
      "the duration of the separation",
      "a precisely controlled fashion",
    ]) {
      expect(findFiniteVerb(np).finite, np).toBe(false)
    }
  })

  it("소유격 's 를 계사로 오인하지 않는다", () => {
    // "the importance of an individual's action" 이 절로 오인되던 실제 사례
    expect(findFiniteVerb("the importance of an individual's action").finite).toBe(false)
    expect(findFiniteVerb("the brain's visual system").finite).toBe(false)
    // 대명사 뒤라면 계사다
    expect(findFiniteVerb("it's a challenge of the data").finite).toBe(true)
  })

  it("곱슬 아포스트로피도 같은 낱말로 본다", () => {
    // 코퍼스의 아포스트로피는 U+2019 다. 곧은표만 처리하면 조용히 샌다.
    expect(findFiniteVerb("it’s like transforming yourself").finite).toBe(true)
    expect(findFiniteVerb("an individual’s action").finite).toBe(false)
  })

  it("to-부정사 뒤의 have/do 는 정형이 아니다", () => {
    expect(findFiniteVerb("the desire to do a job well").finite).toBe(false)
    expect(findFiniteVerb("the wish to have more time").finite).toBe(false)
  })

  it("관사 뒤의 과거분사는 수식어지 동사가 아니다", () => {
    expect(findFiniteVerb("a precisely controlled fashion").finite).toBe(false)
    expect(findFiniteVerb("the previously gained knowledge").finite).toBe(false)
  })
})

describe("checkStructure — 세 갈래", () => {
  it("명사구 목표는 즉결한다 (실측 100%)", () => {
    expect(checkStructure("the controllability of the process", "noun_phrase").verdict).toBe("pass")
    expect(checkStructure("the process can be controlled", "noun_phrase").verdict).toBe("fail")
  })

  it("절 목표에서 확신이 없으면 미룬다 — 잘못 떨어뜨리지 않는다", () => {
    // 실측에서 놓치는 부류(원형 동사, 목록에 없는 동사). fail 이 아니라 unclear 여야 한다.
    for (const ans of [
      "Children now learn from a picture book",
      "Scientists use paradigms rather than believing them",
    ]) {
      expect(checkStructure(ans, "clause").verdict, ans).not.toBe("fail")
    }
  })

  it("누가 봐도 맨 명사구면 절 목표에서 떨어뜨린다", () => {
    expect(checkStructure("the controllability of the production process", "clause").verdict).toBe("fail")
  })

  it("동사를 못 찾아도 명사구로 안 보이면 통과시키지 않는다", () => {
    // 절 판별은 95.5% 라 목록 밖 동사를 쓴 문장이 새어 나온다. 그걸 pass 로 확정하면
    // **접지 못한 학생에게 "이름으로 접었습니다"** 라고 말하게 된다 — 자습에서
    // 교사가 없으므로 회복되지 않는 오류다. 확신이 없으면 유료 판정에 미뤄야 한다.
    expect(checkStructure("natural ingredients vary a lot", "noun_phrase").verdict).toBe("unclear")
    expect(checkStructure("cargo bicycles convey much potential", "noun_phrase").verdict).toBe("unclear")
  })

  it("떨어뜨릴 때는 무엇이 문제인지 말한다", () => {
    const r = checkStructure("the process can be controlled precisely", "noun_phrase")
    expect(r.verdict).toBe("fail")
    expect(r.message).toContain("can")
  })
})

// ── 킬 기준: 상·중·하가 갈리는가 ──────────────────────────────
// 계획서의 M9 종료 조건이다. 셋이 비슷하면 변별력 0 이므로 설계를 되돌린다.
// 여기서는 **무료 구조 검사만으로** 어디까지 갈리는지를 본다.
const LEARNERS = {
  상: [
    // unfold: 이름을 문장으로 제대로 폈다
    { target: "clause", stimulus: "the controllability of the production process", answer: "the production process can be controlled precisely" },
    { target: "clause", stimulus: "the strength of the social bond", answer: "how strongly the two individuals are bonded" },
    { target: "clause", stimulus: "the duration of the separation", answer: "how long they had been apart" },
    // fold: 문장을 이름으로 제대로 접었다
    { target: "noun_phrase", stimulus: "natural ingredients often vary appreciably in their composition", answer: "the variability of natural ingredients" },
    { target: "noun_phrase", stimulus: "the brain adapts to science in time but not in space", answer: "the brain's temporal adaptation to science" },
  ],
  중: [
    { target: "clause", stimulus: "the controllability of the production process", answer: "the precise control of the production process" },
    { target: "clause", stimulus: "the strength of the social bond", answer: "the two individuals are closely bonded" },
    { target: "clause", stimulus: "the duration of the separation", answer: "the length of their time apart" },
    { target: "noun_phrase", stimulus: "natural ingredients often vary appreciably in their composition", answer: "natural ingredients vary a lot" },
    { target: "noun_phrase", stimulus: "the brain adapts to science in time but not in space", answer: "the brain's adaptation over time" },
  ],
  하: [
    // 구조를 전혀 바꾸지 못했다 — 자극을 그대로 옮기거나 방향을 반대로 했다
    { target: "clause", stimulus: "the controllability of the production process", answer: "the controllability of the production process" },
    { target: "clause", stimulus: "the strength of the social bond", answer: "the strength of the social bond" },
    { target: "clause", stimulus: "the duration of the separation", answer: "the duration of their separation" },
    { target: "noun_phrase", stimulus: "natural ingredients often vary appreciably in their composition", answer: "natural ingredients often vary appreciably in their composition" },
    { target: "noun_phrase", stimulus: "the brain adapts to science in time but not in space", answer: "the brain adapts to science in time but not in space" },
  ],
} as const

/**
 * 구조 검사는 세 갈래(pass / unclear / fail)라 통과율 하나로는 못 잰다.
 * 확신 있는 통과 1점, 미룸 0.5점, 확신 있는 실패 0점으로 등급을 매긴다.
 */
function profile(items: readonly { target: string; stimulus: string; answer: string }[]) {
  const rs = items.map((i) =>
    scoreType2({ answer: i.answer, stimulus: i.stimulus, target: i.target as "clause" | "noun_phrase" }),
  )
  const grade = (v: string) => (v === "pass" ? 1 : v === "unclear" ? 0.5 : 0)
  return {
    score: rs.reduce((a, r) => a + grade(r.structure), 0) / rs.length,
    confidentFail: rs.filter((r) => r.structure === "fail").length / rs.length,
    paid: rs.filter((r) => r.needsVerdict).length / rs.length,
    verbatim: rs.filter((r) => r.flags.includes("verbatim")).length / rs.length,
  }
}

describe("킬 기준 — 무료 구조 검사만으로 상·중·하가 갈리는가", () => {
  const hi = profile(LEARNERS.상)
  const mid = profile(LEARNERS.중)
  const lo = profile(LEARNERS.하)

  it("세 수준이 순서대로 갈린다", () => {
    expect(hi.score).toBeGreaterThan(mid.score)
    expect(mid.score).toBeGreaterThan(lo.score)
  })

  it("간격이 우연이라 하기 어려울 만큼 벌어진다", () => {
    // 셋이 비슷하면 변별력 0 이므로 설계를 되돌려야 한다.
    expect(hi.score - lo.score).toBeGreaterThanOrEqual(0.6)
  })

  it("상은 확신 있는 실패가 없고, 하는 절반 이상이 확신 있는 실패다", () => {
    expect(hi.confidentFail).toBe(0)
    expect(lo.confidentFail).toBeGreaterThanOrEqual(0.5)
  })

  it("하는 유료 판정을 덜 부른다 — 비용 절감이 실제로 일어난다", () => {
    expect(lo.paid).toBeLessThan(hi.paid)
    expect(lo.paid).toBeLessThanOrEqual(0.5)
  })

  it("자극을 그대로 옮긴 답안은 표시된다", () => {
    expect(lo.verbatim).toBeGreaterThan(0.5)
    expect(hi.verbatim).toBe(0)
  })
})

// ── 2단 결합: 구조 + 의미 판정 ────────────────────────────────
import { finalizeType2, MEANING_SCORE } from "../type2"
import type { Type2Verdict } from "../verdict2"

const v = (over: Partial<Type2Verdict>): Type2Verdict => ({
  id: "x", form: "clause", meaning: "same", koreanFeedback: "", suggested: "", ...over,
})

describe("finalizeType2", () => {
  const unfold = { answer: "", stimulus: "the controllability of the process", target: "clause" as const }

  it("구조에서 떨어지면 유료 판정을 쓰지 않는다", () => {
    const input = { ...unfold, answer: "the controllability of the process" }
    const r = finalizeType2(input, scoreType2(input), null)
    expect(r.score).toBe(0)
    expect(r.judged).toBe(false)
    expect(r.errorName).toBe("구조를 바꾸지 않음")
  })

  it("판정을 못 받으면 통과도 실패도 시키지 않는다", () => {
    const input = { ...unfold, answer: "the process can be controlled" }
    const r = finalizeType2(input, scoreType2(input), null)
    expect(r.score).toBe(50)
    expect(r.flags).toContain("verdict-missing")
  })

  it("의미 갈래가 그대로 오답의 이름이 된다", () => {
    const input = { ...unfold, answer: "the process cannot be controlled" }
    const r = finalizeType2(input, scoreType2(input), v({ meaning: "reversed" }))
    expect(r.score).toBe(MEANING_SCORE.reversed)
    expect(r.errorName).toBe("뜻은 맞는데 방향이 반대")
  })

  it("좁아진 답은 부분 점수를 받는다", () => {
    const input = { ...unfold, answer: "the process can be controlled" }
    const r = finalizeType2(input, scoreType2(input), v({ meaning: "narrower" }))
    expect(r.score).toBe(MEANING_SCORE.narrower)
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThan(MEANING_SCORE.same)
  })

  it("구조 검사가 미룬 것만 LLM 의 form 이 심판한다", () => {
    // "vary" 는 목록 밖이라 구조 검사가 미룬다(unclear). 이때는 LLM 을 따른다.
    const input = { answer: "natural ingredients vary a lot", stimulus: "s", target: "noun_phrase" as const }
    expect(scoreType2(input).structure).toBe("unclear")
    const r = finalizeType2(input, scoreType2(input), v({ form: "clause", meaning: "same" }))
    expect(r.score).toBe(0)
    expect(r.errorName).toBe("구조를 바꾸지 않음")
  })

  it("구조 검사가 확신했으면 LLM 의 form 이 달라도 뒤집지 않는다", () => {
    // 실측: 무료 구조 검사 95.9% vs LLM form 은 실행마다 흔들린다.
    // 확신 있는 판단을 LLM 이 덮으면 정확도가 내려간다 — 이 순서를 고정한다.
    const input = { ...unfold, answer: "the process can be controlled" }
    expect(scoreType2(input).structure).toBe("pass")
    const r = finalizeType2(input, scoreType2(input), v({ form: "noun_phrase", meaning: "same" }))
    expect(r.score).toBe(MEANING_SCORE.same)
    expect(r.errorName).toBeNull()
  })
})
