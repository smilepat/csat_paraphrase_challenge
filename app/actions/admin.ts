"use server"

// ============================================================
// 지문 검수 — 채점 기준(핵심 명제·모범 답안)을 사람이 확인하고 승인한다.
//
// 자동 생성한 명제가 틀리면 채점 전체가 흔들린다. 그래서 승인된 지문만
// 수업에 노출한다(createRoom 에서 강제).
// ============================================================

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { embedBatch } from "@/lib/gemini"

export interface ReviewPassage {
  id: string
  title: string
  body: string
  wordCount: number
  topic: string | null
  questionType: string | null
  difficultyScore: number | null
  propositions: string[]
  modelAnswers: string[]
  reviewStatus: string
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export async function listPassages(status: string): Promise<ReviewPassage[]> {
  const { rows } = await db.execute({
    sql: `SELECT id, title, body, word_count, topic, question_type, difficulty_score,
                 propositions, model_answers, review_status
          FROM pc_passages
          WHERE review_status = ?
          ORDER BY difficulty_score, id`,
    args: [status],
  })
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    body: String(r.body),
    wordCount: Number(r.word_count),
    topic: r.topic ? String(r.topic) : null,
    questionType: r.question_type ? String(r.question_type) : null,
    difficultyScore: r.difficulty_score !== null ? Number(r.difficulty_score) : null,
    propositions: parseJson<string[]>(r.propositions, []),
    modelAnswers: parseJson<string[]>(r.model_answers, []),
    reviewStatus: String(r.review_status),
  }))
}

export async function statusCounts(): Promise<Record<string, number>> {
  const { rows } = await db.execute(
    "SELECT review_status, COUNT(*) AS n FROM pc_passages GROUP BY review_status",
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r.review_status)] = Number(r.n)
  return out
}

export interface SavePassageInput {
  id: string
  title: string
  topic: string
  propositions: string[]
  modelAnswers: string[]
}

/** 검수 내용 저장 (승인 없이). */
export async function savePassage(input: SavePassageInput): Promise<void> {
  const props = input.propositions.map((s) => s.trim()).filter(Boolean)
  const models = input.modelAnswers.map((s) => s.trim()).filter(Boolean)
  if (props.length < 2) throw new Error("핵심 명제는 2개 이상이어야 합니다.")
  if (models.length < 1) throw new Error("모범 답안은 1개 이상이어야 합니다.")

  await db.execute({
    sql: `UPDATE pc_passages
          SET title = ?, topic = ?, propositions = ?, model_answers = ?,
              ref_embedding = NULL, updated_at = datetime('now')
          WHERE id = ?`,
    // 명제가 바뀌면 기준 임베딩은 무효다. NULL 로 비워 다음 채점 때 다시 만든다.
    args: [input.title.trim(), input.topic.trim() || null,
           JSON.stringify(props), JSON.stringify(models), input.id],
  })
  revalidatePath("/admin/passages")
}

/** 승인 + 기준 임베딩 생성. */
export async function approvePassage(input: SavePassageInput): Promise<void> {
  await savePassage(input)

  const props = input.propositions.map((s) => s.trim()).filter(Boolean)
  const models = input.modelAnswers.map((s) => s.trim()).filter(Boolean)

  let refEmbedding: string | null = null
  try {
    const all = await embedBatch([...props, ...models])
    refEmbedding = JSON.stringify({
      propositions: all.slice(0, props.length),
      models: all.slice(props.length),
    })
  } catch (e) {
    // 임베딩 실패로 승인을 막지는 않는다. 첫 채점 때 다시 만든다.
    console.error("[admin] 기준 임베딩 생성 실패(승인은 진행):", (e as Error).message)
  }

  await db.execute({
    sql: `UPDATE pc_passages
          SET review_status = 'approved', ref_embedding = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [refEmbedding, input.id],
  })
  revalidatePath("/admin/passages")
  revalidatePath("/host")
}

export async function rejectPassage(id: string): Promise<void> {
  await db.execute({
    sql: "UPDATE pc_passages SET review_status = 'rejected', updated_at = datetime('now') WHERE id = ?",
    args: [id],
  })
  revalidatePath("/admin/passages")
}

export async function unapprovePassage(id: string): Promise<void> {
  await db.execute({
    sql: "UPDATE pc_passages SET review_status = 'draft', updated_at = datetime('now') WHERE id = ?",
    args: [id],
  })
  revalidatePath("/admin/passages")
}
