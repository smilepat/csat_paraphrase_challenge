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

/**
 * 문장의 주어 자리(첫 명사구)를 거칠게 집는다. of 보문의 재료로 쓴다.
 *
 * ⚠ 앞에서 세 낱말을 그냥 떼면 **동사까지 물고 온다** — "Surprises can fall" 을
 *   주어라고 보여 주면, 정작 "동사를 명사로 바꾸라"는 같은 힌트 안에서 동사가
 *   주어 자리에 앉아 있게 된다. 그래서 동사처럼 보이는 낱말 앞에서 끊는다.
 */
function roughSubject(sentence: string): string | null {
  const m = sentence.match(
    /^\s*(?:[A-Z][a-z]*ly,?\s+)?((?:the|a|an|this|these|those)\s+)?([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2})/,
  )
  if (!m) return null
  const words = `${m[1] ?? ""}${m[2]}`.trim().split(/\s+/)
  const cut = words.findIndex((w, i) => i > 0 && firstVerbLike(w) !== null)
  const kept = cut > 0 ? words.slice(0, cut) : words
  const subject = kept.join(" ").trim()
  return subject.length >= 2 ? subject : null
}

/**
 * "vary → variability" 에서 **왼쪽**(학생이 이미 문장에서 볼 수 있는 낱말)을 꺼낸다.
 *
 * 이것이 2칸의 정본이다. 예전에는 2칸이 `firstVerbLike` 로, 3칸이 LLM 이 준 `form`
 * 으로 각자 낱말을 골랐고, **45% 가 서로 다른 낱말을 가리켰다** —
 * 2칸 "핵심 동사는 fall", 3칸 "change → alteration". 막혀서 도움을 청한 학생에게
 * 모순된 지시를 준 것이다. 두 칸이 한 낱말에서 나오게 하면 어긋날 수가 없다.
 */
function formBase(form: string | undefined): string | null {
  if (!form) return null
  const left = form.split(/[→>]/)[0]?.trim()
  if (!left) return null
  // "size, complexity → large, complex" 처럼 둘일 수 있다. 첫 낱말만 짚어 준다.
  const first = left.split(/[,;]/)[0]!.trim()
  return first.length >= 2 ? first : null
}

/** 2칸 — 전략. 재료가 있으면 그 낱말을 쓰고, 없으면 예전처럼 문장에서 찾는다. */
function strategyHint(
  type: number,
  direction: string | null,
  stimulus: string,
  avoidWords: string[],
  material: HintMaterial,
): string {
  if (type === 2 && direction === "fold") {
    // 재료의 낱말이 우선이다. LLM 은 문장 전체를 보고 **명사형이 있는** 동사를 고르는데,
    // firstVerbLike 는 앞에서부터 훑기만 해서 명사(`amount`)를 동사로 집기도 한다.
    // 정형 판별은 "often vary" 같은 것을 놓치므로 마지막 폴백으로만 둔다.
    const cue = formBase(material.form) ?? firstVerbLike(stimulus) ?? findFiniteVerb(stimulus).cue
    const subject = roughSubject(stimulus)
    if (!cue) return "문장의 동사를 찾아 명사로 바꾸는 것부터 시작해 보세요."
    return (
      `핵심 동사는 “${cue}” 입니다. 이 동사를 **명사**로 바꾸고, ` +
      (subject ? `“${subject}” 을(를) of 뒤에 붙여 보세요.` : "무엇에 대한 것인지를 of 뒤에 붙여 보세요.") +
      `  예: the …ity / …tion / …ment of …`
    )
  }
  if (type === 2 && direction === "unfold") {
    // 펴기도 같은 정본을 쓴다. "centrality → central" 의 왼쪽이 머리 낱말이다.
    const head = formBase(material.form) ?? headNoun(stimulus)
    if (!head) return "이 명사구를 「누가 무엇을 한다」는 문장으로 바꿔 보세요."
    return (
      `핵심 낱말은 “${head}” 입니다. 이 낱말을 **동사나 형용사로 바꾸고**, ` +
      `주어를 세워 문장으로 만들어 보세요.  예: how … is / can be …`
    )
  }
  if (type === 1) {
    const first = avoidWords[0]
    return first
      ? `한 번에 다 바꾸지 않아도 됩니다. “${first}” 하나만 다른 표현으로 바꾸는 것부터 해 보세요.`
      : "핵심 낱말 하나만 다른 표현으로 바꾸는 것부터 해 보세요."
  }
  if (type === 3) {
    return "가리키는 표현 **바로 앞 문장**부터 살펴보세요. 대개 그 앞에서 설명이 끝납니다."
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
      label: "우리말 뜻",
      body: `“${m.gloss}” 라는 뜻입니다. 이 내용을 **영어로 다시 표현해** 보세요.`,
    })
  }

  const strategy = strategyHint(type, direction, stimulus, avoidWords, m)
  if (strategy) steps.push({ level: 0, label: "푸는 방법", body: strategy })

  if (type === 1 && m.shape) {
    steps.push({
      level: 0,
      label: "답의 형태",
      body: `가능한 답의 형태입니다 — ${m.shape}\n첫 글자를 단서로 떠올려 보세요. 다른 답도 정답이 될 수 있습니다.`,
    })
  }
  if (type === 2 && m.form) {
    steps.push({
      level: 0,
      label: "품사 바꾸기",
      body: `${m.form}\n이렇게 품사를 바꾸면 나머지는 이어 붙이면 됩니다.`,
    })
  }

  if (m.example) {
    steps.push({
      level: 0,
      label: "예시 답안",
      body: `${m.example}\n**유일한 정답이 아니라 답안 예시 하나**입니다. 읽은 뒤 자기 표현으로 다시 써 보세요.`,
    })
  }

  return steps.map((s, i) => ({ ...s, level: i + 1 }))
}
