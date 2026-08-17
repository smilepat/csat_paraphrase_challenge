// ============================================================
// 지원(힌트) 사용 집계 — **무도움 성적과 도움 받은 성적을 가른다.**
//
// 왜 필요한가: 시도 기록에는 진작부터 `hint:N` 이 남고 있었는데 **읽는 코드가
// 어디에도 없었다.** 그래서 "지원 감소를 추적할 수 있다"는 말은 데이터에 대해서만
// 참이고 학생·교사가 볼 수 있는 것으로는 거짓이었다(자가진단 3번).
//
// 무엇을 보여 줘야 하는가:
//   ① 도움 없이 낸 성적 — 이것이 **진짜 실력**이다. 섞어 놓으면 실력이 부풀려진다.
//   ② 도움 받은 성적 — 도움이 실제로 통했는지. 도움을 받고도 낮으면 사다리가 헛돈다.
//   ③ 무도움 비율의 변화 — 교수 설계에서 말하는 **지원 감소**가 실제로 일어나는가.
//
// 총점을 만들지 않는 이 앱의 방침을 여기서도 지킨다. 축을 합치지 않는다.
// ============================================================

import type { AttemptRow, AxisType } from "./history"

/** `["hint:3"]` → 3. 도움을 안 받았으면 0. */
export function hintLevelOf(flags: string[] | null | undefined): number {
  if (!flags?.length) return 0
  for (const f of flags) {
    const m = /^hint:(\d+)$/.exec(f)
    if (m) return Number(m[1])
    // 옛 형식. 몇 칸인지는 모르지만 도움을 받은 것은 맞다.
    if (f === "hint") return 1
  }
  return 0
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export type SupportSplit = {
  axis: AxisType
  /** 도움 없이 낸 시도 */
  unaided: { mean: number | null; n: number }
  /** 도움을 받고 낸 시도 */
  aided: { mean: number | null; n: number }
  /** 도움을 받은 시도에서 평균 몇 칸까지 열었나. 도움이 없으면 null */
  avgRungs: number | null
}

export function supportSplit(attempts: AttemptRow[], axis: AxisType): SupportSplit {
  const scored = attempts.filter((a) => a.type === axis && a.score !== null)
  const unaided = scored.filter((a) => (a.hintLevel ?? 0) === 0)
  const aided = scored.filter((a) => (a.hintLevel ?? 0) > 0)
  return {
    axis,
    unaided: { mean: mean(unaided.map((a) => a.score as number)), n: unaided.length },
    aided: { mean: mean(aided.map((a) => a.score as number)), n: aided.length },
    avgRungs: mean(aided.map((a) => a.hintLevel as number)),
  }
}

export function threeAxisSupport(attempts: AttemptRow[]): SupportSplit[] {
  return [1, 2, 3].map((a) => supportSplit(attempts, a as AxisType))
}

export type SupportTrend = {
  /** 전체 시도 중 도움 없이 낸 비율 (0~1) */
  unaidedShare: number | null
  /**
   * 무도움 비율의 변화. 양수면 **지원이 줄고 있다** = 혼자 하게 되고 있다.
   * 표본이 모자라면 null — 없는 추세를 지어내지 않는다.
   */
  delta: number | null
  /** 판단 근거가 된 날 수 */
  days: number
}

/**
 * 지원 감소가 일어나고 있는가.
 *
 * **일 단위**로 앞뒤 절반을 갈라 잰다. 시도 단위로 자르면 하루에 몰아친 학습자의
 * 그 하루가 다른 날들을 덮는다(axisSummary 의 추세와 같은 이유).
 * 최소 4일이 필요하다 — 그보다 짧으면 추세가 아니라 잡음이다.
 */
export function supportTrend(attempts: AttemptRow[]): SupportTrend {
  const scored = attempts.filter((a) => a.score !== null)
  if (!scored.length) return { unaidedShare: null, delta: null, days: 0 }

  const byDay = new Map<string, { unaided: number; total: number }>()
  for (const a of scored) {
    const d = byDay.get(a.day) ?? { unaided: 0, total: 0 }
    d.total++
    if ((a.hintLevel ?? 0) === 0) d.unaided++
    byDay.set(a.day, d)
  }
  const days = [...byDay.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([, v]) => v.unaided / v.total)

  const share = scored.filter((a) => (a.hintLevel ?? 0) === 0).length / scored.length
  if (days.length < 4) return { unaidedShare: share, delta: null, days: days.length }

  const half = Math.floor(days.length / 2)
  const early = mean(days.slice(0, half))
  const late = mean(days.slice(-half))
  return {
    unaidedShare: share,
    delta: early === null || late === null ? null : late - early,
    days: days.length,
  }
}
