"use server"

// ============================================================
// 자습 액션 — 입장 · 다음 문항 · 제출 · 리포트
//
// 교실 액션(play.ts)과 섞지 않는다. 교실은 방·라운드가 단위이고
// 자습은 학습자·누적이 단위라 상태 기계 자체가 다르다.
//
// ⚠ 지문 전문은 이 파일 밖으로 나가지 않는다. toTaskView 가 문맥만 잘라 준다.
// ============================================================

import { db } from "@/lib/db"
import { ulid } from "@/lib/codes"
import { toTaskView, type TaskRow, type TaskView } from "@/lib/tasks/render"
import { checkAvoidance, finalizeType1 } from "@/lib/scoring/typed/type1"
import { scoreType2, finalizeType2 } from "@/lib/scoring/typed/type2"
import { checkSpan, finalizeType3 } from "@/lib/scoring/typed/type3"
import { judgeType1Cached, judgeType2Cached } from "@/lib/scoring/typed/cache"
import { recordAttempt, learnerReport, today } from "@/lib/learners/attempts"
import { threeAxisProfile, type AttemptRow, type AxisType } from "@/lib/learners/history"
import { pickNext, type TaskCandidate } from "@/lib/learners/pick"
import { hintSteps, type HintMaterial, type HintStep } from "@/lib/tasks/hint"

/** 개발 중에는 승인 전 태스크도 쓴다. 운영에서는 승인된 것만 나간다. */
function allowedStatuses(): string[] {
  return process.env.NODE_ENV === "production" ? ["approved"] : ["approved", "draft", "raw"]
}

// ── 입장 ────────────────────────────────────────────────────

export async function enterStudy(
  inviteCode: string,
  nickname: string,
  deviceToken: string,
): Promise<{ ok: boolean; learnerId?: string; nickname?: string; error?: string }> {
  const code = inviteCode.trim().toUpperCase()
  const name = nickname.trim()
  if (!code) return { ok: false, error: "초대 코드를 입력하세요." }
  if (name.length < 1 || name.length > 12) return { ok: false, error: "이름은 1~12자로 적어 주세요." }

  const expected = process.env.STUDY_INVITE_CODE?.trim().toUpperCase()
  if (expected && code !== expected) return { ok: false, error: "초대 코드가 맞지 않습니다." }

  // 같은 기기·같은 코드면 이어서 한다 — 자습은 누적이 전부라 새 계정을 만들면 이력이 끊긴다
  if (deviceToken) {
    const { rows } = await db.execute({
      sql: "SELECT id, nickname FROM pc_learners WHERE invite_code = ? AND device_token = ? LIMIT 1",
      args: [code, deviceToken],
    })
    if (rows.length) {
      await db.execute({
        sql: "UPDATE pc_learners SET last_seen_at = datetime('now') WHERE id = ?",
        args: [rows[0].id],
      })
      return { ok: true, learnerId: String(rows[0].id), nickname: String(rows[0].nickname) }
    }
  }

  const id = ulid()
  await db.execute({
    sql: "INSERT INTO pc_learners (id, invite_code, nickname, device_token) VALUES (?,?,?,?)",
    args: [id, code, name, deviceToken || null],
  })
  return { ok: true, learnerId: id, nickname: name }
}

// ── 다음 문항 ────────────────────────────────────────────────

async function loadProfileRows(learnerId: string): Promise<AttemptRow[]> {
  const { rows } = await db.execute({
    sql: "SELECT type, score, day, error_name FROM pc_attempts WHERE learner_id = ? ORDER BY day",
    args: [learnerId],
  })
  return rows.map((r) => ({
    type: Number(r.type) as AxisType,
    score: r.score === null ? null : Number(r.score),
    day: String(r.day),
    errorName: r.error_name === null ? null : String(r.error_name),
  }))
}

export type NextTask = { task: TaskView; reason: string } | null

