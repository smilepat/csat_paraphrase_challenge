"use server"

// ============================================================
// 교사 화면 조회 — 폴링으로 2초마다 호출된다.
// 읽기 전용이라 host 검증은 하되 쓰기 액션과 분리해 둔다.
// ============================================================

import { db } from "@/lib/db"
import type { Room, RoomState } from "@/lib/rooms"
import type { ScoreResult } from "@/lib/scoring"
import type { Verdict } from "@/lib/scoring/verdict"
import { assertHost } from "./host"

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export interface HostRow {
  submissionId: string | null
  playerId: string
  nickname: string
  team: "blue" | "red" | null
  text: string | null
  words: number | null
  scores: ScoreResult | null
  verdict: Verdict | null
  teacherOk: number | null
  pasteCount: number
  elapsedMs: number | null
}

export interface HostView {
  room: Room
  passage: {
    id: string
    title: string
    body: string
    wordCount: number
    topic: string | null
    propositions: string[]
    modelAnswers: string[]
  } | null
  rows: HostRow[]
  teamScores: { blue: number; red: number }
  usageToday: Array<{ kind: string; calls: number; items: number }>
}

export async function hostView(roomId: string): Promise<HostView | null> {
  await assertHost(roomId)

  const roomRes = await db.execute({
    sql: `SELECT id, code, title, passage_id, target_words, mode, state, round_no,
                 writing_ends_at, reveal_feedback
          FROM pc_rooms WHERE id = ?`,
    args: [roomId],
  })
  if (!roomRes.rows.length) return null
  const r = roomRes.rows[0]
  const room: Room = {
    id: String(r.id),
    code: String(r.code),
    title: r.title ? String(r.title) : null,
    passageId: r.passage_id ? String(r.passage_id) : null,
    targetWords: Number(r.target_words),
    mode: r.mode as "individual" | "team",
    state: r.state as RoomState,
    roundNo: Number(r.round_no),
    writingEndsAt: r.writing_ends_at ? String(r.writing_ends_at) : null,
    revealFeedback: Number(r.reveal_feedback) === 1,
  }

  let passage: HostView["passage"] = null
  if (room.passageId) {
    const p = await db.execute({
      sql: `SELECT id, title, body, word_count, topic, propositions, model_answers
            FROM pc_passages WHERE id = ?`,
      args: [room.passageId],
    })
    if (p.rows.length) {
      const x = p.rows[0]
      passage = {
        id: String(x.id),
        title: String(x.title),
        body: String(x.body),
        wordCount: Number(x.word_count),
        topic: x.topic ? String(x.topic) : null,
        propositions: parseJson<string[]>(x.propositions, []),
        modelAnswers: parseJson<string[]>(x.model_answers, []),
      }
    }
  }

  // 미제출자도 보여야 하므로 참가자 기준 LEFT JOIN
  const rowsRes = await db.execute({
    sql: `SELECT p.id AS player_id, p.nickname, p.team,
                 s.id AS submission_id, s.text, s.word_count, s.scores, s.verdict,
                 s.teacher_ok, s.paste_count, s.elapsed_ms
          FROM pc_players p
          LEFT JOIN pc_submissions s
            ON s.player_id = p.id AND s.room_id = p.room_id AND s.round_no = ?
          WHERE p.room_id = ?
          ORDER BY p.joined_at`,
    args: [room.roundNo, roomId],
  })

  const rows: HostRow[] = rowsRes.rows.map((x) => ({
    submissionId: x.submission_id ? String(x.submission_id) : null,
    playerId: String(x.player_id),
    nickname: String(x.nickname),
    team: (x.team as "blue" | "red" | null) ?? null,
    text: x.text ? String(x.text) : null,
    words: x.word_count !== null ? Number(x.word_count) : null,
    scores: parseJson<ScoreResult | null>(x.scores, null),
    verdict: parseJson<Verdict | null>(x.verdict, null),
    teacherOk: x.teacher_ok !== null ? Number(x.teacher_ok) : null,
    pasteCount: Number(x.paste_count ?? 0),
    elapsedMs: x.elapsed_ms !== null ? Number(x.elapsed_ms) : null,
  }))

  // 팀 점수는 전 라운드 누적. 교사가 기각한 제출(teacher_ok=0)은 뺀다.
  const teamRes = await db.execute({
    sql: `SELECT p.team, s.scores, s.teacher_ok FROM pc_submissions s
          JOIN pc_players p ON p.id = s.player_id
          WHERE s.room_id = ? AND p.team IS NOT NULL`,
    args: [roomId],
  })
  const teamScores = { blue: 0, red: 0 }
  for (const t of teamRes.rows) {
    if (Number(t.teacher_ok) === 0) continue
    const sc = parseJson<ScoreResult | null>(t.scores, null)
    if (!sc) continue
    const key = t.team === "blue" ? "blue" : "red"
    teamScores[key] += sc.total + sc.bonus
  }

  const usage = await db.execute({
    sql: "SELECT kind, calls, items FROM pc_api_usage WHERE day = ?",
    args: [new Date().toISOString().slice(0, 10)],
  })

  return {
    room,
    passage,
    rows,
    teamScores,
    usageToday: usage.rows.map((u) => ({
      kind: String(u.kind),
      calls: Number(u.calls),
      items: Number(u.items),
    })),
  }
}

export interface PassageOption {
  id: string
  title: string
  questionType: string | null
  wordCount: number
  difficultyScore: number | null
  topic: string | null
}

export async function listApprovedPassages(): Promise<PassageOption[]> {
  const { rows } = await db.execute(`
    SELECT id, title, question_type, word_count, difficulty_score, topic
    FROM pc_passages WHERE review_status = 'approved'
    ORDER BY difficulty_score, id
  `)
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    questionType: r.question_type ? String(r.question_type) : null,
    wordCount: Number(r.word_count),
    difficultyScore: r.difficulty_score !== null ? Number(r.difficulty_score) : null,
    topic: r.topic ? String(r.topic) : null,
  }))
}
