import { describe, expect, it } from "vitest"
import { axisWeights, daysBetween, dueInterval, isDue, pickNext, pickSession, type TaskCandidate } from "../pick"
import { threeAxisProfile, type AttemptRow } from "../history"

const t = (id: string, type: 1 | 2 | 3, over: Partial<TaskCandidate> = {}): TaskCandidate =>
  ({ id, type, lastSeenDay: null, lastScore: null, seenCount: 0, ...over })
const a = (type: 1 | 2 | 3, score: number): AttemptRow =>
  ({ type, score, day: "2026-08-10", errorName: null })

const TODAY = "2026-08-15"

describe("간격 반복", () => {
  it("못 푼 것은 다음 날 다시 온다", () => {
    expect(dueInterval(0, 1)).toBe(1)
    expect(dueInterval(30, 3)).toBe(1)
  })

  it("잘한 것은 볼수록 뜸해지되 영영 사라지지는 않는다", () => {
    expect(dueInterval(100, 1)).toBe(3)
    expect(dueInterval(100, 2)).toBe(6)
    expect(dueInterval(100, 99)).toBe(30) // 상한
  })

  it("한 번도 안 본 것은 항상 대상이다", () => {
    expect(isDue(t("x", 1), TODAY)).toBe(true)
  })

  it("아직 간격이 안 찼으면 대상이 아니다", () => {
    expect(isDue(t("x", 1, { lastSeenDay: "2026-08-14", lastScore: 100, seenCount: 2 }), TODAY)).toBe(false)
  })
})

describe("축 가중치", () => {
  it("약한 축이 더 무겁다", () => {
    const w = axisWeights(threeAxisProfile([a(1, 90), a(2, 20)]))
    expect(w.get(2)!).toBeGreaterThan(w.get(1)!)
  })

  it("아직 안 재본 축은 가장 무겁다 — 모르면 재보는 것이 먼저다", () => {
    // 유형 3 은 M13 전까지 시도가 없다. 이때 "차이 없음"으로 두면 영영 안 나온다.
    const w = axisWeights(threeAxisProfile([a(1, 100), a(2, 100)]), 2)
    expect(w.get(3)!).toBeGreaterThan(w.get(1)!)
  })
})

describe("pickNext", () => {
  it("약한 축을 먼저 준다", () => {
    const profile = threeAxisProfile([a(1, 95), a(2, 10)])
    const picked = pickNext([t("A", 1), t("B", 2)], profile, { today: TODAY })
    expect(picked!.task.type).toBe(2)
  })

  it("같은 상태면 같은 결과 — 무작위를 쓰지 않는다", () => {
    const profile = threeAxisProfile([a(1, 50), a(2, 50)])
    const pool = [t("A", 1), t("B", 2), t("C", 1)]
    const one = pickNext(pool, profile, { today: TODAY })
    const two = pickNext([...pool].reverse(), profile, { today: TODAY })
    expect(one!.task.id).toBe(two!.task.id)
  })

  it("왜 이 문항인지 말해 준다", () => {
    const profile = threeAxisProfile([a(1, 95), a(2, 10)])
    const p = pickNext([t("B", 2)], profile, { today: TODAY })
    expect(p!.reason).toContain("유형 2")
  })

  it("복습할 것이 없어도 빈손으로 돌려보내지 않는다", () => {
    const profile = threeAxisProfile([a(1, 100)])
    const notDue = t("A", 1, { lastSeenDay: "2026-08-14", lastScore: 100, seenCount: 3 })
    expect(pickNext([notDue], profile, { today: TODAY })).not.toBeNull()
  })

  it("후보가 없으면 null 이다", () => {
    expect(pickNext([], threeAxisProfile([]), { today: TODAY })).toBeNull()
  })
})

describe("pickSession", () => {
  it("한 세션에 같은 문항을 두 번 넣지 않는다", () => {
    const profile = threeAxisProfile([a(1, 40), a(2, 40)])
    const pool = [t("A", 1), t("B", 2), t("C", 1), t("D", 2)]
    const s = pickSession(pool, profile, { today: TODAY, size: 4 })
    expect(new Set(s.map((x) => x.task.id)).size).toBe(4)
  })

  it("후보보다 많이 달라고 해도 있는 만큼만 준다", () => {
    const profile = threeAxisProfile([a(1, 40)])
    expect(pickSession([t("A", 1)], profile, { today: TODAY, size: 5 })).toHaveLength(1)
  })

  it("약한 축이 세션에서 더 많이 나온다", () => {
    const profile = threeAxisProfile([a(1, 95), a(2, 5)])
    const pool = [t("A1", 1), t("A2", 1), t("A3", 1), t("B1", 2), t("B2", 2), t("B3", 2)]
    const s = pickSession(pool, profile, { today: TODAY, size: 4 })
    const t2 = s.filter((x) => x.task.type === 2).length
    expect(t2).toBeGreaterThan(s.length - t2)
  })
})

describe("daysBetween", () => {
  it("월을 넘어가도 센다", () => {
    expect(daysBetween("2026-07-30", "2026-08-02")).toBe(3)
  })
})