export async function nextTask(learnerId: string): Promise<NextTask> {
  const statuses = allowedStatuses()
  const marks = statuses.map(() => "?").join(",")

  // 후보 목록에 각 태스크의 마지막 시도를 붙여 온다. 간격 반복이 이걸로 굴러간다.
  const { rows } = await db.execute({
    sql: `SELECT t.id, t.type,
                 (SELECT a.day FROM pc_attempts a
                   WHERE a.task_id = t.id AND a.learner_id = ?
                   ORDER BY a.created_at DESC LIMIT 1) AS last_day,
                 (SELECT a.score FROM pc_attempts a
                   WHERE a.task_id = t.id AND a.learner_id = ?
                   ORDER BY a.created_at DESC LIMIT 1) AS last_score,
                 (SELECT COUNT(*) FROM pc_attempts a
                   WHERE a.task_id = t.id AND a.learner_id = ?) AS seen
          FROM pc_tasks t
          WHERE t.review_status IN (${marks})`,
    args: [learnerId, learnerId, learnerId, ...statuses],
  })

  const candidates: TaskCandidate[] = rows.map((r) => ({
    id: String(r.id),
    type: Number(r.type) as AxisType,
    lastSeenDay: r.last_day === null ? null : String(r.last_day),
    lastScore: r.last_score === null ? null : Number(r.last_score),
    seenCount: Number(r.seen ?? 0),
  }))
  if (candidates.length === 0) return null

  const picked = pickNext(candidates, threeAxisProfile(await loadProfileRows(learnerId)), {
    today: today(),
  })
  if (!picked) return null

  const detail = await db.execute({
    sql: `SELECT t.*, p.body FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
          WHERE t.id = ?`,
    args: [picked.task.id],
  })
  if (!detail.rows.length) return null
  const row = detail.rows[0] as unknown as TaskRow & { body: string }

  return { task: toTaskView(row, row.body), reason: picked.reason }
}

// ── 힌트 ────────────────────────────────────────────────────

/**
 * 힌트는 **요청해야 나온다.** 문항과 함께 보내면 학생이 산출을 시도하기 전에 읽는다.
 * 쓴 사실은 제출 시 flags 에 남는다.
 */
export async function taskHint(taskId: string): Promise<HintStep[]> {
  const { rows } = await db.execute({
    sql: "SELECT type, direction, stimulus_text, avoid_words, hints FROM pc_tasks WHERE id = ?",
    args: [taskId],
  })
  if (!rows.length) return []
  const r = rows[0]!
  // 힌트 재료는 build-hints.mjs 가 미리 넣어 둔다. 없으면 전략 칸만 나온다 —
  // 그래도 예전과 같은 만큼은 도와준다.
  let material: HintMaterial | null = null
  try {
    material = r.hints ? (JSON.parse(String(r.hints)) as HintMaterial) : null
  } catch {
    material = null
  }
  return hintSteps(
    Number(r.type),
    r.direction === null ? null : String(r.direction),
    String(r.stimulus_text),
    r.avoid_words ? (JSON.parse(String(r.avoid_words)) as string[]) : [],
    material,
  )
}

// ── 제출 ────────────────────────────────────────────────────

export type SubmitResult = {
  score: number
  errorName: string | null
  message: string
  suggested: string
  judged: boolean
  /** 사람이 정해 둔 정답 쌍. 있으면 채점 뒤에 보여 준다 */
  gold: string | null
  /**
   * 모범답안 — **채점 결과와 상관없이** 보여 준다.
   *
   * 예전에는 LLM 판정이 있을 때만 `suggested` 한 줄이 나왔다. 그런데 무료 단계에서
   * 떨어진 답안(원문을 아직 안 바꾼 경우)에는 판정을 부르지 않으므로 **가장 도움이
   * 필요한 학생이 아무것도 못 받았다.** 자습이라 물어볼 사람도 없다.
   * 문항마다 미리 만들어 둔 example 을 쓴다(pc_tasks.hints).
   */
  model: string | null
}

