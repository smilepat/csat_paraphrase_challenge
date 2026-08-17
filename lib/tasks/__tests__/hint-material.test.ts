import { describe, expect, it } from "vitest"
import { formAgreesWithExample } from "../hint-material"

// 3칸(어형)과 4칸(예시)이 어긋나면 학생은 둘 중 무엇을 믿어야 할지 모른다(실측 26%).
// 이 검사는 **지어낸 낱말**도 같이 막는다 — 존재하지 않는 어형은 자연스러운
// 예시 문장에 나타날 수가 없기 때문이다.
describe("formAgreesWithExample", () => {
  it("어형이 예시에 쓰였으면 통과한다", () => {
    expect(formAgreesWithExample("vary → variability", "the variability of natural ingredients")).toBe(true)
    expect(formAgreesWithExample("centrality → central", "this way of thought is central")).toBe(true)
  })

  it("굴절 꼬리는 봐준다", () => {
    // "evolve" 를 예시가 "evolved" 로 쓰는 것은 어긋난 것이 아니다
    expect(formAgreesWithExample("evolution → evolve", "science evolved over time")).toBe(true)
  })

  it("둘 중 하나만 쓰여도 통과한다", () => {
    expect(
      formAgreesWithExample("size, complexity → large, complex", "human populations were large"),
    ).toBe(true)
  })

  it("지어낸 낱말은 예시에 나타날 수 없으므로 걸린다", () => {
    // 실제로 생성된 것 — "unmovedness" 는 영어에 없다
    expect(
      formAgreesWithExample("unmoved → unmovedness", "the state of some people remaining unaffected"),
    ).toBe(false)
  })

  it("예시가 다른 낱말을 쓰면 걸린다", () => {
    expect(formAgreesWithExample("adds → addition", "the incorporation of interactive features")).toBe(false)
    expect(formAgreesWithExample("become larger → enlargement", "the expansion of communities")).toBe(false)
  })

  it("예시가 없으면 어형을 믿을 근거가 없다", () => {
    expect(formAgreesWithExample("vary → variability", "")).toBe(false)
  })
})
