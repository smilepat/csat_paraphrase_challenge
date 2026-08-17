import { describe, expect, it } from "vitest"
import { hintLevelOf, supportSplit, supportTrend } from "../support"
import type { AttemptRow, AxisType } from "../history"

const a = (type: AxisType, day: string, score: number | null, hintLevel = 0): AttemptRow => ({
  type,
  day,
  score,
  errorName: null,
  hintLevel,
})

describe("hintLevelOf", () => {
  it("hint:N 에서 칸 수를 읽는다", () => {
    expect(hintLevelOf(["hint:3"])).toBe(3)
    expect(hintLevelOf(["verbatim", "hint:1"])).toBe(1)
  })

  it("도움을 안 받았으면 0 이다", () => {
    expect(hintLevelOf(null)).toBe(0)
    expect(hintLevelOf([])).toBe(0)
    expect(hintLevelOf(["verbatim"])).toBe(0)
  })

  it("옛 형식(hint)도 도움 받은 것으로 센다", () => {
    // 힌트가 한 칸이던 시절의 기록. 몇 칸인지는 모르지만 무도움은 아니다.
    expect(hintLevelOf(["hint"])).toBe(1)
  })
})

describe("supportSplit — 섞으면 실력이 부풀려진다", () => {
  const rows = [
    a(1, "2026-08-01", 30),          // 무도움
    a(1, "2026-08-01", 40),          // 무도움
    a(1, "2026-08-02", 90, 4),       // 도움 4칸
    a(1, "2026-08-02", 100, 2),      // 도움 2칸
    a(2, "2026-08-01", 70),
  ]

  it("도움 없이 낸 것과 받은 것을 따로 잰다", () => {
    const s = supportSplit(rows, 1)
    expect(s.unaided).toEqual({ mean: 35, n: 2 })
    expect(s.aided).toEqual({ mean: 95, n: 2 })
    // 섞으면 65 다. 그 숫자로는 이 학생이 혼자 뭘 할 수 있는지 알 수 없다.
  })

  it("평균 몇 칸까지 열었는지 센다", () => {
    expect(supportSplit(rows, 1).avgRungs).toBe(3)
  })

  it("도움 기록이 없으면 avgRungs 는 null 이다 — 0 이 아니다", () => {
    // 0 으로 두면 "도움을 0칸 받았다" 로 읽혀 도움을 받은 적이 없다는 사실이 지워진다
    expect(supportSplit(rows, 2).avgRungs).toBeNull()
    expect(supportSplit(rows, 2).aided).toEqual({ mean: null, n: 0 })
  })

  it("채점 전(score null)은 세지 않는다", () => {
    expect(supportSplit([a(3, "2026-08-01", null, 2)], 3).aided.n).toBe(0)
  })
})

describe("supportTrend — 지원이 줄고 있는가", () => {
  it("표본이 짧으면 추세를 지어내지 않는다", () => {
    const t = supportTrend([a(1, "2026-08-01", 50), a(1, "2026-08-02", 60, 2)])
    expect(t.delta, "3일 미만은 추세가 아니라 잡음이다").toBeNull()
    expect(t.unaidedShare).toBe(0.5)
  })

  it("무도움 비율이 오르면 양수다 — 혼자 하게 되고 있다", () => {
    const rows = [
      a(1, "2026-08-01", 40, 3),
      a(1, "2026-08-02", 50, 2),
      a(1, "2026-08-03", 60),
      a(1, "2026-08-04", 70),
    ]
    const t = supportTrend(rows)
    expect(t.days).toBe(4)
    expect(t.delta!).toBeGreaterThan(0)
  })

  it("계속 도움을 받으면 변화가 없다", () => {
    const rows = ["01", "02", "03", "04"].map((d) => a(1, `2026-08-${d}`, 60, 2))
    expect(supportTrend(rows).delta).toBe(0)
    expect(supportTrend(rows).unaidedShare).toBe(0)
  })

  it("하루에 몰아쳐도 그 하루가 다른 날을 덮지 않는다", () => {
    // 첫날에 도움 없이 20건, 이후 사흘은 도움 받고 1건씩.
    // 시도 단위로 재면 "무도움이 압도적" 으로 보이지만, 날 단위로는 지원이 늘었다.
    const rows: AttemptRow[] = []
    for (let i = 0; i < 20; i++) rows.push(a(1, "2026-08-01", 50))
    for (const d of ["02", "03", "04"]) rows.push(a(1, `2026-08-${d}`, 50, 3))
    const t = supportTrend(rows)
    expect(t.delta!).toBeLessThan(0)
  })
})