export async function submitAnswer(
  learnerId: string,
  taskId: string,
  answer: string,
  span?: { start: number; end: number },
  /** 학생이 연 힌트 칸 수. 0 이면 무도움. */
  hintLevel = 0,
): Promise<SubmitResult> {
  const { rows } = await db.execute({
    sql: `SELECT t.*, p.body FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
          WHERE t.id = ?`,
    args: [taskId],
  })
  if (!rows.length) throw new Error("문항을 찾을 수 없습니다.")
  const t = rows[0] as unknown as TaskRow & { body: string }
  const stimulus = t.body.slice(t.stimulus_start, t.stimulus_end)

  // 모범답안은 유형별 채점이 끝난 뒤 마지막에 한 번만 붙인다 — 세 갈래가 각자
  // 붙이면 한 곳을 빠뜨려도 안 드러난다.
  let result: Omit<SubmitResult, "model">


  if (t.type === 1) {
    const free = checkAvoidance({
      answer,
      stimulus,
      avoidWords: t.avoid_words ? (JSON.parse(t.avoid_words) as string[]) : [],
    })
    // 무료에서 떨어지면 유료 판정을 부르지 않는다 — 비용 설계의 핵심이다
    const verdict = free.fail
      ? null
      : (await judgeType1Cached([{ id: taskId, stimulus, answer, context: t.body.slice(t.context_start, t.context_end) }])).verdicts.get(taskId) ?? null
    const f = finalizeType1(free, verdict)
    result = { score: f.score, errorName: f.errorName, message: f.message, suggested: f.suggested, judged: f.judged, gold: null }
  } else if (t.type === 2) {
    const target = (t.target_form ?? "clause") as "noun_phrase" | "clause"
    const free = scoreType2({ answer, stimulus, target })
    const verdict = free.needsVerdict
      ? (await judgeType2Cached([{ id: taskId, stimulus, target, answer }])).verdicts.get(taskId) ?? null
      : null
    const f = finalizeType2({ answer, stimulus, target }, free, verdict)
    result = { score: f.score, errorName: f.errorName, message: f.message, suggested: f.suggested, judged: f.judged, gold: null }
  } else {
    if (!span) throw new Error("범위를 표시해 주세요.")
    // 클라이언트는 문맥 기준 오프셋을 보낸다 — 본문 기준으로 되돌린다
    const free = checkSpan({
      answer: { start: span.start + t.context_start, end: span.end + t.context_start },
      gold: { start: t.answer_start ?? 0, end: t.answer_end ?? 0 },
      stimulusStart: t.stimulus_start,
    })
    const f = finalizeType3(free, null)
    result = { score: f.score, errorName: f.errorName, message: f.message, suggested: "", judged: false, gold: null }
  }

  await recordAttempt({
    learnerId,
    taskId,
    type: t.type as AxisType,
    answer: span ? `[${span.start},${span.end}] ${answer}` : answer,
    score: result.score,
    errorName: result.errorName,
    judged: result.judged,
    flags: hintLevel > 0 ? [`hint:${hintLevel}`] : undefined,
  })

  // 사람이 정해 둔 정답 쌍이 있으면 채점 뒤에 보여 준다.
  // 40번 요약문 11건이 그렇다 — 가장 좋은 예시가 이미 준비돼 있는데 안 쓸 이유가 없다.
  const goldRaw = (t as unknown as { gold?: string | null }).gold
  let gold: string | null = null
  if (goldRaw) {
    try {
      gold = (JSON.parse(String(goldRaw)) as { text: string }[])[0]?.text ?? null
    } catch {
      gold = null
    }
  }

  // 모범답안. 점수와 상관없이 붙인다 — 무료 단계에서 떨어진 학생은 판정을 안 부르므로
  // 예전에는 **가장 도움이 필요한 쪽이 아무것도 못 받았다.**
  // 유형 3 은 산출 과제가 아니라 범위를 끄는 과제라 모범답안이 없다.
  let model: string | null = null
  if (t.type !== 3) {
    try {
      const h = (t as unknown as { hints?: string | null }).hints
      const parsed = h ? (JSON.parse(String(h)) as { example?: string }) : null
      model = parsed?.example?.trim() || null
    } catch {
      model = null
    }
  }

  return { ...result, gold, model }
}

// ── 리포트 ──────────────────────────────────────────────────

export async function studyReport(learnerId: string) {
  return learnerReport(learnerId, 30)
}
