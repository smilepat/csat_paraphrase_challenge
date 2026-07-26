import { describe, expect, it } from "vitest"
import freqJson from "../../../data/freq-rank.json"
import { auditPassage, auditSeverity } from "../audit"

const freq = freqJson as Record<string, number>

const BODY =
  "Learning quickly often looks impressive, but speed can hide an important weakness. " +
  "When a guide tells travelers every turn, they may reach their destination faster and " +
  "make fewer mistakes. However, people who always depend on guidance may fail to develop " +
  "a strong sense of direction."

const GOOD = {
  body: BODY,
  propositions: [
    "Fast learning looks impressive but can hide a real weakness.",
    "Constant guidance helps people avoid errors in the short term.",
    "Depending on help stops learners building their own sense of direction.",
  ],
  modelAnswers: [
    "Fast help avoids errors, but it stops people learning to find their own way.",
    "Quick guidance works now, yet learners never build their own sense of direction.",
  ],
  freq,
}

describe("auditPassage", () => {
  it("잘 만들어진 지문은 경고가 없다", () => {
    expect(auditPassage(GOOD)).toEqual([])
    expect(auditSeverity(auditPassage(GOOD))).toBe("clean")
  })

  it("명제가 원문 발췌면 경고한다", () => {
    const issues = auditPassage({
      ...GOOD,
      propositions: [
        "When a guide tells travelers every turn, they may reach their destination faster.",
        ...GOOD.propositions.slice(1),
      ],
    })
    expect(issues.some((i) => /원문을 \d+단어 연속으로 그대로/.test(i.message))).toBe(true)
  })

  it("명제가 3개 미만이면 error", () => {
    const issues = auditPassage({ ...GOOD, propositions: GOOD.propositions.slice(0, 2) })
    expect(auditSeverity(issues)).toBe("error")
  })

  it("서로 같은 말인 명제를 잡는다", () => {
    const dup = "Fast learning looks impressive but can hide a real weakness."
    const issues = auditPassage({ ...GOOD, propositions: [dup, dup, GOOD.propositions[2]] })
    expect(issues.some((i) => /거의 같은 말/.test(i.message))).toBe(true)
  })

  it("목표를 크게 넘는 모범 답안은 error", () => {
    const issues = auditPassage({
      ...GOOD,
      modelAnswers: [BODY, GOOD.modelAnswers[1]],
      targetWords: 25,
    })
    expect(auditSeverity(issues)).toBe("error")
  })

  it("어려운 어휘로 쓴 모범 답안을 경고한다", () => {
    const issues = auditPassage({
      ...GOOD,
      modelAnswers: [
        "Pedagogical scaffolding attenuates metacognitive autonomy among adolescent cohorts.",
        GOOD.modelAnswers[1],
      ],
    })
    expect(issues.some((i) => /어휘가 어렵습니다/.test(i.message))).toBe(true)
  })

  it("모범 답안이 전부 비슷하면 경고한다", () => {
    const issues = auditPassage({
      ...GOOD,
      modelAnswers: [
        "Fast help avoids errors but stops people learning their own way.",
        "Fast help avoids errors, but it stops people learning their own way.",
      ],
    })
    expect(issues.some((i) => /서로 너무 비슷/.test(i.message))).toBe(true)
  })
})
