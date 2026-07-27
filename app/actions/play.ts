"use server"

// ============================================================
// 학생 액션 — 조인, 제출, 상태 조회(폴링)
// ============================================================

import { db } from "@/lib/db"
import { isValidCode, normalizeCode, ulid } from "@/lib/codes"
import { acceptsSubmission, nicknameError, type Room, type RoomState } from "@/lib/rooms"
import { judgeRound, scoreOne, type PassageForScoring } from "@/lib/scoring/service"
import type { ScoreResult } from "@/lib/scoring"
import type { Verdict } from "@/lib/scoring/verdict"

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

async function loadRoomByCode(code: string): Promise<Room | null> {
  const { rows } = await db.execute({
    sql: `SELECT id, code, title, passage_id, target_words, mode, state, round_no,
                 writing_ends_at, reveal_feedback
          FROM pc_rooms WHERE code = ?`,
    args: [normalizeCode(code)],
  })
  if (!rows.length) return null
  const r = rows[0]
  return {
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
}

export async function loadPassageForScoring(passageId: string): Promise<PassageForScoring | null> {
  const { rows } = await db.execute({
    sql: `SELECT id, body, propositions, model_answers, ref_embedding
          FROM pc_passages WHERE id = ?`,
    args: [passageId],
  })
  if (!rows.length) return null
  const r = rows[0]
  return {
    id: String(r.id),
    body: String(r.body),
    propositions: parseJson<string[]>(r.propositions, []),
    modelAnswers: parseJson<string[]>(r.model_answers, []),
    refEmbedding: parseJson<PassageForScoring["refEmbedding"]>(r.ref_embedding, null),
  }
}

export interface JoinResult {
  ok: boolean
  error?: string
  roomId?: string
  playerId?: string
  nickname?: string
}

export async function joinRoom(
  code: string,
  nickname: string,
  deviceToken: string,
): Promise<JoinResult> {
  if (!isValidCode(code)) {
    return { ok: false, error: "6자리 코드를 다시 확인하세요. (숫자 0·1과 알파벳 I·L·O는 쓰지 않습니다)" }
  }
  const nickErr = nicknameError(nickname)
  if (nickErr) return { ok: false, error: nickErr }
  if (!deviceToken) return { ok: false, error: "브라우저 저장소를 사용할 수 없습니다." }

  const room = await loadRoomByCode(code)
  if (!room) return { ok: false, error: "그런 방이 없습니다. 코드를 다시 확인하세요." }
  if (room.state === "closed") return { ok: false, error: "이미 끝난 방입니다." }

  // 같은 기기가 다시 들어오면 기존 참가자로 이어붙인다(새로고침·재접속).
  const existing = await db.execute({
    sql: "SELECT id, nickname FROM pc_players WHERE room_id = ? AND device_token = ?",
    args: [room.id, deviceToken],
  })
  if (existing.rows.length) {
    const id = String(existing.rows[0].id)
    await db.execute({
      sql: "UPDATE pc_players SET nickname = ?, last_seen_at = datetime('now') WHERE id = ?",
      args: [nickname.trim(), id],
    })
    return { ok: true, roomId: room.id, playerId: id, nickname: nickname.trim() }
  }

  // 팀전이면 인원이 적은 쪽에 넣는다(교사가 나중에 조정 가능).
  let team: string | null = null
  if (room.mode === "team") {
    const { rows } = await db.execute({
      sql: `SELECT SUM(team = 'blue') AS blue, SUM(team = 'red') AS red
            FROM pc_players WHERE room_id = ?`,
      args: [room.id],
    })
    team = Number(rows[0]?.blue ?? 0) <= Number(rows[0]?.red ?? 0) ? "blue" : "red"
  }

  const id = ulid()
  await db.execute({
    sql: `INSERT INTO pc_players (id, room_id, nickname, team, device_token)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, room.id, nickname.trim(), team, deviceToken],
  })
  return { ok: true, roomId: room.id, playerId: id, nickname: nickname.trim() }
}

export interface PlayerView {
  room: Room
  passage: { title: string; body: string; wordCount: number; topic: string | null } | null
  mySubmission: {
    text: string
    words: number
    scores: ScoreResult | null
    verdict: Verdict | null
    /** 교사 판단 — 플래그가 붙은 제출은 이게 정해져야 점수를 보여준다 */
    teacherOk: number | null
  } | null
  submittedCount: number
  playerCount: number
}

/** 학생 화면 폴링용. 상태가 바뀌면 화면이 따라간다. */
export async function playerView(code: string, playerId: string): Promise<PlayerView | null> {
  const room = await loadRoomByCode(code)
  if (!room) return null

  let passage: PlayerView["passage"] = null
  if (room.passageId) {
    const { rows } = await db.execute({
      sql: "SELECT title, body, word_count, topic FROM pc_passages WHERE id = ?",
      args: [room.passageId],
    })
    if (rows.length) {
      passage = {
        title: String(rows[0].title),
        body: String(rows[0].body),
        wordCount: Number(rows[0].word_count),
        topic: rows[0].topic ? String(rows[0].topic) : null,
      }
    }
  }

  const sub = await db.execute({
    sql: `SELECT text, word_count, scores, verdict, teacher_ok FROM pc_submissions
          WHERE room_id = ? AND round_no = ? AND player_id = ?`,
    args: [room.id, room.roundNo, playerId],
  })

  const counts = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM pc_players WHERE room_id = ?) AS players,
            (SELECT COUNT(*) FROM pc_submissions WHERE room_id = ? AND round_no = ?) AS subs`,
    args: [room.id, room.id, room.roundNo],
  })

  return {
    room,
    passage,
    mySubmission: sub.rows.length
      ? {
          text: String(sub.rows[0].text),
          words: Number(sub.rows[0].word_count),
          scores: parseJson<ScoreResult | null>(sub.rows[0].scores, null),
          verdict: parseJson<Verdict | null>(sub.rows[0].verdict, null),
          teacherOk: sub.rows[0].teacher_ok !== null ? Number(sub.rows[0].teacher_ok) : null,
        }
      : null,
    submittedCount: Number(counts.rows[0]?.subs ?? 0),
    playerCount: Number(counts.rows[0]?.players ?? 0),
  }
}

export interface SubmitInput {
  code: string
  playerId: string
  text: string
  pasteCount: number
  editCount: number
  elapsedMs: number
}

export async function submitAnswer(
  input: SubmitInput,
): Promise<{ ok: boolean; error?: string; scores?: ScoreResult }> {
  const room = await loadRoomByCode(input.code)
  if (!room) return { ok: false, error: "방을 찾을 수 없습니다." }
  if (!acceptsSubmission(room.state)) {
    return { ok: false, error: "지금은 제출할 수 없습니다. 선생님 화면을 확인하세요." }
  }
  if (!room.passageId) return { ok: false, error: "지문이 지정되지 않았습니다." }

  const text = input.text.trim()
  if (!text) return { ok: false, error: "답안을 입력하세요." }

  const player = await db.execute({
    sql: "SELECT id, nickname FROM pc_players WHERE id = ? AND room_id = ?",
    args: [input.playerId, room.id],
  })
  if (!player.rows.length) return { ok: false, error: "참가자 정보를 찾을 수 없습니다. 다시 입장하세요." }

  const passage = await loadPassageForScoring(room.passageId)
  if (!passage) return { ok: false, error: "지문을 찾을 수 없습니다." }

  const peers = await db.execute({
    sql: `SELECT p.nickname, s.text FROM pc_submissions s
          JOIN pc_players p ON p.id = s.player_id
          WHERE s.room_id = ? AND s.round_no = ? AND s.player_id != ?`,
    args: [room.id, room.roundNo, input.playerId],
  })

  let scores: ScoreResult
  try {
    scores = await scoreOne({
      passage,
      answer: text,
      targetWords: room.targetWords,
      peers: peers.rows.map((r) => ({ nickname: String(r.nickname), text: String(r.text) })),
    })
  } catch (e) {
    // 채점이 실패해도 제출 자체는 받는다. 라운드 종료 배치에서 다시 채점된다.
    console.error("[submit] 즉시 채점 실패:", (e as Error).message)
    await upsertSubmission(room.id, room.roundNo, room.passageId, input, null)
    return { ok: true, error: "제출은 저장됐지만 채점이 지연됩니다. 라운드 종료 시 채점됩니다." }
  }

  await upsertSubmission(room.id, room.roundNo, room.passageId, input, scores)
  return { ok: true, scores }
}

async function upsertSubmission(
  roomId: string,
  roundNo: number,
  passageId: string,
  input: SubmitInput,
  scores: ScoreResult | null,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO pc_submissions
            (id, room_id, player_id, round_no, passage_id, text, word_count, scores, flags,
             paste_count, edit_count, elapsed_ms, scored_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(room_id, round_no, player_id) DO UPDATE SET
            text = excluded.text, word_count = excluded.word_count,
            scores = excluded.scores, flags = excluded.flags,
            paste_count = excluded.paste_count, edit_count = excluded.edit_count,
            elapsed_ms = excluded.elapsed_ms, submitted_at = datetime('now'),
            scored_at = excluded.scored_at`,
    args: [
      ulid(), roomId, input.playerId, roundNo, passageId,
      input.text.trim(),
      scores?.words ?? input.text.trim().split(/\s+/).length,
      scores ? JSON.stringify(scores) : null,
      scores ? JSON.stringify(scores.flags) : null,
      input.pasteCount, input.editCount, input.elapsedMs,
      scores ? new Date().toISOString() : null,
    ],
  })
}

/** 라운드 종료 배치 판정. 교사 화면이 scoring 으로 넘길 때 호출한다. */
export async function scoreRound(roomId: string): Promise<{ judged: number; llm: boolean }> {
  const { rows: roomRows } = await db.execute({
    sql: "SELECT passage_id, target_words, round_no FROM pc_rooms WHERE id = ?",
    args: [roomId],
  })
  if (!roomRows.length || !roomRows[0].passage_id) return { judged: 0, llm: false }

  const passage = await loadPassageForScoring(String(roomRows[0].passage_id))
  if (!passage) return { judged: 0, llm: false }

  const { rows } = await db.execute({
    sql: `SELECT s.id, s.text, p.nickname FROM pc_submissions s
          JOIN pc_players p ON p.id = s.player_id
          WHERE s.room_id = ? AND s.round_no = ?`,
    args: [roomId, Number(roomRows[0].round_no)],
  })
  const subs = rows.map((r) => ({
    id: String(r.id),
    text: String(r.text),
    nickname: String(r.nickname),
  }))

  const results = await judgeRound(passage, Number(roomRows[0].target_words), subs)

  let llmUsed = false
  for (const [id, payload] of results) {
    if (payload.verdict) llmUsed = true
    await db.execute({
      sql: `UPDATE pc_submissions
            SET scores = ?, verdict = ?, flags = ?, scored_at = datetime('now')
            WHERE id = ?`,
      args: [
        JSON.stringify(payload.scores),
        payload.verdict ? JSON.stringify(payload.verdict) : null,
        JSON.stringify(payload.scores.flags),
        id,
      ],
    })
  }
  return { judged: results.size, llm: llmUsed }
}
