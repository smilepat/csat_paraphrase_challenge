// ============================================================
// 3축 이력 — 자습의 리포트는 처음부터 끝까지 **축별**이다.
//
// 총점을 만들지 않는다. 교실에는 순위가 필요해 총점 압력이 있지만 자습에는 없고,
// 총점 하나로 뭉뚱그리면 "무엇이 안 되는가"가 사라진다(CALIBRATION.md 의 교훈이
// 채점기에서만이 아니라 리포트에서도 같다).
//
// M10 의 킬 기준이 여기 걸려 있다: 한 학습자의 세 축이 **서로 다른 값**을 보여야 한다.
// 늘 같이 움직이면 축을 나눈 의미가 없으므로 설계를 되돌린다.
// ============================================================

export type AxisType = 1 | 2 | 3

export type AttemptRow = {
  type: AxisType
  /** 0~100. 채점 전이면 null */
  score: number | null
  /** YYYY-MM-DD */
  day: string
  errorName: string | null
}

export type AxisPoint = { day: string; mean: number | null; n: number }

export type AxisSummary = {
  axis: AxisType
  mean: number | null
  n: number
  /** 최근 절반 - 이전 절반. 표본이 부족하면 null */
  trend: number | null
  history: AxisPoint[]
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

/** 축 하나의 일별 곡선. 날짜 오름차순. */
export function axisHistory(attempts: AttemptRow[], axis: AxisType): AxisPoint[] {
  const byDay = new Map<string, number[]>()
  for (const a of attempts) {
    if (a.type !== axis || a.score === null) continue
    const list = byDay.get(a.day) ?? []
    list.push(a.score)
    byDay.set(a.day, list)
  }
  return [...byDay.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([day, xs]) => ({ day, mean: mean(xs), n: xs.length }))
}

export function axisSummary(attempts: AttemptRow[], axis: AxisType): AxisSummary {
  const scored = attempts.filter((a) => a.type === axis && a.score !== null)
  const history = axisHistory(attempts, axis)

  // 추세는 **일 단위 곡선의 앞뒤 절반**으로 잰다. 시도 단위로 자르면
  // 하루에 몰아친 학습자의 곡선이 다른 날들을 덮는다.
  let trend: number | null = null
  if (history.length >= 4) {
    const half = Math.floor(history.length / 2)
    const early = mean(history.slice(0, half).map((p) => p.mean!).filter((x) => x !== null))
    const late = mean(history.slice(-half).map((p) => p.mean!).filter((x) => x !== null))
    if (early !== null && late !== null) trend = late - early
  }

  return {
    axis,
    mean: mean(scored.map((a) => a.score as number)),
    n: scored.length,
    trend,
    history,
  }
}

export function threeAxisProfile(attempts: AttemptRow[]): AxisSummary[] {
  return [1, 2, 3].map((a) => axisSummary(attempts, a as AxisType))
}

/**
 * 축이 실제로 갈리는가. 킬 기준의 계산식.
 * 값이 있는 축이 둘 미만이면 판정 불가(null) — **0 이 아니다.**
 * 아직 채점기가 없는 축을 "차이 없음"으로 세면 킬 기준이 거짓 통과한다.
 */
export function axisSeparation(profile: AxisSummary[]): number | null {
  const means = profile.map((p) => p.mean).filter((m): m is number => m !== null)
  if (means.length < 2) return null
  return Math.max(...means) - Math.min(...means)
}

/**
 * 오답 이름 분포. M12 적응형 출제가 이걸 보고 다음 문항을 고른다.
 * 한 종에 지나치게 몰리면 분류가 죽은 것이라 그것도 여기서 드러난다.
 */
export function errorDistribution(attempts: AttemptRow[]): { name: string; n: number; share: number }[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const a of attempts) {
    if (!a.errorName) continue
    counts.set(a.errorName, (counts.get(a.errorName) ?? 0) + 1)
    total++
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, n, share: total ? n / total : 0 }))
    .sort((x, y) => y.n - x.n)
}

/** 가장 약한 축. M12 가 다음 문항을 배정할 때 쓴다. */
export function weakestAxis(profile: AxisSummary[]): AxisType | null {
  const scored = profile.filter((p) => p.mean !== null)
  if (scored.length === 0) return null
  return scored.reduce((a, b) => (a.mean! <= b.mean! ? a : b)).axis
}
