"use server"

// ============================================================
// 태스크 검수 — 목록 · 승인 · 반려 · 범위 수정
//
// 채굴기가 만든 것은 전부 후보(`raw`)다. 사람이 승인해야 학생에게 나간다.
// 478건을 전수 검수할 필요는 없다 — 자습은 간격 반복이라 수십 건이면 시작된다.
// 그래서 **무엇을 먼저 볼지**를 정하는 것이 이 화면의 일이다.
// ============================================================

import { db } from "@/lib/db"
import { toTaskView, goldSpanInContext, type TaskRow, type TaskView } from "@/lib/tasks/render"

export type ReviewTask = {
  view: TaskView
  passageId: string
  origin: string
  reviewStatus: string
  notes: string | null
  /** 문맥 기준 정답 범위(유형 3). 학생에게는 안 보내고 검수 화면에만 보낸다 */
  goldSpan: { start: number; end: number } | null
  /** 사람이 적어 둔 정답 예시 */
  gold: { text: string; note?: string }[] | null
  /** 먼저 볼 것일수록 작다 */
  priority: number
}

/**
 * 검수 우선순위.
 *
 * 0 — 40번 요약문 골드 스텁. 12개년 중 가장 값진 쌍인데 자동 추출이 불가능해
 *     사람이 손으로 채워야 한다. 놓치면 안 되므로 맨 앞이다.
 * 1 — 정관사 캡슐(유형 3). 되받기가 아닐 수 있어 오탐 위험이 가장 크다.
 * 2 — 유형 3 나머지. 정답 범위가 "직전 한 문장" 기본값이라 넓혀야 할 때가 있다.
 * 3 — 유형 2. 채점이 가장 결정적이라 먼저 쓸 수 있게 한다.
 * 4 — 유형 1.
 */
function priorityOf(origin: string, type: number, notes: string | null): number {
  if (origin === "gold") return 0
  if (type === 3) return notes ? 1 : 2
  if (type === 2) return 3
  return 4
}

/** priorityOf 와 **같은 규칙**이다. 자르기 전에 정렬하려면 SQL 에도 있어야 한다. */
const PRIORITY_SQL = `CASE
  WHEN t.origin = 'gold' THEN 0
  WHEN t.type = 3 AND t.notes IS NOT NULL THEN 1
  WHEN t.type = 3 THEN 2
  WHEN t.type = 2 THEN 3
  ELSE 4 END`

export async function listTasks(
  status: string,
  type: number | null,
  limit = 40,
): Promise<ReviewTask[]> {
  const where: string[] = []
  const args: (string | number)[] = []
  if (status !== "all") {
    where.push("t.review_status = ?")
    args.push(status)
  }
  if (type !== null) {
    where.push("t.type = ?")
    args.push(type)
  }

  // ⚠ 정렬을 **SQL 에서** 해야 한다. 예전에는 id 순으로 잘라 온 뒤 자바스크립트에서
  // 우선순위로 정렬했는데, 그러면 뒤쪽 id 의 골드 스텁이 LIMIT 에 잘려 영영 안 보인다
  // (실제로 골드 11건 중 1건만 올라왔다). 자르기 전에 순서를 정해야 한다.
  const { rows } = await db.execute({
    sql: `SELECT t.*, p.body FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY ${PRIORITY_SQL}, t.id
          LIMIT ?`,
    args: [...args, limit],
  })

  return rows.map((r) => {
    const row = r as unknown as TaskRow & { body: string; passage_id: string; origin: string; review_status: string; notes: string | null; gold: string | null }
    return {
      view: toTaskView(row, row.body),
      passageId: String(row.passage_id),
      origin: String(row.origin),
      reviewStatus: String(row.review_status),
      notes: row.notes ? String(row.notes) : null,
      goldSpan: goldSpanInContext(row),
      gold: row.gold ? (JSON.parse(String(row.gold)) as { text: string; note?: string }[]) : null,
      priority: priorityOf(String(row.origin), Number(row.type), row.notes ? String(row.notes) : null),
    }
  })
}

export async function taskCounts(): Promise<{ status: string; type: number; n: number }[]> {
  const { rows } = await db.execute(
    "SELECT review_status, type, COUNT(*) n FROM pc_tasks GROUP BY 1,2 ORDER BY 1,2",
  )
  return rows.map((r) => ({
    status: String(r.review_status),
    type: Number(r.type),
    n: Number(r.n),
  }))
}

export async function setTaskStatus(id: string, status: "approved" | "rejected" | "raw"): Promise<void> {
  await db.execute({
    sql: "UPDATE pc_tasks SET review_status = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, id],
  })
}

/**
 * 유형 3 의 정답 범위를 고친다. 화면은 문맥 기준으로 보내므로 본문 기준으로 되돌린다.
 * 범위가 자극보다 뒤면 되받기가 아니므로 거절한다 — 검수자가 실수로 뒤를 잡을 수 있다.
 */
export async function updateAnswerSpan(
  id: string,
  span: { start: number; end: number },
): Promise<{ ok: boolean; error?: string }> {
  const { rows } = await db.execute({
    sql: "SELECT context_start, stimulus_start FROM pc_tasks WHERE id = ?",
    args: [id],
  })
  if (!rows.length) return { ok: false, error: "문항을 찾을 수 없습니다." }
  const ctx = Number(rows[0].context_start)
  const stim = Number(rows[0].stimulus_start)

  const start = span.start + ctx
  const end = span.end + ctx
  if (end <= start) return { ok: false, error: "범위가 비어 있습니다." }
  if (start >= stim) return { ok: false, error: "되받는 표현보다 앞을 잡아야 합니다." }

  await db.execute({
    sql: "UPDATE pc_tasks SET answer_start = ?, answer_end = ?, updated_at = datetime('now') WHERE id = ?",
    args: [start, end, id],
  })
  return { ok: true }
}

/** 40번 요약문 스텁에 사람이 정답 쌍을 적는다. */
export async function saveGold(id: string, text: string, note?: string): Promise<void> {
  const payload = text.trim() ? JSON.stringify([{ text: text.trim(), note }]) : null
  await db.execute({
    sql: "UPDATE pc_tasks SET gold = ?, updated_at = datetime('now') WHERE id = ?",
    args: [payload, id],
  })
}

/**
 * 일괄 승인. **유형 2 만** 허용한다.
 * 유형 3 은 정답 범위가 기본값(직전 한 문장)이라 눈으로 봐야 하고,
 * 유형 1 은 금지어 목록이 적절한지 봐야 한다. 유형 2 는 목표 구조가 기계적이라
 * 일괄로 넘겨도 위험이 가장 작다.
 */
export async function approveManyType2(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const marks = ids.map(() => "?").join(",")
  const res = await db.execute({
    sql: `UPDATE pc_tasks SET review_status='approved', updated_at=datetime('now')
          WHERE type = 2 AND review_status = 'raw' AND id IN (${marks})`,
    args: ids,
  })
  return res.rowsAffected
}
