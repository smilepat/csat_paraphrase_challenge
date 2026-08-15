// ============================================================
// 유형 3 채점 — 되받는 이름이 앞의 무엇을 받는가.
//
// **경계가 먼저다.** 이름이 그럴듯한지보다 학생이 표시한 범위가 맞는지가 먼저이고,
// 범위가 틀렸으면 이름은 채점하지 않는다. 순서·삽입 문항의 실제 정답 근거가
// 이 범위이기 때문이다 — "느낌상 자연스러워서"를 못 쓰게 하는 것이 훈련의 요점이다.
//
// 범위는 문자 오프셋으로 받는다(restorative-reading 의 span 앵커와 같은 방식).
// 채점은 겹침(IoU)이고, 무료다 — LLM 은 이름의 적절성에만 쓴다.
// ============================================================

export type Span = { start: number; end: number }

export type Type3Input = {
  /** 학생이 표시한 선행 범위 */
  answer: Span
  /** 검수를 통과한 정답 범위 */
  gold: Span
  /** 되받는 표현이 시작하는 위치. 범위는 이보다 앞이어야 한다 */
  stimulusStart: number
  /** 학생이 쓴 이름(선택). 범위가 맞았을 때만 채점한다 */
  name?: string
}

export const TYPE3 = {
  /** 이 겹침 이상이면 범위를 맞힌 것으로 본다 */
  hit: 0.6,
  /** 이 아래는 사실상 다른 곳을 가리킨 것 */
  miss: 0.2,
} as const

/** 겹침 / 합집합. 두 범위가 같으면 1, 안 겹치면 0. */
export function overlap(a: Span, b: Span): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start)
  return union <= 0 ? 0 : inter / union
}

export type Type3Free = {
  iou: number
  /** hit | partial | miss | invalid */
  verdict: "hit" | "partial" | "miss" | "invalid"
  message: string
  /** 이름을 채점할 가치가 있는가 = 유료 판정으로 넘길지 */
  nameWorthJudging: boolean
}

/**
 * 무료 1단. 범위만 본다.
 *
 * 범위가 되받는 표현보다 **뒤**에 있으면 되받기가 아니다 — 앞에 있는 것을
 * 받는 장치이므로 방향이 어긋나면 개념을 잘못 이해한 것이고, 겹침을 재기 전에
 * 그것부터 말해 줘야 한다.
 */
export function checkSpan(input: Type3Input): Type3Free {
  const { answer, gold, stimulusStart } = input

  if (answer.end <= answer.start) {
    return { iou: 0, verdict: "invalid", message: "범위를 표시하지 않았습니다.", nameWorthJudging: false }
  }
  if (answer.start >= stimulusStart) {
    return {
      iou: 0,
      verdict: "invalid",
      message: "되받는 이름은 **앞의** 내용을 받습니다. 표현보다 앞에서 범위를 찾아보세요.",
      nameWorthJudging: false,
    }
  }

  const iou = overlap(answer, gold)

  if (iou >= TYPE3.hit) {
    return { iou, verdict: "hit", message: "받는 범위를 맞혔습니다.", nameWorthJudging: true }
  }
  if (iou <= TYPE3.miss) {
    return {
      iou,
      verdict: "miss",
      message: "다른 곳을 가리켰습니다. 이 표현 바로 앞 문장부터 다시 보세요.",
      nameWorthJudging: false,
    }
  }
  // 겹치긴 하는데 경계가 어긋났다 — 어느 쪽으로 어긋났는지 말해 준다
  const tooShort = answer.end - answer.start < gold.end - gold.start
  return {
    iou,
    verdict: "partial",
    message: tooShort
      ? "범위가 짧습니다. 나열이 어디서 시작하는지 다시 보세요."
      : "범위가 넓습니다. 이 표현이 실제로 받는 데까지만 잡아 보세요.",
    nameWorthJudging: false,
  }
}

export type Type3Final = {
  score: number
  errorName: string | null
  message: string
  parts: { span: number; name: number | null }
}

/** 겹침을 0~1 점수로. hit 이상 만점, miss 이하 0, 사이는 선형. */
export function spanScore(iou: number): number {
  if (iou >= TYPE3.hit) return 1
  if (iou <= TYPE3.miss) return 0
  return (iou - TYPE3.miss) / (TYPE3.hit - TYPE3.miss)
}

/**
 * 범위 점수와 (선택적) 이름 판정을 합친다.
 * 이름 판정이 없으면 범위만으로 낸다 — 범위가 맞았는지가 이 유형의 본체다.
 */
export function finalizeType3(free: Type3Free, nameOk: boolean | null): Type3Final {
  const span = spanScore(free.iou)

  if (free.verdict === "invalid" || free.verdict === "miss") {
    return {
      score: 0,
      errorName: "되받는 범위를 못 찾음",
      message: free.message,
      parts: { span, name: null },
    }
  }
  if (free.verdict === "partial") {
    return {
      score: Math.round(60 * span),
      errorName: "범위 경계가 어긋남",
      message: free.message,
      parts: { span, name: null },
    }
  }

  // hit
  if (nameOk === null) {
    return { score: 100, errorName: null, message: free.message, parts: { span, name: null } }
  }
  return {
    score: nameOk ? 100 : 70,
    errorName: nameOk ? null : "범위는 맞지만 이름이 어긋남",
    message: nameOk ? free.message : "받는 곳은 맞았습니다. 그 내용을 담는 이름인지 다시 보세요.",
    parts: { span, name: nameOk ? 1 : 0 },
  }
}
