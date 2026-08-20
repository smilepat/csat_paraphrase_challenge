// ============================================================
// 남긴 낱말을 **개수**로 깎는다 (§50).
//
// 비율로 재던 시절에는 목록이 짧은 문항일수록 낱말 하나가 무거웠다.
// 승인된 유형 1 의 82% 가 피할 낱말 2개라, 뜻을 정확히 옮기고 낱말 하나를 남긴
// 답이 35점을 받았다. 3개짜리 문항이면 같은 답이 71점 — 학생이 한 일은 같은데
// 점수가 문항 사정으로 갈렸다.
//
// 이 앱은 판정보다 학습을 권한다. 그래서 뜻이 중심이고, 남긴 낱말은 하나당
// 같은 무게로만 깎으며, 바닥이 있다. 다만 **아무것도 안 바꾼 답은 그대로 0** 이다.
// ============================================================

import { describe, expect, it } from "vitest"
import { avoidanceFactor, checkAvoidance, finalizeType1, TYPE1_KEEP } from "../type1"
import type { Type1Verdict } from "../verdict1"

const perfect: Type1Verdict = {
  id: "x",
  meaning: "same",
  reworded: true,
  koreanFeedback: "",
  suggested: "",
}

/** 피할 낱말 n 개 중 kept 개를 그대로 남긴 답안을 만든다. */
function attempt(avoid: string[], kept: number) {
  const stimulus = avoid.join(" ")
  const answer = [...avoid.slice(0, kept), ...avoid.slice(kept).map(() => "elsewhere")].join(" ")
  return checkAvoidance({ stimulus, answer, avoidWords: avoid })
}

const WORDS = (n: number) => ["alpha", "bravo", "charlie", "delta"].slice(0, n)

describe("avoidanceFactor", () => {
  it("하나도 안 남기면 깎지 않는다", () => {
    expect(avoidanceFactor(0)).toBe(1)
  })

  it("남긴 낱말 하나당 같은 무게로 깎는다", () => {
    expect(avoidanceFactor(1)).toBeCloseTo(1 - TYPE1_KEEP.penaltyPerWord)
    expect(avoidanceFactor(2)).toBeCloseTo(1 - 2 * TYPE1_KEEP.penaltyPerWord)
  })

  it("바닥 아래로는 내려가지 않는다 — 뜻을 옮긴 것은 그 자체로 절반 이상의 일이다", () => {
    expect(avoidanceFactor(9)).toBe(TYPE1_KEEP.floor)
  })
})

describe("finalizeType1 — 문항 길이에 점수가 휘둘리지 않는다", () => {
  it("뜻이 완벽하고 다 바꿨으면 길이와 무관하게 100점", () => {
    for (const n of [2, 3, 4]) {
      expect(finalizeType1(attempt(WORDS(n), 0), perfect).score).toBe(100)
    }
  })

  it("낱말 하나를 남긴 답은 피할 낱말이 2개든 4개든 같은 점수다", () => {
    // 예전: 2개짜리 35점 · 3개짜리 71점 · 4개짜리 89점
    const scores = [3, 4].map((n) => finalizeType1(attempt(WORDS(n), 1), perfect).score)
    expect(new Set(scores).size).toBe(1)
    expect(scores[0]).toBe(80)
  })

  it("남긴 낱말은 감점 사유가 아니라 다음 할 일로 보여 준다", () => {
    const r = finalizeType1(attempt(WORDS(4), 1), perfect)
    expect(r.message).toContain("아직 원문 그대로인 낱말")
    expect(r.message).toContain("alpha")
    expect(r.message).toContain("만점")
  })

  it("아무것도 안 바꾼 답은 여전히 0 이다 — 과제를 안 한 것이다", () => {
    const free = attempt(WORDS(3), 3)
    expect(free.fail).toBe(true)
    const r = finalizeType1(free, null)
    expect(r.score).toBe(0)
    expect(r.errorName).toBe("원문 표현 그대로")
  })

  it("뜻이 틀리면 낱말을 다 바꿔도 낮다 — 곱이지 합이 아니다", () => {
    const r = finalizeType1(attempt(WORDS(3), 0), { ...perfect, meaning: "changed" })
    expect(r.score).toBeLessThan(40)
  })
})
