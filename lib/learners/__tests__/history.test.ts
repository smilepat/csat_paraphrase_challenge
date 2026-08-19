import { describe, expect, it } from "vitest"
import {
  axisHistory,
  axisSeparation,
  axisSummary,
  errorDistribution,
  threeAxisProfile,
  weakestAxis,
  type AttemptRow,
} from "../history"

const a = (type: 1 | 2 | 3, day: string, score: number | null, errorName: string | null = null): AttemptRow =>
  ({ type, day, score, errorName })

describe("axisHistory", () => {
  it("일별로 묶고 날짜순으로 준다", () => {
    const h = axisHistory([a(1, "2026-08-12", 80), a(1, "2026-08-10", 40), a(1, "2026-08-10", 60)], 1)
    expect(h.map((p) => p.day)).toEqual(["2026-08-10", "2026-08-12"])
    expect(h[0].mean).toBe(50)
    expect(h[0].n).toBe(2)
  })

  it("다른 축과 채점 전 시도는 섞지 않는다", () => {
    const h = axisHistory([a(1, "d1", 100), a(2, "d1", 0), a(1, "d1", null)], 1)
    expect(h[0].mean).toBe(100)
    expect(h[0].n).toBe(1)
  })
})

describe("axisSummary — 추세", () => {
  it("표본이 적으면 추세를 말하지 않는다", () => {
    const rows = [a(1, "d1", 10), a(1, "d2", 90)]
    expect(axisSummary(rows, 1).trend).toBeNull()
  })

  it("시도가 많아도 날짜가 적으면 추세를 말하지 않는다", () => {
    // 가드는 **날짜 수**로 걸어야 한다. 시도 수로 걸면 하루에 몰아친 학습자에게
    // 이틀치로 만든 가짜 추세를 보여주게 된다.
    const rows = [
      a(1, "d1", 10), a(1, "d1", 20), a(1, "d1", 30),
      a(1, "d2", 80), a(1, "d2", 90),
    ]
    expect(axisSummary(rows, 1).trend).toBeNull()
  })

  it("추세는 시도가 아니라 일 단위 곡선으로 잰다", () => {
    // 첫날에 낮은 점수를 몰아친 학습자. 시도 단위로 자르면 첫날이 앞 절반을
    // 통째로 차지해 실제보다 큰 상승으로 보인다.
    const rows = [
      a(1, "d1", 0), a(1, "d1", 0), a(1, "d1", 0), a(1, "d1", 0), a(1, "d1", 0),
      a(1, "d2", 40), a(1, "d3", 60), a(1, "d4", 80),
    ]
    const t = axisSummary(rows, 1).trend
    // 일 단위: 앞 2일 (0, 40) = 20 → 뒤 2일 (60, 80) = 70 → +50
    expect(t).toBe(50)
  })
})

describe("axisSeparation — 킬 기준의 계산식", () => {
  it("축이 갈리면 간격이 크다", () => {
    const rows = [a(1, "d1", 90), a(2, "d1", 20)]
    expect(axisSeparation(threeAxisProfile(rows))).toBe(70)
  })

  it("축이 같이 움직이면 간격이 0 에 가깝다", () => {
    const rows = [a(1, "d1", 50), a(2, "d1", 50), a(3, "d1", 50)]
    expect(axisSeparation(threeAxisProfile(rows))).toBe(0)
  })

  it("값 있는 축이 하나뿐이면 0 이 아니라 판정 불가다", () => {
    // 값이 없는 축을 "차이 없음"으로 세면 킬 기준이 **거짓 통과**한다.
    // 세 축 채점기가 다 있는 지금도 마주친다 — 아직 그 유형을 안 해 본 학습자다.
    const rows = [a(1, "d1", 70), a(1, "d2", 80)]
    expect(axisSeparation(threeAxisProfile(rows))).toBeNull()
  })
})

describe("weakestAxis", () => {
  it("점수가 있는 축 중에서만 고른다", () => {
    const rows = [a(1, "d1", 80), a(2, "d1", 30)]
    expect(weakestAxis(threeAxisProfile(rows))).toBe(2)
  })

  it("아무것도 채점되지 않았으면 고르지 않는다", () => {
    expect(weakestAxis(threeAxisProfile([a(1, "d1", null)]))).toBeNull()
  })
})

describe("errorDistribution", () => {
  it("많은 순으로 주고 비율을 함께 낸다", () => {
    const rows = [
      a(1, "d1", 0, "지문 단어를 그대로 씀"),
      a(2, "d1", 0, "문장 구조 그대로"),
      a(2, "d1", 0, "문장 구조 그대로"),
      a(1, "d1", 100, null),
    ]
    const d = errorDistribution(rows)
    expect(d[0].name).toBe("문장 구조 그대로")
    expect(d[0].n).toBe(2)
    // 정답(null)은 분모에 넣지 않는다 — 오답의 구성비를 보는 표다
    expect(d[0].share).toBeCloseTo(2 / 3)
  })

  it("한 종에 몰리면 그것이 드러난다 — M12 의 실패 조건", () => {
    const rows = Array.from({ length: 9 }, () => a(2, "d1", 0, "문장 구조 그대로"))
    rows.push(a(1, "d1", 0, "절반만 맞는 말"))
    expect(errorDistribution(rows)[0].share).toBeGreaterThan(0.8)
  })
})
