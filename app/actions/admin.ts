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
import { auditPassage, auditSeverity, type AuditIssue } from "@/lib/scoring/audit"
import freqJson from "@/data/freq-rank.json"

const freq = freqJson as Record<string, number>

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
  /** 자동 점검 결과. 사람이 볼 순서를 정하는 용도지, 승인을 대신하지 않는다. */
  issues: AuditIssue[]
  severity: "clean" | "warn" | "error"
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
  const out = rows.map((r) => {
    const propositions = parseJson<string[]>(r.propositions, [])
    const modelAnswers = parseJson<string[]>(r.model_answers, [])
    const body = String(r.body)
    // raw 상태는 아직 명제가 없으니 점검할 게 없다.
    const issues = propositions.length
      ? auditPassage({ body, propositions, modelAnswers, freq })
      : []
    return {
      id: String(r.id),
      title: String(r.title),
      body,
      wordCount: Number(r.word_count),
      topic: r.topic ? String(r.topic) : null,
      questionType: r.question_type ? String(r.question_type) : null,
      difficultyScore: r.difficulty_score !== null ? Number(r.difficulty_score) : null,
      propositions,
      modelAnswers,
      reviewStatus: String(r.review_status),
      issues,
      severity: auditSeverity(issues),
    }
  })

  // 지적이 많은 것부터. 교사의 눈이 위험한 지문으로 먼저 가야 한다.
  const rank = { error: 0, warn: 1, clean: 2 } as const
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.issues.length - a.issues.length)
}

/**
 * 자동 점검에서 지적이 없는 지문들을 한꺼번에 승인한다.
 *
 * 기준 임베딩은 만들지 않는다 — 첫 채점 때 lazy 로 만들어지므로,
 * 115개를 승인하려고 임베딩 900여 건을 미리 부를 이유가 없다.
 */
export async function approveMany(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const placeholders = ids.map(() => "?").join(",")
  const res = await db.execute({
    sql: `UPDATE pc_passages SET review_status = 'approved', updated_at = datetime('now')
          WHERE id IN (${placeholders}) AND review_status != 'approved'`,
    args: ids,
  })
  revalidatePath("/admin/passages")
  revalidatePath("/host")
  return res.rowsAffected
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
