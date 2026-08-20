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
          ? `${reused.slice(0, 4).join(", ")} 은(는) 원문에 있던 낱말입니다. 같은 뜻을 다른 낱말로 표현해 보세요.`
          : "원문을 거의 그대로 옮겼습니다. 자기 표현으로 바꿔 보세요.",
    }
  }
  return {
    avoidance,
    reused,
    fail: false,
    message: reused.length ? `아직 바꾸지 않은 낱말: ${reused.slice(0, 3).join(", ")}` : "",
  }
}

/** 회피율을 0~1 점수로. minAvoidance 아래는 0, fullAvoidance 위는 1, 사이는 선형. */
export function avoidanceScore(avoidance: number): number {
  const { minAvoidance: lo, fullAvoidance: hi } = TYPE1
  if (avoidance <= lo) return 0
  if (avoidance >= hi) return 1
  return (avoidance - lo) / (hi - lo)
}

/**
 * 남긴 낱말 **개수**로 매기는 계수. 비율이 아니라 개수인 것이 요점이다.
 *
 * 왜 바꿨나: 비율로 재면 목록이 짧을수록 낱말 하나가 무거워진다. 승인된 유형 1
 * **181건 중 149건(82%)이 피할 낱말 2개**라, 뜻을 정확히 옮기고 낱말 하나만
 * 남긴 답이 **35점**을 받고 있었다. 3개짜리 문항이면 같은 답이 71점이다 —
 * 학생이 한 일은 같은데 점수가 문항 사정에 따라 갈렸다.
 *
 * 이 앱은 판정보다 **학습을 권한다.** 그래서:
 *   ① 뜻이 맞았으면 점수의 중심은 뜻이다. 표현 바꾸기는 성장 축이지 처벌 축이 아니다.
 *   ② 남긴 낱말은 **하나당 같은 무게**로만 깎는다(문항 길이와 무관).
 *   ③ 바닥을 둔다 — 뜻을 옮긴 학생이 절반 아래로 떨어지지 않는다.
 *
 * 그래도 **아무것도 안 바꾼 답은 0 이다.** 그건 무료 게이트(minAvoidance)가
 * 먼저 걸러 내고 "이 중 하나만 먼저 바꿔 보세요" 로 되돌린다 — 과제를 안 한
 * 답에 점수를 주면 이 유형이 재려는 것이 사라진다.
 *
 * 뜻이 완벽할 때 나오는 점수:  0개 남김 100 · 1개 80 · 2개 60(바닥)
 */
export const TYPE1_KEEP = {
  /** 남긴 낱말 하나당 깎는 비율 */
  penaltyPerWord: 0.2,
  /** 아무리 깎여도 여기까지 — 뜻을 옮긴 것은 그 자체로 절반 이상의 일이다 */
  floor: 0.6,
} as const

export function avoidanceFactor(reusedCount: number): number {
  return Math.max(TYPE1_KEEP.floor, 1 - TYPE1_KEEP.penaltyPerWord * Math.max(0, reusedCount))
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
  // 남긴 낱말 **개수**로 깎는다. 비율로 재던 시절에는 목록이 2개인 문항(전체의 82%)에서
  // 뜻이 완벽한 답이 35점을 받았다 — 학생이 한 일은 같은데 문항 사정으로 점수가 갈렸다.
  const avoidance = avoidanceFactor(free.reused.length)

  if (free.fail) {
    return {
      score: 0,
      errorName: "원문 표현 그대로",
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
      message: "낱말은 바꿨습니다. 지금은 뜻까지 확인하지 못했으니 잠시 뒤 다시 제출해 보세요.",
      suggested: "",
      judged: false,
      parts: { meaning: 0.5, avoidance },
    }
  }

  // 무료 검사는 어간만 본다. 동의어를 옮긴 수준인지는 판정이 한 번 더 본다.
  if (!verdict.reworded) {
    return {
      score: 0,
      errorName: "원문 표현 그대로",
      message: notRewordedFeedback([]),
      suggested: verdict.suggested,
      judged: true,
      parts: { meaning: MEANING_SCORE[verdict.meaning] / 100, avoidance },
    }
  }

  const meaning = MEANING_SCORE[verdict.meaning] / 100
  const score = Math.round(100 * meaning * avoidance)

  // 남긴 낱말은 **감점 사유가 아니라 다음 할 일**로 말한다. 예전에는 이 정보가
  // 점수에만 반영되고 화면에서는 사라져서, 학생은 왜 100점이 아닌지 알 수 없었다.
  const keptTip = free.reused.length
    ? ` 아직 원문 그대로인 낱말: ${free.reused.slice(0, 3).join(", ")} — 이것까지 바꾸면 만점입니다.`
    : ""

  return {
    score,
    errorName: verdict.meaning === "same" ? null : MEANING_LABEL[verdict.meaning],
    // 진단명이 아니라 **인정 + 팁**을 보여 준다. 진단명은 배지로만 남는다.
    message: meaningFeedback(verdict.meaning, verdict.koreanFeedback) + keptTip,
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
