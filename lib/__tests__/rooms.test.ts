import { describe, expect, it } from "vitest"
import { canTransition, countsTowardScore, isNewRound, reviewState } from "../rooms"

describe("reviewState", () => {
  const clean = { needsReview: false }
  const flagged = { needsReview: true }

  it("플래그 없으면 바로 반영된다", () => {
    expect(reviewState(clean, null)).toBe("counted")
    expect(countsTowardScore(clean, null)).toBe(true)
  })

  it("플래그가 붙었고 교사가 아직 안 봤으면 보류", () => {
    expect(reviewState(flagged, null)).toBe("pending")
    expect(countsTowardScore(flagged, null)).toBe(false)
  })

  it("교사가 인정하면 반영된다", () => {
    expect(reviewState(flagged, 1)).toBe("counted")
    expect(countsTowardScore(flagged, 1)).toBe(true)
  })

  it("교사가 기각하면 제외된다", () => {
    expect(reviewState(flagged, 0)).toBe("rejected")
    expect(reviewState(clean, 0)).toBe("rejected")
    expect(countsTowardScore(clean, 0)).toBe(false)
  })

  it("아직 채점되지 않은 제출은 보류", () => {
    expect(reviewState(null, null)).toBe("pending")
  })
})

describe("방 상태 전이", () => {
  it("허용된 전이만 통과한다", () => {
    expect(canTransition("lobby", "writing")).toBe(true)
    expect(canTransition("writing", "scoring")).toBe(true)
    expect(canTransition("review", "lobby")).toBe(true)
    expect(canTransition("lobby", "review")).toBe(false)
    expect(canTransition("closed", "lobby")).toBe(false)
  })

  it("review → lobby 만 새 라운드를 연다", () => {
    expect(isNewRound("review", "lobby")).toBe(true)
    expect(isNewRound("writing", "lobby")).toBe(false)
  })
})
