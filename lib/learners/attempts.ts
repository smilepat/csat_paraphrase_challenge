// ============================================================
// 시도 기록 · 3축 프로필 조회.
//
// append-only 다 — 같은 태스크를 다시 만나는 것이 자습의 정상 동작이고(간격 반복),
// 두 번째 시도가 첫 번째를 덮으면 성장 곡선이 사라진다.
// ============================================================

import { db } from "../db"
import { ulid } from "../codes"
import {
  threeAxisProfile,
  errorDistribution,
  weakestAxis,
  type AttemptRow,
  type AxisType,
} from "./history"

export type RecordAttempt = {
  learnerId: string
  sessionId?: string | null
  taskId: string
  type: AxisType
  answer: string
  score: number | null
  errorName: string | null
  judged: boolean
  flags?: string[]
  elapsedMs?: number | null
  /** 집계 기준일. 넘기지 않으면 서버의 오늘. 테스트가 과거를 심을 수 있게 열어 둔다. */
  day?: string
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function recordAttempt(a: RecordAttempt): Promise<string> {
  const id = ulid()
  await db.execute({
    sql: `INSERT INTO pc_attempts
            (id, learner_id, session_id, task_id, type, answer, score, error_name,
             judged, flags, day, elapsed_ms)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      a.learnerId,
      a.sessionId ?? null,
      a.taskId,
      a.type,
      a.answer,
      a.score,
      a.errorName,
      a.judged ? 1 : 0,
      a.flags?.length ? JSON.stringify(a.flags) : null,
      a.day ?? today(),
      a.elapsedMs ?? null,
    ],
  })
  return id
}

export async function loadAttempts(learnerId: string, days = 30): Promise<AttemptRow[]> {
  const { rows } = await db.execute({
    sql: `SELECT type, score, day, error_name FROM pc_attempts
          WHERE learner_id = ? AND day >= date('now', ?)
          ORDER BY day, created_at`,
    args: [learnerId, `-${days} days`],
  })
  return rows.map((r) => ({
    type: Number(r.type) as AxisType,
    score: r.score === null ? null : Number(r.score),
    day: String(r.day),
    errorName: r.error_name === null ? null : String(r.error_name),
  }))
}

/** 학생 리포트 한 덩어리. 총점은 만들지 않는다 — 축과 오답 이름뿐이다. */
export async function learnerReport(learnerId: string, days = 30) {
  const attempts = await loadAttempts(learnerId, days)
  const profile = threeAxisProfile(attempts)
  return {
    profile,
    weakest: weakestAxis(profile),
    errors: errorDistribution(attempts),
    total: attempts.length,
  }
}
