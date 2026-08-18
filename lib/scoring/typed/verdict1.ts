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
  /**
   * 자극이 들어 있던 **문장**. §29 에서 유형 1 을 구 단위로 바꾼 뒤로 이것이 없으면
   * 판정이 흔들린다 — "symbolic ways" 만 떼어 놓고는 "indirect methods" 가 같은
   * 말인지 알 수 없다. 문장은 스스로 문맥을 담지만 **구는 담지 못한다.**
   * (실측: 문맥 없이 구 단위 6/8, 문장 단위 8/8)
   */
  context?: string
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
  .map((r) =>
    [
      `[${r.id}]`,
      r.context ? `SENTENCE: ${r.context.replace(/\s+/g, " ")}` : null,
      `ORIGINAL: ${r.stimulus}`,
      `STUDENT: ${r.answer}`,
    ]
      .filter(Boolean)
      .join("\n"),
  )
  .join("\n\n")}

The ORIGINAL is a PHRASE lifted from SENTENCE. Read it **in that sentence** to see what
it refers to, then judge the STUDENT phrase against the ORIGINAL phrase alone.
Do not ask the student to repeat what the sentence already supplies — a phrase that fits
the same slot with the same meaning is "same", even if it looks incomplete on its own.

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
- "koreanFeedback": ONE Korean sentence, max 60 characters, telling the student
  **what to do next** — a concrete action, not a diagnosis.
  Write it as advice to a learner who tried: "…을 한 가지 더 넣어 보세요", "…를 다시 확인해 보세요".
  Do NOT restate the error name and do NOT scold. Praise is added separately.
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

/**
 * 응답을 **id 로만** 요청에 맞춘다.
 *
 * 예전에는 id 가 없으면 순서로 맞췄다(`byId.get(r.id) ?? parsed[j]`). 정상 응답은
 * id 를 그대로 돌려주므로(실측 8/8) 그 대체 경로가 나르던 것은 **모델이 헛나간
 * 응답뿐**이었다 — 가장 위험한 순간에만 켜지는 안전장치였던 셈이다.
 *
 * 실제로 유형 1 판정이 `id: 1,2,3` 에 "worker contentment" 이야기를 담아 돌아온 적이
 * 있고, 순서로 맞추는 바람에 **다른 문항의 판정이 학생 답안에 붙었다**(100점 답안에
 * 무관한 조언이 달린 사고의 원인). 그 판정은 캐시에도 저장되므로 한 번 어긋나면
 * 그 답안에 영원히 남는다.
 *
 * 못 맞춘 것은 그냥 버린다. 판정이 없으면 무료 점수만으로 채점되고
 * (§"의미 확인은 잠시 뒤에"), 그쪽이 남의 판정을 붙이는 것보다 낫다.
 */
export function matchById<TReq extends { id: string }, TVerdict>(
  parsed: unknown[],
  chunk: TReq[],
  coerceOne: (raw: unknown, id: string) => TVerdict,
  label: string,
): Map<string, TVerdict> {
  const byId = new Map<string, unknown>()
  for (const o of parsed) {
    const id = (o as { id?: unknown })?.id
    if (typeof id === "string") byId.set(id, o)
  }
  const out = new Map<string, TVerdict>()
  const missed: string[] = []
  for (const r of chunk) {
    const found = byId.get(r.id)
    if (found) out.set(r.id, coerceOne(found, r.id))
    else missed.push(r.id)
  }
  if (missed.length) {
    console.warn(
      `[${label}] 응답에 없는 문항 ${missed.length}건은 버립니다 — 순서로 맞추지 않습니다. ` +
        `요청: ${missed.slice(0, 3).join(", ")} / 응답 id: ${[...byId.keys()].slice(0, 3).join(", ") || "(없음)"}`,
    )
  }
  return out
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
      for (const [id, v] of matchById(parsed, chunk, coerce, "verdict1")) out.set(id, v)
    } catch (e) {
      console.error("[verdict1] 판정 실패 — 회피 점수만 사용합니다:", (e as Error).message)
    }
  }
  return out
}
