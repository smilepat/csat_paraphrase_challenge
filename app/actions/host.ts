"use server"

// ============================================================
// 교사(호스트) 액션 — 방 생성과 상태 전이
//
// 계정 시스템 없이 host token 하나로 소유권을 표현한다.
// 토큰은 httpOnly 쿠키에 넣고 DB 에는 해시만 저장한다.
// ============================================================

import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { generateUniqueCode, ulid } from "@/lib/codes"
import { canTransition, isNewRound, type RoomState } from "@/lib/rooms"

const COOKIE_PREFIX = "pc_host_"

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** 방 소유 토큰을 발급하고 쿠키에 심는다. */
async function issueHostToken(roomId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url")
  const jar = await cookies()
  jar.set(`${COOKIE_PREFIX}${roomId}`, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12, // 수업 하루치
    path: "/",
  })
  return token
}

/** 이 요청이 해당 방의 호스트인지. 아니면 throw. */
export async function assertHost(roomId: string): Promise<void> {
  const jar = await cookies()
  const token = jar.get(`${COOKIE_PREFIX}${roomId}`)?.value
  if (!token) throw new Error("이 방의 진행 권한이 없습니다. 방을 만든 브라우저에서 열어주세요.")

  const { rows } = await db.execute({
    sql: "SELECT host_token_hash FROM pc_rooms WHERE id = ?",
    args: [roomId],
  })
  if (!rows.length) throw new Error("방을 찾을 수 없습니다.")
  if (rows[0].host_token_hash !== hash(token)) {
    throw new Error("이 방의 진행 권한이 없습니다.")
  }
}

export async function isHost(roomId: string): Promise<boolean> {
  try {
    await assertHost(roomId)
    return true
  } catch {
    return false
  }
}

export interface CreateRoomInput {
  passageId: string
  targetWords: number
  mode: "individual" | "team"
  title?: string
}

export async function createRoom(input: CreateRoomInput): Promise<{ id: string; code: string }> {
  const passage = await db.execute({
    sql: "SELECT id, review_status FROM pc_passages WHERE id = ?",
    args: [input.passageId],
  })
  if (!passage.rows.length) throw new Error("지문을 찾을 수 없습니다.")
  if (passage.rows[0].review_status !== "approved") {
    throw new Error("검수 승인된 지문만 수업에 쓸 수 있습니다. /admin/passages 에서 승인하세요.")
  }

  const code = await generateUniqueCode(async (c) => {
    const { rows } = await db.execute({
      sql: "SELECT 1 FROM pc_rooms WHERE code = ?",
      args: [c],
    })
    return rows.length > 0
  })

  const id = ulid()
  const token = await issueHostToken(id)

  await db.execute({
    sql: `INSERT INTO pc_rooms (id, code, host_token_hash, title, passage_id, target_words, mode)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, code, hash(token), input.title ?? null, input.passageId, input.targetWords, input.mode],
  })

  return { id, code }
}

/** 상태 전이. review → lobby 는 다음 라운드를 연다. */
export async function setRoomState(
  roomId: string,
  to: RoomState,
  opts: { writingSeconds?: number } = {},
): Promise<void> {
  await assertHost(roomId)

  const { rows } = await db.execute({
    sql: "SELECT state, round_no FROM pc_rooms WHERE id = ?",
    args: [roomId],
  })
  if (!rows.length) throw new Error("방을 찾을 수 없습니다.")
  const from = rows[0].state as RoomState
  if (from === to) return
  if (!canTransition(from, to)) {
    throw new Error(`${from} → ${to} 전이는 허용되지 않습니다.`)
  }

  const nextRound = isNewRound(from, to) ? Number(rows[0].round_no) + 1 : Number(rows[0].round_no)
  const endsAt =
    to === "writing" && opts.writingSeconds
      ? new Date(Date.now() + opts.writingSeconds * 1000).toISOString()
      : null

  await db.execute({
    sql: `UPDATE pc_rooms
          SET state = ?, round_no = ?, writing_ends_at = ?,
              closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE closed_at END,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [to, nextRound, endsAt, to, roomId],
  })
  revalidatePath(`/host/${roomId}`)
}

/** 다음 라운드용 지문 교체 (lobby 에서만). */
export async function setRoomPassage(roomId: string, passageId: string): Promise<void> {
  await assertHost(roomId)
  const { rows } = await db.execute({
    sql: "SELECT state FROM pc_rooms WHERE id = ?",
    args: [roomId],
  })
  if (rows[0]?.state !== "lobby") throw new Error("지문은 대기 상태에서만 바꿀 수 있습니다.")
  await db.execute({
    sql: "UPDATE pc_rooms SET passage_id = ?, updated_at = datetime('now') WHERE id = ?",
    args: [passageId, roomId],
  })
  revalidatePath(`/host/${roomId}`)
}

export async function setRevealFeedback(roomId: string, reveal: boolean): Promise<void> {
  await assertHost(roomId)
  await db.execute({
    sql: "UPDATE pc_rooms SET reveal_feedback = ?, updated_at = datetime('now') WHERE id = ?",
    args: [reveal ? 1 : 0, roomId],
  })
  revalidatePath(`/host/${roomId}`)
}

/** 플래그가 붙은 제출을 교사가 인정/기각한다. */
export async function reviewSubmission(
  roomId: string,
  submissionId: string,
  accept: boolean,
): Promise<void> {
  await assertHost(roomId)
  await db.execute({
    sql: "UPDATE pc_submissions SET teacher_ok = ? WHERE id = ? AND room_id = ?",
    args: [accept ? 1 : 0, submissionId, roomId],
  })
  revalidatePath(`/host/${roomId}`)
}

/** 팀 배정 (팀전에서 교사가 수동 조정). */
export async function setPlayerTeam(
  roomId: string,
  playerId: string,
  team: "blue" | "red" | null,
): Promise<void> {
  await assertHost(roomId)
  await db.execute({
    sql: "UPDATE pc_players SET team = ? WHERE id = ? AND room_id = ?",
    args: [team, playerId, roomId],
  })
  revalidatePath(`/host/${roomId}`)
}
