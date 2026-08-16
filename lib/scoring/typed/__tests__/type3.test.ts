import { describe, expect, it } from "vitest"
import { checkSpan, finalizeType3, overlap, spanScore, TYPE3 } from "../type3"

// 2025·40 의 실제 배치: 다섯 항목을 나열한 문장을 "These variations" 가 받는다.
const GOLD = { start: 100, end: 300 }
const STIM = 400

describe("overlap", () => {
  it("같으면 1, 안 겹치면 0", () => {
    expect(overlap(GOLD, GOLD)).toBe(1)
    expect(overlap({ start: 0, end: 50 }, GOLD)).toBe(0)
  })
})

describe("checkSpan — 경계가 먼저다", () => {
  it("정확히 잡으면 맞힌 것", () => {
    const r = checkSpan({ answer: GOLD, gold: GOLD, stimulusStart: STIM })
    expect(r.verdict).toBe("hit")
    expect(r.nameWorthJudging).toBe(true)
  })

  it("되받는 표현보다 뒤를 가리키면 방향이 틀린 것 — 겹침을 재기 전에 말해 준다", () => {
    const r = checkSpan({ answer: { start: 410, end: 480 }, gold: GOLD, stimulusStart: STIM })
    expect(r.verdict).toBe("invalid")
    expect(r.message).toContain("앞")
    // 범위가 틀렸으면 이름은 채점하지 않는다 — 유료 호출을 아끼는 자리이기도 하다
    expect(r.nameWorthJudging).toBe(false)
  })

  it("범위가 짧은지 넓은지를 구분해 말해 준다", () => {
    const short = checkSpan({ answer: { start: 200, end: 300 }, gold: GOLD, stimulusStart: STIM })
    expect(short.verdict).toBe("partial")
    expect(short.message).toContain("짧습니다")
    expect(short.nameWorthJudging).toBe(false)

    // 겹침이 0.6 아래로 떨어지려면 합집합이 gold 길이의 1.67배를 넘어야 한다.
    // 처음엔 {20,310} 을 썼는데 IoU 0.69 라 hit 이 나왔다 — 픽스처가 약했다.
    const wide = checkSpan({ answer: { start: 0, end: 380 }, gold: GOLD, stimulusStart: STIM })
    expect(wide.verdict).toBe("partial")
    expect(wide.message).toContain("넓습니다")
  })

  it("다른 곳을 가리키면 이름을 채점하지 않는다", () => {
    const r = checkSpan({ answer: { start: 0, end: 60 }, gold: GOLD, stimulusStart: STIM })
    expect(r.verdict).toBe("miss")
    expect(r.nameWorthJudging).toBe(false)
  })
})

describe("finalizeType3", () => {
  it("범위를 못 찾으면 0 이고 이름은 보지 않는다", () => {
    const free = checkSpan({ answer: { start: 0, end: 60 }, gold: GOLD, stimulusStart: STIM })
    const f = finalizeType3(free, true)
    expect(f.score).toBe(0)
    expect(f.parts.name).toBeNull()
  })

  it("경계가 어긋나면 부분 점수", () => {
    const free = checkSpan({ answer: { start: 200, end: 300 }, gold: GOLD, stimulusStart: STIM })
    const f = finalizeType3(free, null)
    expect(f.score).toBeGreaterThan(0)
    expect(f.score).toBeLessThan(100)
    expect(f.errorName).toBe("범위 경계가 어긋남")
  })

  it("범위가 맞고 이름 판정이 없으면 범위만으로 만점", () => {
    const free = checkSpan({ answer: GOLD, gold: GOLD, stimulusStart: STIM })
    expect(finalizeType3(free, null).score).toBe(100)
  })

  it("범위는 맞고 이름이 어긋나면 감점하되 0 은 아니다", () => {
    const free = checkSpan({ answer: GOLD, gold: GOLD, stimulusStart: STIM })
    const f = finalizeType3(free, false)
    expect(f.score).toBe(70)
    expect(f.errorName).toContain("이름")
  })
})

describe("spanScore", () => {
  it("문턱 위는 1, 아래는 0", () => {
    expect(spanScore(TYPE3.hit)).toBe(1)
    expect(spanScore(TYPE3.miss)).toBe(0)
    expect(spanScore(1)).toBe(1)
  })
})
