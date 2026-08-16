// ============================================================
// 답안 틀(scaffold) — 백지 대신 **빈칸이 든 틀**을 준다.
//
// 왜: 한국 고등학생이 영어로 명사구를 처음부터 만들어 내는 것은 어렵다. 백지 앞에서
// 막히면 그날 학습이 통째로 사라진다. 틀을 주면 **어디에 무엇을 넣을지**가 보이고,
// 학생은 이 유형이 실제로 재려는 조작(단어 바꾸기 / 명사화 / 묶기)에만 집중하게 된다.
//
// 답을 주지는 않는다. 틀과 재료 단어만 준다 — 채우는 것은 학생이다.
//
// 유형별로 틀의 성격이 다르다:
//   1 다른 단어로  → 문장 그대로 두고 **대상 단어만 빈칸**. 전형적인 cloze.
//   2 묶기(fold)   → `the (   ) of (   )` — 명사화의 뼈대
//   2 풀기(unfold) → `(주어) (서술어)`   — 절의 뼈대
//   3 앞 내용 묶기 → 틀이 없다. 범위를 끄는 과제라 채울 칸이 없다.
// ============================================================

import { findFiniteVerb, firstVerbLike } from "../scoring/typed/structure"

export type Slot = {
  /** 이 칸에 무엇을 넣어야 하는지 */
  hint: string
  /** 참고할 원문 단어. 그대로 쓰면 안 되는 경우도 있다(유형 1) */
  source?: string
}

export type Scaffold = {
  /** 빈칸을 {0}, {1} … 로 표시한 틀 */
  frame: string
  slots: Slot[]
} | null

/** "the variability of X" → variability */
function headNoun(np: string): string | null {
  const m = np.match(/^\s*(?:the|a|an)\s+((?:[A-Za-z-]+\s+){0,2}?[A-Za-z-]+)\s+of\b/i)
  return m ? (m[1]!.split(/\s+/).pop() ?? null) : null
}

/** "the variability of natural ingredients" → natural ingredients */
function ofComplement(np: string): string | null {
  const m = np.match(/\bof\s+(.+)$/i)
  return m ? m[1]!.trim() : null
}

/**
 * 문장의 주어 자리를 거칠게 집는다. 예시로 보여 줄 것이므로 **깨끗해야** 한다 —
 * 틀린 예시는 없는 것만 못하다.
 *
 * 두 가지가 자주 딸려온다:
 *   앞: 전치사구  "**During deep sleep** the brain replays…"
 *   뒤: 부사      "natural ingredients **often**"
 */
const LEADING_PP =
  /^\s*(?:During|In|On|At|After|Before|With|By|For|Through|Over|Under|Within|Among|Across|Since|Unlike|Despite|Given|Beyond)\s+(?:[A-Za-z-]+\s+){0,3}?(?=(?:the|a|an|this|these|those|his|her|their|our|its)\s)/i

const TRAILING_ADV = /\s+(?:[a-z]+ly|often|always|never|usually|sometimes|generally|typically|still|also|just)$/i

function roughSubject(sentence: string): string | null {
  const cleaned = sentence
    .replace(/^\s*(?:[A-Z][a-z]+ly|In fact|However|Thus|Indeed|Typically|For example)\s*,?\s*/, "")
    .replace(LEADING_PP, "")
  const m = cleaned.match(
    // 두 단어까지만. 세 단어를 허용하면 "the brain replays what" 처럼 동사까지 물고 온다.
    /^\s*((?:the|a|an|this|these|those|his|her|their|our)\s+)?([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,1})/,
  )
  if (!m) return null
  // 한정사가 있으면 그 뒤 **한 단어**면 충분하다("the brain"). 한정사가 없으면
  // 두 단어까지 본다("natural ingredients"). 이렇게 하지 않으면 "the brain replays"
  // 처럼 동사가 딸려와 예시가 틀린다.
  const rest = m[1] ? m[2]!.split(/\s+/)[0]! : m[2]!
  const subject = `${m[1] ?? ""}${rest}`.trim().replace(TRAILING_ADV, "")
  return subject.length >= 3 ? subject : null
}

export function scaffoldFor(
  type: number,
  direction: string | null,
  stimulus: string,
  avoidWords: string[],
): Scaffold {
  // ── 유형 1 : 대상 단어만 빈칸으로 뚫는다 ──────────────────
  if (type === 1) {
    const targets = avoidWords.slice(0, 5)
    if (targets.length === 0) return null
    let frame = stimulus.replace(/\s+/g, " ")
    const slots: Slot[] = []
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    targets.forEach((w) => {
      // 정확히 같은 단어를 먼저 찾고, 없을 때만 어간으로 넓힌다.
      // 처음부터 어간으로 찾으면 "vary" 가 "various" 를 잡아 엉뚱한 칸이 뚫리고,
      // 어간을 아예 안 쓰면 "vary" 가 "varies" 를 못 잡아 칸이 생기지 않는다.
      const stem = w.replace(/(ies|ied|ying|ing|ed|es|s|y)$/, "")
      const tries = [new RegExp(`\\b${esc(w)}\\b`, "i")]
      if (stem.length >= 3) tries.push(new RegExp(`\\b${esc(stem)}[A-Za-z-]*\\b`, "i"))
      const re = tries.find((r) => r.test(frame))
      if (!re) return
      frame = frame.replace(re, `{${slots.length}}`)
      slots.push({ hint: `“${w}” 를 다른 말로`, source: w })
    })
    return slots.length ? { frame, slots } : null
  }

  // ── 유형 2 묶기 : the (명사) of (대상) ────────────────────
  if (type === 2 && direction === "fold") {
    const verb = firstVerbLike(stimulus) ?? findFiniteVerb(stimulus).cue
    const subject = roughSubject(stimulus)
    return {
      frame: "the {0} of {1}",
      slots: [
        { hint: verb ? `“${verb}” 를 명사로 바꾼 말` : "핵심 동사를 명사로 바꾼 말", source: verb ?? undefined },
        { hint: subject ? `무엇에 대한 것인지 (예: ${subject})` : "무엇에 대한 것인지", source: subject ?? undefined },
      ],
    }
  }

  // ── 유형 2 풀기 : (주어) (서술어) ─────────────────────────
  if (type === 2 && direction === "unfold") {
    const head = headNoun(stimulus)
    const comp = ofComplement(stimulus)
    return {
      frame: "{0} {1}",
      slots: [
        { hint: comp ? `주어 (예: ${comp})` : "주어", source: comp ?? undefined },
        {
          hint: head ? `“${head}” 를 동사·형용사로 푼 서술어` : "서술어 (동사를 세우세요)",
          source: head ?? undefined,
        },
      ],
    }
  }

  // 유형 3 은 범위를 끄는 과제라 채울 칸이 없다
  return null
}

/** 학생이 채운 값을 틀에 끼워 최종 답안을 만든다. */
export function fillScaffold(frame: string, values: string[]): string {
  return frame
    .replace(/\{(\d+)\}/g, (_, i) => values[Number(i)]?.trim() ?? "")
    .replace(/\s+/g, " ")
    .trim()
}
