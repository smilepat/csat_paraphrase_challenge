// ============================================================
// 유형 1 채점 — 같은 개념을 다른 단어로. **2단 구조**는 유형 2 와 같다.
//
//   1단 회피 검사(무료)  … 자극의 내용어를 얼마나 안 썼는가
//   2단 의미 판정(유료)  … 회피에서 살아남은 답안만 넘긴다
//
// ⚠ 두 축은 **곱한다.** 합으로 하면 "뜻은 틀렸는데 단어만 바꾼 답"이 절반을 가져간다.
//   그게 학생이 가장 많이 하는 실패이고, 오답 5종의 "비슷하지만 다른 말"이
//   정확히 그 상태다. 곱으로 두면 한쪽이 0 일 때 0 이 된다.
//
// guards.ts 의 surfaceOverlap 을 쓰지 않는 이유: 그건 자카드(대칭)라
// "겹치는가"만 잰다. 여기서 필요한 것은 방향이 있는 **회피율** —
// 자극의 내용어 중 학생이 다시 쓰지 않은 비율이다. 채굴 때 태스크에
// 저장해 둔 avoid_words 가 그 목록이다.
// ============================================================

export type Type1Input = {
  answer: string
  stimulus: string
  /**
   * 다르게 표현해야 할 내용어. 없으면 자극에서 즉석으로 만든다.
   * **금지 목록이 아니다** — 과제는 회피가 아니라 치환이다. 쓰면 벌하는 것이 아니라
   * 바꾸지 않은 만큼 점수가 덜 오른다.
   */
  avoidWords: string[]
}

export type Type1Free = {
  /** 0~1. 대상 낱말을 모두 다른 말로 바꿨으면 1 */
  avoidance: number
  /** 그대로 다시 쓴 낱말 */
  reused: string[]
  /** 무료 단계에서 이미 떨어졌는가 */
  fail: boolean
  message: string
}

export const TYPE1 = {
  /** 이보다 회피율이 낮으면 다시 쓴 것이 아니라 옮긴 것이다 — 유료 판정을 부르지 않는다 */
  minAvoidance: 0.34,
  /** 만점을 주는 회피율. 기능어까지 다 바꾸라고 요구하지는 않는다 */
  fullAvoidance: 0.8,
} as const

/** 굴절을 벗긴 어간 근사. paraphrase 를 굴절형으로 회피했다고 인정하지 않기 위한 것. */
function stem(w: string): string {
  return w
    .replace(/(ies)$/, "y")
    .replace(/(ing|ed|es|s)$/, "")
    .replace(/(e)$/, "")
}

