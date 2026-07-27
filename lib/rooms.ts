// ============================================================
// 방 도메인 — 타입과 순수 규칙
// ============================================================

export const ROOM_STATES = ["lobby", "writing", "scoring", "review", "closed"] as const
export type RoomState = (typeof ROOM_STATES)[number]

export const TARGET_WORD_OPTIONS = [15, 20, 25, 30] as const

export interface Room {
  id: string
  code: string
  title: string | null
  passageId: string | null
  targetWords: number
  mode: "individual" | "team"
  state: RoomState
  roundNo: number
  writingEndsAt: string | null
  revealFeedback: boolean
}

export interface Player {
  id: string
  nickname: string
  team: "blue" | "red" | null
}

/**
 * 상태 전이 규칙. 교사만 전이시킨다.
 * review 에서 lobby 로 돌아가면 다음 라운드다(round_no 증가).
 */
const ALLOWED: Record<RoomState, RoomState[]> = {
  lobby: ["writing", "closed"],
  writing: ["scoring", "lobby", "closed"],
  scoring: ["review", "closed"],
  review: ["lobby", "closed"],
  closed: [],
}

export function canTransition(from: RoomState, to: RoomState): boolean {
  return ALLOWED[from]?.includes(to) ?? false
}

/** review → lobby 만 새 라운드를 연다. */
export function isNewRound(from: RoomState, to: RoomState): boolean {
  return from === "review" && to === "lobby"
}

/** 학생이 지금 답안을 낼 수 있는 상태인가. */
export function acceptsSubmission(state: RoomState): boolean {
  return state === "writing"
}

/** 남은 시간(ms). 타이머가 없으면 null. */
export function remainingMs(writingEndsAt: string | null, now: number = Date.now()): number | null {
  if (!writingEndsAt) return null
  return Math.max(0, new Date(writingEndsAt).getTime() - now)
}

/**
 * 타이머가 지났는지. 서버는 이걸로 제출을 막지 않는다 —
 * 마감 직전에 누른 제출이 네트워크 지연으로 거부되면 학생만 억울하다.
 * 교사가 scoring 으로 넘기는 순간이 진짜 마감이고, 타이머는 화면 안내다.
 */
export function isTimeUp(writingEndsAt: string | null, now: number = Date.now()): boolean {
  const r = remainingMs(writingEndsAt, now)
  return r !== null && r <= 0
}

// ============================================================
// 제출의 반영 상태
//
// 자동 채점이 판단을 보류한 제출(원문 복붙·모범답안 베끼기·또래 복사·모순)은
// 교사가 결정하기 전까지 **어디에도 반영하지 않는다**.
//
// 이전에는 플래그만 붙이고 점수는 그대로 살려 뒀는데, 그러면 실측에서 확인된 것처럼
// 원문을 25단어 복붙한 답안이 69.3점으로 2위에 올랐다. 교사가 확인을 건너뛰면
// 베낀 답안이 순위표 위에 남는다 — 이 활동이 가르치려는 것과 정반대다.
// 그렇다고 자동으로 0점 처리하지도 않는다. 정당한 인용을 기계가 가려낼 수 없기 때문에
// 판단은 교사에게 남기고, 판단 전까지만 보류한다.
// ============================================================

export type ReviewState = "counted" | "pending" | "rejected"

export function reviewState(
  scores: { needsReview: boolean } | null,
  teacherOk: number | null,
): ReviewState {
  if (teacherOk === 0) return "rejected"
  if (teacherOk === 1) return "counted"
  if (!scores) return "pending"
  return scores.needsReview ? "pending" : "counted"
}

/** 순위·팀 점수·평균에 반영되는가. */
export function countsTowardScore(
  scores: { needsReview: boolean } | null,
  teacherOk: number | null,
): boolean {
  return reviewState(scores, teacherOk) === "counted"
}

export function nicknameError(nickname: string): string | null {
  const n = nickname.trim()
  if (n.length < 1) return "이름을 입력하세요."
  if (n.length > 12) return "이름은 12자 이내로 입력하세요."
  return null
}
