// ============================================================
// 간결 점수 (25점)
//
// standalone.html 의 공식에는 버그가 있었다: 보너스가 Math.min(30, length+5) 로
// 25점 상한을 넘겨 총점 캡(100)과 충돌했다. 여기서는 감점만 남기고,
// 초간결 보너스는 총점 밖(팀 점수 가산)으로 분리한다.
// ============================================================

import { BREVITY } from "./config"

export interface BrevityResult {
  score: number
  /** 총점에 포함되지 않는 별도 보너스. 팀 점수에 가산한다. */
  bonus: number
  over: number
}

export function scoreBrevity(words: number, target: number): BrevityResult {
  const over = Math.max(0, words - target)
  const score = Math.max(0, Math.min(25, 25 - BREVITY.penaltyPerWord * over))

  const bonus =
    words >= BREVITY.minMeaningfulWords && words <= target - BREVITY.bonusMargin
      ? BREVITY.bonusPoints
      : 0

  return { score, bonus, over }
}