function contentTokens(text: string): string[] {
  return (text.toLowerCase().replace(/[’ʼ]/g, "'").match(/[a-z][a-z'-]{2,}/g) ?? []).map(
    (w) => w.replace(/^['-]+|['-]+$/g, ""),
  )
}

/**
 * 무료 1단. 대상 낱말을 얼마나 다른 말로 바꿨는가.
 * **굴절형도 재사용으로 본다** — "variability" 를 "variable" 로 바꾼 것은
 * 다른 단어로 말한 것이 아니라 같은 낱말을 굴려 쓴 것이다.
 */
export function checkAvoidance(input: Type1Input): Type1Free {
  const avoid = input.avoidWords.length
    ? input.avoidWords
    : [...new Set(contentTokens(input.stimulus))]
  if (avoid.length === 0) {
    return { avoidance: 1, reused: [], fail: false, message: "" }
  }

  const answerStems = new Set(contentTokens(input.answer).map(stem))
  const reused = avoid.filter((w) => answerStems.has(stem(w.toLowerCase())))
  const avoidance = 1 - reused.length / avoid.length

  if (avoidance < TYPE1.minAvoidance) {
    return {
      avoidance,
      reused,
      fail: true,
      message:
        reused.length > 0
          ? `${reused.slice(0, 4).join(", ")} 은(는) 아직 원문 그대로입니다. 같은 뜻을 다른 단어로 말해 보세요.`
          : "원문을 거의 그대로 옮겼습니다. 자기 말로 바꿔 보세요.",
    }
  }
  return {
    avoidance,
    reused,
    fail: false,
    message: reused.length ? `아직 바꾸지 않은 단어: ${reused.slice(0, 3).join(", ")}` : "",
  }
}

/** 회피율을 0~1 점수로. minAvoidance 아래는 0, fullAvoidance 위는 1, 사이는 선형. */
export function avoidanceScore(avoidance: number): number {
  const { minAvoidance: lo, fullAvoidance: hi } = TYPE1
  if (avoidance <= lo) return 0
  if (avoidance >= hi) return 1
  return (avoidance - lo) / (hi - lo)
}

// ── 2단: 의미 판정을 곱해 최종 점수를 낸다 ────────────────────

import { MEANING_LABEL, MEANING_SCORE } from "./type2"
import { meaningFeedback, notRewordedFeedback } from "./feedback"
import type { Type1Verdict } from "./verdict1"

export type Type1Final = {
  score: number
  errorName: string | null
  message: string
  suggested: string
  judged: boolean
  /** 감사용 — 두 축이 각각 얼마였는지 남긴다 */
  parts: { meaning: number; avoidance: number }
}

/**
 * 의미 × 회피. **곱이지 합이 아니다.**
 * 합으로 하면 뜻이 틀렸는데 단어만 바꾼 답이 절반을 가져가고, 그게 학생이
 * 가장 많이 하는 실패다(오답 5종의 "비슷하지만 다른 말").
 */
export function finalizeType1(
  free: Type1Free,
  verdict: Type1Verdict | null,
): Type1Final {
  const avoidance = avoidanceScore(free.avoidance)

  if (free.fail) {
    return {
      score: 0,
      errorName: "원문 단어를 아직 안 바꿈",
      message: notRewordedFeedback(free.reused),
      suggested: "",
      judged: false,
      parts: { meaning: 0, avoidance },
    }
  }

  if (!verdict) {
    return {
      score: Math.round(50 * avoidance),
      errorName: null,
      message: "단어는 바꿨습니다. 의미 확인은 잠시 뒤에 다시 시도합니다.",
      suggested: "",
      judged: false,
      parts: { meaning: 0.5, avoidance },
    }
  }

  // 무료 검사는 어간만 본다. 동의어를 옮긴 수준인지는 판정이 한 번 더 본다.
  if (!verdict.reworded) {
    return {
      score: 0,
      errorName: "원문 단어를 아직 안 바꿈",
      message: notRewordedFeedback([]),
      suggested: verdict.suggested,
      judged: true,
      parts: { meaning: MEANING_SCORE[verdict.meaning] / 100, avoidance },
    }
  }

  const meaning = MEANING_SCORE[verdict.meaning] / 100
  const score = Math.round(100 * meaning * avoidance)
  return {
    score,
    errorName: verdict.meaning === "same" ? null : MEANING_LABEL[verdict.meaning],
    // 진단명이 아니라 **인정 + 팁**을 보여 준다. 진단명은 배지로만 남는다.
    message: meaningFeedback(verdict.meaning, verdict.koreanFeedback),
    // 만점이면 고칠 것이 없다. "이 답을 고친다면" 을 붙이면 잘한 학생에게 트집처럼
    // 읽히고, 판정기가 가끔 내놓는 **엉뚱한 문장**이 하필 거기서 가장 크게 보인다.
    // (실측: 100점 답안에 "confirm the data you obtain is precise and dependable" 이 붙었다.
    //  문항과 아무 상관이 없는 문장이었고, 화면에서는 그것이 조언처럼 보인다.)
    // 모범답안 칸은 그대로 나가므로 견줄 것은 여전히 있다.
    suggested: score >= 100 ? "" : verdict.suggested,
    judged: true,
    parts: { meaning, avoidance },
  }
}
