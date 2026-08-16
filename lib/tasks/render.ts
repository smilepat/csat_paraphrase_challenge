import { scaffoldFor, type Scaffold } from "./scaffold"

// ============================================================
// 태스크 → 화면에 뿌릴 모델.
//
// **지문 전문을 절대 보내지 않는다.** 자습 모드의 저작권 설계가 여기 걸려 있다 —
// 서버가 `context_start ~ context_end` 만 잘라 보내므로, 클라이언트가 아무리
// 뜯어봐도 그 구간 밖은 없다. 유형 1·2 는 문장 하나, 유형 3 만 앞 문장 둘이다.
//
// 오프셋은 지문 본문 기준이라 자른 뒤에는 **문맥 기준으로 다시 계산**해야 한다.
// 이 변환을 화면에서 하면 매번 틀리므로 여기 한 곳에 둔다.
// ============================================================

export type TaskRow = {
  id: string
  type: number
  direction: string | null
  context_start: number
  context_end: number
  stimulus_start: number
  stimulus_end: number
  target_form: string | null
  answer_start: number | null
  answer_end: number | null
  avoid_words: string | null
}

export type TaskView = {
  id: string
  type: 1 | 2 | 3
  direction: string | null
  /** 학생에게 보여줄 문맥. 지문 전문이 아니다. */
  context: string
  /** 문맥 안에서 자극이 차지하는 구간 (강조용) */
  highlight: { start: number; end: number }
  /** 유형 2 의 목표 구조 */
  targetForm: "noun_phrase" | "clause" | null
  /** 유형 1 에서 다시 쓰면 안 되는 낱말 */
  avoidWords: string[]
  /** 학생이 조작할 대상 문자열 */
  stimulus: string
  /** 학생에게 보여줄 지시문 */
  prompt: string
  /**
   * 답안 틀. 백지 대신 빈칸을 준다 — 한국 고등학생이 영어 명사구를 처음부터
   * 만들어 내기는 어렵고, 막히면 그날 학습이 사라진다.
   * 유형 3(범위 끌기)에는 채울 칸이 없으므로 null 이다.
   */
  scaffold: Scaffold
}

const PROMPTS: Record<string, string> = {
  "1": "밑줄 친 부분을 다시 쓰세요. 아래 단어는 **다른 말로 바꿔** 표현합니다.",
  "2:fold": "밑줄 친 문장을 **명사구 하나로 묶으세요.** 동사를 남기지 않습니다.",
  "2:unfold": "밑줄 친 명사구를 **문장으로 푸세요.** 주어와 동사를 세웁니다.",
  "3:span": "밑줄 친 표현이 **앞의 무엇을 받는지** 범위를 끌어서 표시하세요.",
  "3:name": "밑줄 친 범위를 하나로 묶는 **명사구**를 쓰세요.",
}

export function promptFor(type: number, direction: string | null): string {
  return PROMPTS[direction ? `${type}:${direction}` : String(type)] ?? "다시 써 보세요."
}

/**
 * 지문 본문에서 문맥만 잘라 화면 모델을 만든다.
 * body 는 서버에만 있고, 돌려주는 것은 자른 조각뿐이다.
 */
export function toTaskView(task: TaskRow, body: string): TaskView {
  const context = body.slice(task.context_start, task.context_end)
  // 자극 오프셋을 문맥 기준으로 옮긴다. 음수가 되면 데이터가 깨진 것이므로
  // 0 으로 뭉개지 말고 그대로 드러나게 둔다(verify 가 잡는다).
  const start = task.stimulus_start - task.context_start
  const end = task.stimulus_end - task.context_start

  return {
    id: task.id,
    type: task.type as 1 | 2 | 3,
    direction: task.direction,
    context,
    highlight: { start, end },
    targetForm: (task.target_form as "noun_phrase" | "clause" | null) ?? null,
    avoidWords: task.avoid_words ? (JSON.parse(task.avoid_words) as string[]) : [],
    stimulus: body.slice(task.stimulus_start, task.stimulus_end),
    prompt: promptFor(task.type, task.direction),
    scaffold: scaffoldFor(
      task.type,
      task.direction,
      body.slice(task.stimulus_start, task.stimulus_end),
      task.avoid_words ? (JSON.parse(task.avoid_words) as string[]) : [],
    ),
  }
}

/** 유형 3 의 정답 범위도 문맥 기준으로. 채점은 서버에서 하므로 클라이언트에 보내지 않는다. */
export function goldSpanInContext(task: TaskRow): { start: number; end: number } | null {
  if (task.answer_start === null || task.answer_end === null) return null
  return {
    start: task.answer_start - task.context_start,
    end: task.answer_end - task.context_start,
  }
}
