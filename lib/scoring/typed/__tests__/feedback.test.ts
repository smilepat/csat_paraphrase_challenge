import { describe, expect, it } from "vitest"
import { meaningFeedback, notRewordedFeedback, structureFeedback } from "../feedback"

describe("meaningFeedback — 인정 + 팁", () => {
  it("잘한 점을 먼저 말하고 그다음 무엇을 할지 말한다", () => {
    const m = meaningFeedback("narrower")
    expect(m).toContain("적절한 내용이지만")   // 인정
    expect(m).toContain("보세요")               // 행동 지시
  })

  it("진단명만 던지지 않는다", () => {
    for (const k of ["narrower", "broader", "changed", "reversed"] as const) {
      const m = meaningFeedback(k)
      // 예전에는 "비슷하지만 다른 말" 같은 진단명 하나가 그대로 나갔다
      expect(m.length).toBeGreaterThan(20)
      expect(m).toMatch(/보세요|습니다/)
    }
  })

  it("판정이 준 구체적 조언은 팁 자리에 들어간다", () => {
    const m = meaningFeedback("changed", "핵심어 'memories' 를 다시 확인해 보세요.")
    expect(m).toContain("시도는 좋습니다")       // 인정은 유지
    expect(m).toContain("memories")              // 구체적 조언이 살아 있다
  })

  it("맞았을 때는 군더더기를 붙이지 않는다 — 판정이 팁을 줘도 버린다", () => {
    expect(meaningFeedback("same")).toBe("원문의 뜻을 그대로 옮겼습니다.")
    // 정답을 받은 학생에게 "더 찾아보세요" 는 잡음이다
    expect(meaningFeedback("same", "다른 유사한 단어를 더 찾아보세요."))
      .toBe("원문의 뜻을 그대로 옮겼습니다.")
  })

  it("뒤집힌 답에도 잘한 점을 먼저 말한다", () => {
    const m = meaningFeedback("reversed")
    expect(m.startsWith("표현을 바꾸는 것 자체는")).toBe(true)
  })
})

describe("notRewordedFeedback", () => {
  it("남은 단어를 다 나열하지 않고 하나만 먼저 바꾸라고 한다", () => {
    const m = notRewordedFeedback(["natural", "ingredients", "vary", "composition"])
    expect(m).toContain("하나만 먼저")
    expect(m).not.toContain("composition") // 네 번째는 자른다
  })

  it("아무것도 안 썼을 때도 비난하지 않는다", () => {
    expect(notRewordedFeedback([])).toContain("정확히 찾았습니다")
  })
})

describe("structureFeedback", () => {
  it("뜻은 담았다는 인정으로 시작한다", () => {
    expect(structureFeedback("noun_phrase", "vary")).toContain("뜻은 잘 담았습니다")
    expect(structureFeedback("noun_phrase", "vary")).toContain("vary")
    expect(structureFeedback("clause", null)).toContain("주어와 동사")
  })
})
