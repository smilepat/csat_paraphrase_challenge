// ============================================================
// 학생에게 보여줄 피드백 — **인정 + 개선 팁**.
//
// 진단명만 던지면("비슷하지만 다른 말") 학생은 무엇을 잘했는지도, 무엇을 어떻게
// 고쳐야 하는지도 모른다. 교사가 없는 자습에서 이 문구가 유일한 지도이므로
// 두 부분을 반드시 갖춘다:
//   ① 잘한 것을 먼저 인정한다 — 시도 자체가 학습이고, 대개 절반은 맞다
//   ② 다음에 무엇을 하면 되는지 **행동으로** 말한다
//
// 오답 이름(badge)은 그대로 둔다. 그건 M12 적응형 출제가 읽는 분류이고,
// 학생에게 보이는 문장과 역할이 다르다.
// ============================================================

import type { Type2Meaning } from "./verdict2"

/** 의미 갈래별 기본 문구. LLM 피드백이 없거나 비었을 때 쓴다. */
const TEMPLATE: Record<Type2Meaning, { praise: string; tip: string }> = {
  same: {
    praise: "원문의 뜻을 그대로 옮겼습니다.",
    tip: "",
  },
  narrower: {
    praise: "맞는 내용이지만 일부만 담았습니다.",
    tip: "원문에서 빠진 내용을 한 가지만 더 넣어 보세요.",
  },
  broader: {
    praise: "방향은 맞습니다.",
    tip: "원문보다 뜻이 넓어졌습니다. some·may·often 같은 한정어를 살려 보세요.",
  },
  changed: {
    praise: "다른 표현으로 바꾸려 한 시도가 좋습니다.",
    tip: "다만 원문에 없는 내용이 들어갔습니다. 원문의 핵심 낱말 하나를 다시 확인해 보세요.",
  },
  reversed: {
    praise: "표현을 바꾼 것은 잘했습니다.",
    tip: "다만 뜻이 반대가 되었습니다. 긍정·부정 표현을 다시 확인해 보세요.",
  },
}

/**
 * 인정 문구 + 팁을 합쳐 한 덩어리로 만든다.
 *
 * LLM 이 준 피드백이 있으면 **팁 자리에** 넣는다 — 그쪽이 이 답안에만 해당하는
 * 구체적인 말이기 때문이다. 인정 문구는 갈래에서 가져와 항상 앞에 둔다.
 */
export function meaningFeedback(meaning: Type2Meaning, llmTip?: string): string {
  const t = TEMPLATE[meaning]
  // 맞았으면 팁을 붙이지 않는다. 판정이 "다른 유사한 단어를 더 찾아보세요" 같은
  // 군더더기를 붙여 오는데, 정답을 받은 학생에게는 잡음이다.
  if (meaning === "same") return t.praise
  const tip = (llmTip ?? "").trim() || t.tip
  return tip ? `${t.praise} ${tip}` : t.praise
}

/** 무료 단계에서 떨어진 유형 1 — 아직 아무것도 안 바꾼 경우. */
export function notRewordedFeedback(reused: string[]): string {
  const head = "원문의 내용은 잘 파악했습니다."
  if (reused.length === 0) return `${head} 이제 자기 표현으로 바꿔 보세요.`
  return `${head} ${reused.slice(0, 3).join(", ")} 은(는) 원문에 있던 낱말입니다 — 이 중 하나만 먼저 바꿔 보세요.`
}

/** 유형 2 에서 구조를 아직 못 바꾼 경우. */
export function structureFeedback(target: "noun_phrase" | "clause", cue: string | null): string {
  return target === "noun_phrase"
    ? `뜻은 잘 담았습니다. 이제 "${cue ?? "동사"}" 를 명사로 바꿔 명사구 하나로 만들어 보세요.`
    : "뜻은 잘 담았습니다. 이제 주어와 동사를 갖춘 문장으로 바꿔 보세요."
}
