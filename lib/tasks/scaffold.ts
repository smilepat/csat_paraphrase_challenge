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
  let subject = `${m[1] ?? ""}${rest}`.trim().replace(TRAILING_ADV, "")

  // ⚠ 조동사·계사가 딸려오면 주어가 아니다. 실제로 학생 화면에
  //   `(2) 무엇에 대한 것인지 (예: Surprises can)` 이 나갔다 —
  //   같은 힌트가 "동사를 명사로 바꾸라"고 하면서 **조동사를 주어 자리에 앉혔다.**
  //   firstVerbLike 는 조동사를 건너뛰므로 여기서 따로 잘라야 한다.
  subject = subject.replace(AUXILIARY_TAIL, "").trim()
  return subject.length >= 3 ? subject : null
}

/** 주어 뒤에 붙어 나오는 조동사·계사. 여기까지가 주어가 아니다. */
const AUXILIARY_TAIL =
  /\s+(?:can|could|may|might|will|would|shall|should|must|is|are|was|were|has|have|had|do|does|did)$/i

export function scaffoldFor(
  type: number,
  direction: string | null,
  stimulus: string,
  avoidWords: string[],
  context?: string,
): Scaffold {
  // ── 유형 1 : 문맥 문장에서 **그 구 하나만** 빈칸 ──────────
  // 예전에는 문장의 내용어를 하나씩 빈칸으로 뚫었다. 그건 단어 대 단어 치환을
  // 강제해 **구조를 바꿀 길을 막았고**, 유형 1 이 재려는 것(구를 같은 뜻의 다른 말로)이
  // 아니었다. 이제 칸은 하나이고, 그 안에서 학생이 자유롭게 다시 말한다.
  if (type === 1) {
    const sentence = (context ?? stimulus).replace(/\s+/g, " ")
    const target = stimulus.replace(/\s+/g, " ").trim()
    const at = sentence.indexOf(target)
    if (at < 0) return null
    // 난이도를 낮추는 단서: 원문이 몇 단어인지 + 길이가 달라도 된다는 점.
    // 칸을 단어 수만큼 쪼개지는 않는다 — 그러면 "a precisely controlled fashion →
    // controllability" 처럼 **줄여 쓰는 답**을 막게 된다. 유형 1 의 다섯 장치 중
    // 파생·관용어 압축이 바로 그 경우다.
    const n = target.split(/\s+/).length
    return {
      frame: sentence.slice(0, at) + "{0}" + sentence.slice(at + target.length),
      slots: [
        {
          hint: `“${target}” 를 같은 뜻의 다른 말로 (원문 ${n}단어 — 더 짧거나 길어도 됩니다)`,
          source: target,
        },
      ],
    }
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

/**
 * **채점기에 보낼 답안**을 고른다. 틀에 채운 것을 무조건 합쳐 보내면 안 된다.
 *
 * 두 유형의 틀은 성격이 다르다.
 *   유형 2  `the {0} of {1}` — 합친 것이 **곧 답**이다(명사구 하나).
 *   유형 1  문장 안에 빈칸 하나 — 합치면 **문장 전체**가 되는데, 학생이 쓴 것은
 *           그 빈칸뿐이다.
 *
 * ⚠ 이 구별이 없어서 실제로 이런 일이 있었다(§42). 학생이 `moral principles` 를
 *   `ethical rules` 로 바꿨는데 **0점**이 나왔다 — 합쳐진 문장의 **나머지 부분**에
 *   남아 있던 `principles`·`moral` 을 회피 검사가 "안 바꿨다" 로 셌기 때문이다.
 *   같은 화면이 모범답안으로 `ethical standards` 를 보여 주고 있었다.
 */
export function answerToSubmit(
  type: number,
  scaffold: Scaffold,
  slots: string[],
  composed: string,
): string {
  if (type === 1 && scaffold) return (slots[0] ?? "").trim()
  return composed
}

/** 학생이 채운 값을 틀에 끼워 최종 답안을 만든다. */
export function fillScaffold(frame: string, values: string[]): string {
  return frame
    .replace(/\{(\d+)\}/g, (_, i) => values[Number(i)]?.trim() ?? "")
    .replace(/\s+/g, " ")
    .trim()
}
