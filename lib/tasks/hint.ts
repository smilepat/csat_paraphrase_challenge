// ============================================================
// 힌트 — 학생이 막혔을 때 주는 **첫 발판**.
//
// 왜 필요한가: 지금 학생 화면은 빈칸 하나뿐이다. "이 문장을 이름 하나로 접으세요"는
// EFL 학생에게 상당히 어렵고, 막히면 아무것도 못 쓰고 끝난다. 교사가 없는 자습에서
// 그건 그날의 학습이 통째로 사라지는 것이다.
//
// 다만 **답을 주지는 않는다.** 어디서 시작할지만 알려 준다:
//   접기(fold)   → 이 문장의 핵심 동사가 무엇인지. 그 동사를 이름으로 바꾸는 데서 시작한다.
//   펴기(unfold) → 이 이름의 머리 낱말이 무엇인지. 그 낱말을 풀어 문장을 세운다.
//   유형 1       → 바꿀 낱말 하나를 집어 준다(전부가 아니라 하나만).
//   유형 3       → 어디서부터 볼지(직전 문장) 알려 준다.
//
// 힌트는 **요청해야 나온다.** 산출을 먼저 시도하게 하려는 것이고, 썼다는 사실은
// 시도 기록에 남는다(교수 설계의 "지원 감소"와 같은 취지).
// ============================================================

import { findFiniteVerb, firstVerbLike } from "../scoring/typed/structure"

export type Hint = { label: string; body: string } | null

/** 명사구의 머리 낱말. "the variability of X" → variability */
function headNoun(np: string): string | null {
  const m = np.match(/^\s*(?:the|a|an)\s+((?:[A-Za-z-]+\s+){0,2}?[A-Za-z-]+)\s+of\b/i)
  if (m) return m[1]!.split(/\s+/).pop() ?? null
  const words = np.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  return words.length ? words[words.length - 1]!.replace(/[^A-Za-z-]/g, "") : null
}

/** 문장의 주어 자리(첫 명사구)를 거칠게 집는다. of 보문의 재료로 쓴다. */
function roughSubject(sentence: string): string | null {
  const m = sentence.match(/^\s*(?:[A-Z][a-z]*ly,?\s+)?((?:the|a|an|this|these|those)\s+)?([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2})/)
  return m ? `${m[1] ?? ""}${m[2]}`.trim() : null
}

export function hintFor(
  type: number,
  direction: string | null,
  stimulus: string,
  avoidWords: string[],
): Hint {
  if (type === 2 && direction === "fold") {
    // 정형 판별은 "often vary" 같은 것을 놓친다. 힌트에서는 느슨한 쪽을 먼저 쓴다.
    const cue = firstVerbLike(stimulus) ?? findFiniteVerb(stimulus).cue
    const subject = roughSubject(stimulus)
    if (!cue) return { label: "시작점", body: "문장의 동사를 찾아 그것을 이름(명사)으로 바꾸는 데서 시작해 보세요." }
    return {
      label: "시작점",
      body:
        `핵심 동사는 “${cue}” 입니다. 이 동사를 **이름(명사)** 으로 바꾸고, ` +
        (subject ? `“${subject}” 을(를) of 뒤에 붙여 보세요.` : "무엇에 대한 것인지를 of 뒤에 붙여 보세요.") +
        `  예: the …ity / …tion / …ment of …`,
    }
  }

  if (type === 2 && direction === "unfold") {
    const head = headNoun(stimulus)
    if (!head) return { label: "시작점", body: "이 이름을 누가·무엇이 어떻게 하는지로 풀어 보세요." }
    return {
      label: "시작점",
      body:
        `머리 낱말은 “${head}” 입니다. 이 낱말을 **동사나 형용사로 풀고**, ` +
        `주어를 세워 문장으로 만들어 보세요.  예: how … is / can be …`,
    }
  }

  if (type === 1) {
    const first = avoidWords[0]
    return {
      label: "시작점",
      body: first
        ? `한 번에 다 바꾸지 않아도 됩니다. “${first}” 하나만 다른 말로 바꾸는 것부터 해 보세요.`
        : "핵심 낱말 하나만 다른 말로 바꾸는 것부터 해 보세요.",
    }
  }

  if (type === 3) {
    return {
      label: "시작점",
      body: "되받는 표현 **바로 앞 문장**부터 보세요. 대개 거기서 나열이나 설명이 끝납니다.",
    }
  }

  return null
}
