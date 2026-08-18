// ============================================================
// 유형별 채점 한 자리 — 자습(app/actions/study.ts)과 데모(app/actions/demo.ts)가
// **같은 함수**를 부른다.
//
// 왜 떼어냈나: §41 에서 `roughSubject` 가 hint.ts 와 scaffold.ts 에 같은 이름으로
// 둘 있었고 한쪽만 고쳐서 학생 화면에 틀린 힌트가 나갔다. 채점은 그보다 비싼
// 자리다 — 데모가 자기 사본을 들고 있으면 연수에서 보여 주는 점수가 실제 앱과
// 달라지고, 그건 아무도 눈치채지 못한 채 굴러간다.
//
// 여기서는 **DB 를 건드리지 않는다.** 시도 기록·모범답안 붙이기처럼 부르는 쪽마다
// 다른 일은 부르는 쪽에 남긴다(자습은 남기고 데모는 안 남긴다).
// ============================================================

import { checkAvoidance, finalizeType1 } from "./type1"
import { scoreType2, finalizeType2 } from "./type2"
import { checkSpan, finalizeType3 } from "./type3"
import { judgeType1Cached, judgeType2Cached } from "./cache"

/** 채점에 필요한 문항 정보. pc_tasks 의 행에서 그대로 뽑아 쓴다. */
export type GradableTask = {
  id: string
  type: number
  targetForm: "noun_phrase" | "clause" | null
  avoidWords: string[]
  /** 지문 본문 기준 오프셋 */
  stimulusStart: number
  stimulusEnd: number
  contextStart: number
  contextEnd: number
  answerStart: number | null
  answerEnd: number | null
}

/** pc_tasks 의 행(스네이크 케이스)을 채점 입력으로 옮긴다. */
export function toGradable(row: {
  id: string
  type: number
  target_form: string | null
  avoid_words: string | null
  stimulus_start: number
  stimulus_end: number
  context_start: number
  context_end: number
  answer_start: number | null
  answer_end: number | null
}): GradableTask {
  return {
    id: row.id,
    type: row.type,
    targetForm: (row.target_form as "noun_phrase" | "clause" | null) ?? null,
    avoidWords: row.avoid_words ? (JSON.parse(row.avoid_words) as string[]) : [],
    stimulusStart: row.stimulus_start,
    stimulusEnd: row.stimulus_end,
    contextStart: row.context_start,
    contextEnd: row.context_end,
    answerStart: row.answer_start,
    answerEnd: row.answer_end,
  }
}

export type GradeResult = {
  score: number
  errorName: string | null
  message: string
  suggested: string
  judged: boolean
}

/**
 * 답안 하나를 채점한다.
 *
 * `span` 은 **문맥 기준** 오프셋이다(클라이언트가 보는 좌표). 본문 기준으로
 * 되돌리는 것은 여기서 한 번만 한다 — 화면마다 하면 매번 틀린다.
 */
export async function gradeTypedAnswer(
  task: GradableTask,
  body: string,
  answer: string,
  span?: { start: number; end: number },
): Promise<GradeResult> {
  const stimulus = body.slice(task.stimulusStart, task.stimulusEnd)

  if (task.type === 1) {
    const free = checkAvoidance({ answer, stimulus, avoidWords: task.avoidWords })
    // 무료에서 떨어지면 유료 판정을 부르지 않는다 — 비용 설계의 핵심이다
    const verdict = free.fail
      ? null
      : (
          await judgeType1Cached([
            {
              id: task.id,
              stimulus,
              answer,
              // 구만 보면 같은 말인지 알 수 없다(§41). 문장을 같이 준다.
              context: body.slice(task.contextStart, task.contextEnd),
            },
          ])
        ).verdicts.get(task.id) ?? null
    const f = finalizeType1(free, verdict)
    return { score: f.score, errorName: f.errorName, message: f.message, suggested: f.suggested, judged: f.judged }
  }

  if (task.type === 2) {
    const target = task.targetForm ?? "clause"
    const free = scoreType2({ answer, stimulus, target })
    const verdict = free.needsVerdict
      ? (await judgeType2Cached([{ id: task.id, stimulus, target, answer }])).verdicts.get(task.id) ?? null
      : null
    const f = finalizeType2({ answer, stimulus, target }, free, verdict)
    return { score: f.score, errorName: f.errorName, message: f.message, suggested: f.suggested, judged: f.judged }
  }

  if (!span) throw new Error("범위를 표시해 주세요.")
  const free = checkSpan({
    answer: { start: span.start + task.contextStart, end: span.end + task.contextStart },
    gold: { start: task.answerStart ?? 0, end: task.answerEnd ?? 0 },
    stimulusStart: task.stimulusStart,
  })
  const f = finalizeType3(free, null)
  return { score: f.score, errorName: f.errorName, message: f.message, suggested: "", judged: false }
}
