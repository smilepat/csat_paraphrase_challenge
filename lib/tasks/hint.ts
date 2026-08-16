// ============================================================
// 힌트 사다리 — 막힌 학생을 **한 칸씩** 끌어올린다.
//
// 예전에는 힌트가 한 칸이었고 **전략**만 줬다("동사를 명사로 바꾸세요").
// 그런데 한국 학생이 실제로 막히는 자리는 그 앞이다:
//   ① 이 표현이 무슨 뜻인지 모른다        → 전략을 알아도 쓸 것이 없다
//   ② 뜻은 아는데 영어 낱말이 안 떠오른다  → 인출 실패이지 이해 실패가 아니다
//   ③ vary 의 명사형이 variability 인 줄 모른다 → 어형 지식이지 패러프레이즈 능력이 아니다
// 자습이라 물어볼 사람도 없다. "혼자 만들어 내라"로는 그 자리에서 끝난다.
//
// 그래서 네 칸으로 나눈다. **한 번에 하나씩** 열리고, 학생이 더 달라고 해야 다음이 나온다.
//
//   1 뜻    한국어 뜻만. 무엇을 말할지 알려 주고 어떻게 말할지는 그대로 남긴다.
//   2 전략  예전의 그 힌트. 어떤 조작을 하는 유형인지.
//   3 재료  유형1 첫 글자+낱말 수 / 유형2 어형(vary → variability).
//           **답이 아니다** — 인출을 돕는 발판이다.
//   4 예시  가능한 답 하나. 여기까지 와도 아무것도 못 쓰는 것보다는 낫다.
//
// 1·3·4 는 미리 만들어 둔 재료(pc_tasks.hints)를 쓴다. 재료가 없으면 그 칸을
// **건너뛴다** — 빈 칸을 보여 주면 학생은 힌트가 고장 났다고 생각한다.
//
// 어디까지 썼는지는 시도 기록에 남는다(flags: hint:2 …). 지원을 줄여 가는 것이
// 교수 설계의 요점이고, 무도움 성적과 섞이면 그 추적이 불가능해진다.
// ============================================================

import { findFiniteVerb, firstVerbLike } from "../scoring/typed/structure"

export type Hint = { label: string; body: string } | null

/** 미리 만들어 둔 힌트 재료. build-hints.mjs 가 채운다. */
export type HintMaterial = {
  /** 대상 표현의 한국어 뜻 */
  gloss?: string
  /** 유형 1 인출 발판 — "s______ e______  (2낱말)" */
  shape?: string
  /** 유형 2 어형 — "vary → variability" */
  form?: string
  /** 가능한 답 하나 */
  example?: string
}

export type HintStep = {
  /** 1부터 */
  level: number
  label: string
  body: string
}

/** 명사구의 머리 낱말. "the variability of X" → variability */
function headNoun(np: string): string | null {
  const m = np.match(/^\s*(?:the|a|an)\s+((?:[A-Za-z-]+\s+){0,2}?[A-Za-z-]+)\s+of\b/i)
  if (m) return m[1]!.split(/\s+/).pop() ?? null
  const words = np.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  return words.length ? words[words.length - 1]!.replace(/[^A-Za-z-]/g, "") : null
}

/** 문장의 주어 자리(첫 명사구)를 거칠게 집는다. of 보문의 재료로 쓴다. */
function roughSubject(sentence: string): string | null {
  const m = sentence.match(
    /^\s*(?:[A-Z][a-z]*ly,?\s+)?((?:the|a|an|this|these|those)\s+)?([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2})/,
  )
  return m ? `${m[1] ?? ""}${m[2]}`.trim() : null
}

/** 2칸 — 전략. 예전의 그 힌트다. 재료가 없어도 항상 만들 수 있다. */
function strategyHint(type: number, direction: string | null, stimulus: string, avoidWords: string[]): string {
  if (type === 2 && direction === "fold") {
    // 정형 판별은 "often vary" 같은 것을 놓친다. 힌트에서는 느슨한 쪽을 먼저 쓴다.
    const cue = firstVerbLike(stimulus) ?? findFiniteVerb(stimulus).cue
    const subject = roughSubject(stimulus)
    if (!cue) return "문장의 동사를 찾아 명사로 바꾸는 데서 시작해 보세요."
    return (
      `핵심 동사는 “${cue}” 입니다. 이 동사를 **명사**로 바꾸고, ` +
      (subject ? `“${subject}” 을(를) of 뒤에 붙여 보세요.` : "무엇에 대한 것인지를 of 뒤에 붙여 보세요.") +
      `  예: the …ity / …tion / …ment of …`
    )
  }
  if (type === 2 && direction === "unfold") {
    const head = headNoun(stimulus)
    if (!head) return "이 명사구를 누가·무엇이 어떻게 하는지로 풀어 보세요."
    return (
      `머리 단어는 “${head}” 입니다. 이 단어를 **동사나 형용사로 풀고**, ` +
      `주어를 세워 문장으로 만들어 보세요.  예: how … is / can be …`
    )
  }
  if (type === 1) {
    const first = avoidWords[0]
    return first
      ? `한 번에 다 바꾸지 않아도 됩니다. “${first}” 하나만 다른 말로 바꾸는 것부터 해 보세요.`
      : "핵심 단어 하나만 다른 말로 바꾸는 것부터 해 보세요."
  }
  if (type === 3) {
    return "되받는 표현 **바로 앞 문장**부터 보세요. 대개 거기서 나열이나 설명이 끝납니다."
  }
  return ""
}

/**
 * 이 문항에서 실제로 열 수 있는 칸들을 순서대로 만든다.
 *
 * 재료가 없는 칸은 **아예 넣지 않는다.** 그래서 level 은 배열의 위치이지
 * 고정된 의미가 아니다 — 유형 3 은 대개 [뜻, 전략] 두 칸뿐이다.
 */
export function hintSteps(
  type: number,
  direction: string | null,
  stimulus: string,
  avoidWords: string[],
  material: HintMaterial | null,
): HintStep[] {
  const steps: HintStep[] = []
  const m = material ?? {}

  if (m.gloss) {
    steps.push({
      level: 0,
      label: "무슨 뜻인가요",
      body: `“${m.gloss}” 라는 뜻입니다. 이 내용을 **영어로 다시 말해** 보세요.`,
    })
  }

  const strategy = strategyHint(type, direction, stimulus, avoidWords)
  if (strategy) steps.push({ level: 0, label: "어떻게 시작하나요", body: strategy })

  if (type === 1 && m.shape) {
    steps.push({
      level: 0,
      label: "이런 모양입니다",
      body: `한 가지 가능한 답의 모양입니다 — ${m.shape}\n첫 글자만 보고 떠올려 보세요. 다른 답도 맞을 수 있습니다.`,
    })
  }
  if (type === 2 && m.form) {
    steps.push({
      level: 0,
      label: "낱말 모양 바꾸기",
      body: `${m.form}\n이 어형 변화를 쓰면 나머지는 조립만 하면 됩니다.`,
    })
  }

  if (m.example) {
    steps.push({
      level: 0,
      label: "예시 답",
      body: `${m.example}\n**정답이 아니라 가능한 답 하나**입니다. 읽고 나서 자기 말로 다시 써 보세요.`,
    })
  }

  return steps.map((s, i) => ({ ...s, level: i + 1 }))
}
