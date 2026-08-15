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
