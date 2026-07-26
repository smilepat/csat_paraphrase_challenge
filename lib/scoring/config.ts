// ============================================================
// 채점 임계값
//
// ⚠ 여기 있는 임베딩 임계값(τ)은 캘리브레이션 전까지 전부 임시값이다.
//   text-embedding-004 의 코사인 값에는 절대 기준이 없다.
//   `npm run calibrate` 가 60개 라벨 세트로 이 값들을 확정한다.
// ============================================================

export const WEIGHTS = {
  meaning: 50,
  brevity: 25,
  ease: 25,
} as const

export const MEANING = {
  /** 명제 커버리지와 요지 일치의 배합 */
  coverageWeight: 0.6,
  gistWeight: 0.4,
  /** 명제 하나를 "담았다"고 볼 코사인 구간. lo 이하 0점, hi 이상 만점, 사이는 선형 */
  propLo: 0.55,
  propHi: 0.78,
  /** 모범 답안과의 최대 유사도 구간 */
  gistLo: 0.55,
  gistHi: 0.85,
} as const

export const BREVITY = {
  /** 목표 초과 1단어당 감점 */
  penaltyPerWord: 2,
  /** 목표보다 이만큼 짧으면 초간결 보너스. 총점이 아니라 팀 점수에 가산한다. */
  bonusMargin: 8,
  bonusPoints: 5,
  /** 이보다 짧으면 요약이 아니라 미완성으로 본다(보너스 제외) */
  minMeaningfulWords: 8,
} as const

export const EASE = {
  /** 이 순위 안쪽이면 "쉬운 단어" */
  easyRank: 2000,
  /** 빈도표(6,302) 밖이면 고난도로 본다 */
  weights: { easy: 0.5, notHard: 0.3, sentenceLength: 0.2 },
  /** 평균 문장 길이 만점/영점 경계 */
  sentLenFull: 12,
  sentLenZero: 25,
} as const

// 베낌 판정은 전부 표면(단어·순서) 기준이다. 임베딩 유사도를 쓰지 않는 이유는
// guards.ts 의 surfaceOverlap 주석 참고 — 같은 뜻을 다르게 쓴 답안을 처벌하게 된다.
export const GUARDS = {
  /** 원문에서 이만큼 연속으로 베끼면 패러프레이즈가 아니다 */
  verbatimRun: 12,
  /** 모범 답안에서 연속으로 옮긴 단어 수 */
  modelRun: 8,
  /** 모범 답안과의 내용어 겹침(자카드) */
  duplicateOverlap: 0.85,
  /** 다른 학생 답안에서 연속으로 옮긴 단어 수 */
  peerRun: 10,
  /** 다른 학생 답안과의 내용어 겹침(자카드) */
  peerCopyOverlap: 0.85,
} as const
