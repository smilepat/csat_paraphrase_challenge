import { describe, expect, it } from "vitest"
import { avoidanceScore, checkAvoidance, TYPE1 } from "../type1"

const base = { stimulus: "natural ingredients often vary appreciably in their composition" }
const AVOID = ["natural", "ingredients", "vary", "appreciably", "composition"]

describe("checkAvoidance", () => {
  it("자극을 그대로 옮기면 무료 단계에서 떨어진다 — 유료 판정을 안 부른다", () => {
    const r = checkAvoidance({ ...base, answer: base.stimulus, avoidWords: AVOID })
    expect(r.fail).toBe(true)
    expect(r.avoidance).toBe(0)
  })

  it("다른 낱말로 말하면 통과한다", () => {
    const r = checkAvoidance({
      ...base,
      answer: "raw materials from the earth differ a great deal in what they contain",
      avoidWords: AVOID,
    })
    expect(r.fail).toBe(false)
    expect(r.avoidance).toBe(1)
  })

  it("굴절형으로 바꾼 것은 회피가 아니다", () => {
    // "vary" 를 "varies" 로 쓰는 건 다른 낱말로 말한 게 아니라 같은 낱말을 굴린 것이다.
    const r = checkAvoidance({
      ...base,
      answer: "natural ingredient varies in composition",
      avoidWords: AVOID,
    })
    expect(r.reused).toContain("vary")
    expect(r.reused).toContain("ingredients")
    expect(r.fail).toBe(true)
  })

  it("어떤 낱말이 남았는지 이름을 대준다 — 교사가 없으니 이 문구가 지도다", () => {
    const r = checkAvoidance({
      ...base,
      answer: "natural things differ in what they hold inside them mostly",
      avoidWords: AVOID,
    })
    expect(r.message).toContain("natural")
  })

  it("금지어 목록이 비면 자극에서 만들어 쓴다", () => {
    const r = checkAvoidance({ ...base, answer: base.stimulus, avoidWords: [] })
    expect(r.fail).toBe(true)
  })
})

describe("avoidanceScore", () => {
  it("문턱 아래는 0, 위는 1, 사이는 선형이다", () => {
    expect(avoidanceScore(TYPE1.minAvoidance)).toBe(0)
    expect(avoidanceScore(TYPE1.fullAvoidance)).toBe(1)
    expect(avoidanceScore(1)).toBe(1)
    const mid = avoidanceScore((TYPE1.minAvoidance + TYPE1.fullAvoidance) / 2)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it("기능어까지 다 바꾸라고 요구하지 않는다", () => {
    // 0.8 이면 만점 — 다섯 중 하나가 남아도 통과다
    expect(avoidanceScore(0.8)).toBe(1)
  })
})

// ── 2단 결합 ────────────────────────────────────────────────
import { finalizeType1 } from "../type1"
import type { Type1Verdict } from "../verdict1"

const v = (over: Partial<Type1Verdict>): Type1Verdict =>
  ({ id: "x", meaning: "same", reworded: true, koreanFeedback: "", suggested: "", ...over })

const freeOf = (answer: string) =>
  checkAvoidance({ ...base, answer, avoidWords: AVOID })

describe("finalizeType1 — 의미 × 회피", () => {
  const good = "raw materials from the earth differ a great deal in what they hold"

  it("둘 다 좋으면 만점", () => {
    expect(finalizeType1(freeOf(good), v({})).score).toBe(100)
  })

  it("낱말만 바꾸고 뜻이 달라지면 거의 0 이다 — 합이 아니라 곱이기 때문", () => {
    // 합(50×의미 + 50×회피)이면 회피 만점만으로 60점을 가져간다.
    // 그게 학생이 가장 많이 하는 실패이므로 반드시 곱이어야 한다.
    const r = finalizeType1(freeOf(good), v({ meaning: "changed" }))
    expect(r.score).toBeLessThan(40)
    expect(r.errorName).toBe("비슷하지만 다른 말")
  })

  it("뒤집힌 답은 회피가 완벽해도 0 이다", () => {
    expect(finalizeType1(freeOf(good), v({ meaning: "reversed" })).score).toBe(0)
  })

  it("무료 단계에서 떨어지면 유료 판정을 쓰지 않는다", () => {
    const r = finalizeType1(freeOf(base.stimulus), null)
    expect(r.score).toBe(0)
    expect(r.judged).toBe(false)
    expect(r.errorName).toBe("원문 단어를 아직 안 바꿈")
  })

  it("어간은 피했지만 판정이 '옮긴 것'으로 보면 0 이다", () => {
    // 무료 검사는 어간만 본다. 동의어를 그대로 옮긴 수준은 판정이 잡는다.
    const r = finalizeType1(freeOf(good), v({ reworded: false }))
    expect(r.score).toBe(0)
    expect(r.errorName).toBe("원문 단어를 아직 안 바꿈")
  })

  it("판정을 못 받으면 통과도 실패도 시키지 않는다", () => {
    const r = finalizeType1(freeOf(good), null)
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThan(100)
    expect(r.judged).toBe(false)
  })
})
