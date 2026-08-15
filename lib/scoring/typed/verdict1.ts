// ============================================================
// 유형 1 의 2단 — 의미 판정(유료).
//
// 유형 2 와 **같은 다섯 갈래**를 쓴다(same/narrower/broader/changed/reversed).
// 갈래가 곧 오답의 이름이라, 두 유형이 다른 어휘를 쓰면 학생이 자기 오류를
// 축을 넘나들며 알아볼 수 없다. 축은 달라도 오답의 이름은 하나여야 한다.
//
// 다른 점은 하나뿐이다: 유형 1 에는 목표 구조가 없다. 대신 **낱말을 실제로
// 바꿨는가**를 함께 본다 — 무료 회피 검사가 어간 수준에서 이미 걸렀지만,
// 동의어를 그대로 옮긴 수준인지(paraphrase 라 부르기 어려운지)는 사람 판단이 필요하다.
// ============================================================

import { createHash } from "node:crypto"

import { callGemini, isLlmEnabled, parseGeminiJson } from "../../gemini"
import { BATCH, type Type2Meaning } from "./verdict2"

export type Type1Meaning = Type2Meaning

export interface Type1Request {
  id: string
  /** 학생이 다시 말해야 했던 원문 */
  stimulus: string
  answer: string
}

export interface Type1Verdict {
  id: string
  meaning: Type1Meaning
  /** 낱말을 실제로 바꿨는가. 무료 검사는 어간만 보므로 여기서 한 번 더 본다. */
  reworded: boolean
  koreanFeedback: string
  suggested: string
}

const SYSTEM = `You grade short English rewrites by Korean secondary students.
The exercise is lexical paraphrase: saying the same thing with different words.
Judge only what the student wrote. Never reward effort or intent.
Be strict about meaning drift: a fluent rewrite that says something the original did not
is a serious error, not a small one.`

const MEANINGS: Type1Meaning[] = ["same", "narrower", "broader", "changed", "reversed"]

export function buildType1Prompt(requests: Type1Request[]): string {
  return `For each item, a student was asked to say the ORIGINAL again using DIFFERENT WORDS,
keeping the meaning identical.

${requests
  .map((r) => `[${r.id}]\nORIGINAL: ${r.stimulus}\nSTUDENT: ${r.answer}`)
  .join("\n\n")}

For EACH item decide two things. They are SEPARATE judgements and must not influence
each other.

1) "meaning" — compare STUDENT with ORIGINAL. Choose exactly one:
   "same"     — the same proposition, only the wording differs
   "narrower" — correct but drops part of what the ORIGINAL says
   "broader"  — claims more than the ORIGINAL says
   "changed"  — talks about something the ORIGINAL does not claim
   "reversed" — negates, denies, or asserts the opposite of the ORIGINAL

   CRITICAL — judge meaning while IGNORING whether the words were changed.
   If the student kept the meaning but reused the original words, the meaning is still
   "same". Word reuse is recorded in "reworded", never in "meaning".

   CRITICAL — widening a quantifier or hedge is "broader", not "changed":
   some -> all, one -> every, often -> always, may -> will, a few -> most.
   The topic is unchanged; only the scope grew. Use "changed" only when the STUDENT
   talks about a different thing altogether.

   CRITICAL — negation is "reversed", not "changed".
   Denying a property the ORIGINAL names is also "reversed":
   "the controllability of X" -> "X cannot be controlled" is "reversed", not "changed".

2) "reworded" — true if the student genuinely used different content words.
   false if the answer is mostly the ORIGINAL's own words re-arranged, or only
   inflected forms of them.

Also return:
- "koreanFeedback": ONE Korean sentence, max 60 characters, naming the single most useful fix.
- "suggested": a correct paraphrase in easy English, max 20 words.

Return ONLY a JSON array, one object per item, in the same order, each with
"id", "meaning", "reworded", "koreanFeedback", "suggested".`
}

function coerce(raw: unknown, id: string): Type1Verdict {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    id,
    // 모르는 값은 관대한 쪽이 아니라 보수적인 쪽으로 떨어뜨린다
    meaning: MEANINGS.includes(o.meaning as Type1Meaning) ? (o.meaning as Type1Meaning) : "changed",
    reworded: o.reworded === true,
    koreanFeedback: typeof o.koreanFeedback === "string" ? o.koreanFeedback.slice(0, 120) : "",
    suggested: typeof o.suggested === "string" ? o.suggested.slice(0, 200) : "",
  }
}

/**
 * 프롬프트 지문. **템플릿에서 자동으로 뽑는다** — 손으로 버전을 올리는 방식이면
 * 프롬프트를 고치고 버전을 안 올리는 날이 반드시 온다. 그러면 캐시가 옛 판정을
 * 계속 돌려준다. 여기서는 문구를 한 글자만 바꿔도 지문이 달라져 캐시가 갈린다.
 */
export const PROMPT_FINGERPRINT = createHash("sha1")
  .update(SYSTEM)
  .update(buildType1Prompt([{ id: "_", stimulus: "_", answer: "_" }]))
  .digest("hex")
  .slice(0, 10)

function fakeVerdict(r: Type1Request): Type1Verdict {
  const same = r.answer.trim().toLowerCase() === r.stimulus.trim().toLowerCase()
  return { id: r.id, meaning: "same", reworded: !same, koreanFeedback: "(가짜 판정)", suggested: "" }
}

export async function judgeType1Batch(
  requests: Type1Request[],
): Promise<Map<string, Type1Verdict>> {
  const out = new Map<string, Type1Verdict>()
  if (requests.length === 0) return out
  if (process.env.PARAPHRASE_FAKE_LLM === "1") {
    for (const r of requests) out.set(r.id, fakeVerdict(r))
    return out
  }
  if (!isLlmEnabled()) return out

  for (let i = 0; i < requests.length; i += BATCH) {
    const chunk = requests.slice(i, i + BATCH)
    try {
      const raw = await callGemini(buildType1Prompt(chunk), SYSTEM, {
        json: true,
        temperature: 0,
        maxOutputTokens: 8192,
      })
      const parsed = parseGeminiJson<unknown[]>(raw)
      if (!Array.isArray(parsed)) continue
      const byId = new Map(
        parsed
          .map((o) => [(o as { id?: string })?.id, o] as const)
          .filter(([id]) => typeof id === "string"),
      )
      chunk.forEach((r, j) => {
        const found = byId.get(r.id) ?? parsed[j]
        if (found) out.set(r.id, coerce(found, r.id))
      })
    } catch (e) {
      console.error("[verdict1] 판정 실패 — 회피 점수만 사용합니다:", (e as Error).message)
    }
  }
  return out
}
