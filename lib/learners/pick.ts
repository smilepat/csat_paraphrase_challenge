// ============================================================
// M12 — 적응형 출제. 교실 모드의 "교사가 다음 문항을 정한다"를 대체하는 자리다.
//
// 자습에는 교사가 없으므로 **처방 자동화가 선택이 아니라 제품의 심장**이다.
// 세 가지를 함께 본다:
//   ① 약한 축을 더 준다        — 3축 프로필
//   ② 틀린 것을 다시 준다      — 간격 반복
//   ③ 같은 것만 주지 않는다    — 최근 본 것은 뒤로
//
// 간격 반복이 여기서 **정상 동작**이라는 점이 교실과 다르다. 교실은 한 반이
// 문항을 한 번 쓰면 소진이지만, 자습은 다시 만나는 것이 곧 학습이다.
// 그래서 유형 3 의 문항 공급이 얇아도(52편) 출시를 막지 않는다.
// ============================================================

import type { AxisSummary, AxisType } from "./history"

export type TaskCandidate = {
  id: string
  type: AxisType
  /** 마지막으로 이 태스크를 푼 날(YYYY-MM-DD). 한 번도 없으면 null */
  lastSeenDay: string | null
  /** 마지막 점수. 없으면 null */
  lastScore: number | null
  /** 지금까지 푼 횟수 */
  seenCount: number
}

export type PickOptions = {
  today: string
  /** 약한 축에 얼마나 몰아줄지. 1 이면 축 편중 없음 */
  axisBias?: number
}

/** 며칠 지났는가. 날짜 문자열만으로 센다(시간대 문제를 만들지 않는다). */
export function daysBetween(from: string, to: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  return Math.round((d(to) - d(from)) / 86400000)
}

/**
 * 간격 반복의 복습 간격. 점수가 낮을수록 빨리 돌아온다.
 * SM-2 같은 정교한 스케줄러를 쓰지 않는 이유: 아직 실사용 데이터가 없어
 * 파라미터를 맞출 근거가 없다. 근거가 생기기 전에 복잡한 것을 넣지 않는다.
 */
export function dueInterval(lastScore: number | null, seenCount: number): number {
  if (lastScore === null) return 0
  if (lastScore < 40) return 1
  if (lastScore < 70) return 3
  // 잘한 것은 볼수록 뜸하게. 상한을 두어 영영 안 나오는 일은 막는다.
  return Math.min(3 * 2 ** Math.max(0, seenCount - 1), 30)
}

export function isDue(c: TaskCandidate, today: string): boolean {
  if (c.lastSeenDay === null) return true
  return daysBetween(c.lastSeenDay, today) >= dueInterval(c.lastScore, c.seenCount)
}

/**
 * 축 가중치. 약한 축일수록 크다.
 * 점수가 없는 축은 **가장 높은 가중치**를 준다 — 아직 재보지 않았으니
 * 약한지 강한지 모르고, 모르면 재보는 것이 먼저다.
 */
export function axisWeights(profile: AxisSummary[], bias = 2): Map<AxisType, number> {
  const out = new Map<AxisType, number>()
  for (const p of profile) {
    if (p.mean === null) {
      out.set(p.axis, p.n === 0 ? bias : 1)
      continue
    }
    // 0점이면 bias 배, 100점이면 1배
    out.set(p.axis, 1 + (bias - 1) * (1 - p.mean / 100))
  }
  return out
}

export type Picked = { task: TaskCandidate; reason: string }

/**
 * 다음 문항 하나. 결정론적이다 — 같은 상태면 같은 문항이 나온다.
 * 무작위를 쓰면 재현이 안 돼 "왜 이걸 줬는가"를 설명할 수 없다.
 */
export function pickNext(
  candidates: TaskCandidate[],
  profile: AxisSummary[],
  opts: PickOptions,
): Picked | null {
  const bias = opts.axisBias ?? 2
  const weights = axisWeights(profile, bias)

  const due = candidates.filter((c) => isDue(c, opts.today))
  // 복습할 것이 하나도 없으면 새 문항이라도 준다(빈손으로 돌려보내지 않는다)
  const pool = due.length ? due : candidates.filter((c) => c.seenCount === 0)
  const use = pool.length ? pool : candidates
  if (use.length === 0) return null

  const scored = use.map((c) => {
    const w = weights.get(c.type) ?? 1
    // 오래 묵은 것일수록, 약한 축일수록, 못 본 것일수록 앞으로
    const overdue = c.lastSeenDay === null ? 30 : daysBetween(c.lastSeenDay, opts.today)
    const freshness = c.seenCount === 0 ? 10 : 0
    return { c, key: w * (overdue + freshness) }
  })

  scored.sort((a, b) => (b.key !== a.key ? b.key - a.key : a.c.id < b.c.id ? -1 : 1))
  const top = scored[0]!.c

  const weakest = [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const reason =
    top.seenCount === 0
      ? top.type === weakest
        ? `약한 축(유형 ${top.type})의 새 문항`
        : `새 문항(유형 ${top.type})`
      : `복습(유형 ${top.type}, ${top.lastScore ?? "-"}점)`

  return { task: top, reason }
}

/** 한 세션 분량. 같은 태스크를 두 번 넣지 않는다. */
export function pickSession(
  candidates: TaskCandidate[],
  profile: AxisSummary[],
  opts: PickOptions & { size: number },
): Picked[] {
  const out: Picked[] = []
  const used = new Set<string>()
  let pool = [...candidates]
  for (let i = 0; i < opts.size; i++) {
    const next = pickNext(pool.filter((c) => !used.has(c.id)), profile, opts)
    if (!next) break
    used.add(next.task.id)
    out.push(next)
    pool = pool.filter((c) => c.id !== next.task.id)
  }
  return out
}
