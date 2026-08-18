// ============================================================
// 유형 2 의 2단 — 의미 판정(유료).
//
// 기존 verdict.ts 는 **지문 전체의 명제 커버리지**를 잰다. 유형 2 는 그게 아니라
// 자극 한 조각과 학생 답안 사이의 **국소 등가성**을 본다. 그래서 별도 판정이다.
//
// 물어보는 것은 둘뿐이다:
//   form    — 학생이 쓴 것이 실제로 명사구인가 절인가 (구조 검사가 미룬 것의 심판)
//   meaning — 자극과 같은 뜻인가, 좁아졌는가, 넓어졌는가, 달라졌는가, 뒤집혔는가
//
// meaning 을 다섯 갈래로 강제하는 이유는 CALIBRATION.md 의 교훈과 같다.
// "뜻이 같은가?"를 예/아니오로 물으면 모델이 관대해진다. 갈래를 주고 하나를
// 고르게 하면 건너뛸 수가 없고, 그 갈래가 그대로 **오답의 이름**이 된다
// (교수 설계의 오답 5종과 같은 어휘를 쓴다).
// ============================================================

import { createHash } from "node:crypto"

import { callGemini, isLlmEnabled, parseGeminiJson } from "../../gemini"
import { matchById } from "./verdict1"

export type Type2Form = "noun_phrase" | "clause" | "other"
export type Type2Meaning = "same" | "narrower" | "broader" | "changed" | "reversed"

export interface Type2Request {
  id: string
  stimulus: string
  target: "noun_phrase" | "clause"
  answer: string
}

export interface Type2Verdict {
  id: string
  form: Type2Form
  meaning: Type2Meaning
  /** 학생에게 보여줄 한국어 한 줄 */
  koreanFeedback: string
  /** 같은 조작을 제대로 한 예시 */
  suggested: string
}

const SYSTEM = `You grade short English rewrites by Korean secondary students.
The exercise is grammatical metaphor: turning a clause into a noun phrase ("fold"),
or a noun phrase back into a clause ("unfold").
Judge only what the student wrote. Never reward effort or intent.
Be strict about meaning drift: a fluent rewrite that says something the original did not
is a serious error, not a small one.`

export function buildType2Prompt(requests: Type2Request[]): string {
  return `For each item, a student was asked to rewrite the ORIGINAL into the TARGET form
while keeping the meaning identical.

${requests
  .map(
    (r) => `[${r.id}]
ORIGINAL: ${r.stimulus}
TARGET FORM: ${r.target === "noun_phrase" ? "a noun phrase (no finite verb)" : "a clause (with a subject and a finite verb)"}
STUDENT: ${r.answer}`,
  )
  .join("\n\n")}

For EACH item decide two things. They are SEPARATE judgements and must not influence
each other.

1) "meaning" — compare STUDENT with ORIGINAL. Choose exactly one:
   "same"     — the same proposition, only the wording or structure differs
   "narrower" — correct but drops part of what the ORIGINAL says
   "broader"  — claims more than the ORIGINAL says
   "changed"  — talks about something the ORIGINAL does not claim
   "reversed" — negates, denies, or asserts the opposite of the ORIGINAL

   CRITICAL — judge meaning while IGNORING the target form completely.
   If the student kept the meaning but did NOT change the structure, the meaning is
   still "same". Failing to change the form is recorded in "form", never in "meaning".
   Do not use "changed" for a form failure.

   CRITICAL — widening a quantifier or hedge is "broader", not "changed":
   some -> all, one -> every, often -> always, may -> will, a few -> most.
   The topic is unchanged; only the scope grew. Use "changed" only when the STUDENT
   talks about a different thing altogether.

   CRITICAL — negation is "reversed", not "changed". If the ORIGINAL says X is possible
   and the STUDENT says X is not possible, that is "reversed". If the ORIGINAL names a
   property and the STUDENT names its opposite, that is "reversed".
   Denying a property the ORIGINAL names is also "reversed":
   "the controllability of X" -> "X cannot be controlled" is "reversed", not "changed".

2) "form" — what the STUDENT actually wrote, regardless of what was asked:
   "noun_phrase" — a naming expression with no finite verb
   "clause"      — has a subject and a finite verb
   "other"       — a fragment, a list, or not English

Also return:
- "koreanFeedback": ONE Korean sentence, max 60 characters, telling the student
  **what to do next** — a concrete action, not a diagnosis.
  Write it as advice to a learner who tried: "…을 한 가지 더 넣어 보세요", "…를 다시 확인해 보세요".
  Do NOT restate the error name and do NOT scold. Praise is added separately.
- "suggested": a correct rewrite in the TARGET form, max 20 words.

Return ONLY a JSON array, one object per item, in the same order, each with
"id", "meaning", "form", "koreanFeedback", "suggested".`
}

/** 한 콜에 담을 최대 건수. 항목마다 피드백+예시가 붙어 출력이 길다. */
export const BATCH = 8

const FORMS: Type2Form[] = ["noun_phrase", "clause", "other"]
const MEANINGS: Type2Meaning[] = ["same", "narrower", "broader", "changed", "reversed"]

function coerce(raw: unknown, id: string): Type2Verdict {
  const o = (raw ?? {}) as Record<string, unknown>
  const form = FORMS.includes(o.form as Type2Form) ? (o.form as Type2Form) : "other"
  // 모르는 값이 오면 **관대한 쪽이 아니라 보수적인 쪽**으로 떨어뜨린다.
  const meaning = MEANINGS.includes(o.meaning as Type2Meaning)
    ? (o.meaning as Type2Meaning)
    : "changed"
  return {
    id,
    form,
    meaning,
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
  .update(buildType2Prompt([{ id: "_", stimulus: "_", target: "clause", answer: "_" }]))
  .digest("hex")
  .slice(0, 10)

/** 테스트·오프라인용 결정론적 가짜 판정 (PARAPHRASE_FAKE_LLM=1). */
export function isFakeLlm(): boolean {
  return process.env.PARAPHRASE_FAKE_LLM === "1"
}

function fakeVerdict(r: Type2Request): Type2Verdict {
  const same = r.answer.trim().toLowerCase() === r.stimulus.trim().toLowerCase()
  return {
    id: r.id,
    // 자극을 그대로 옮겼으면 구조도 그대로다
    form: same ? (r.target === "clause" ? "noun_phrase" : "clause") : r.target,
    meaning: same ? "same" : "same",
    koreanFeedback: "(가짜 판정)",
    suggested: "",
  }
}

/**
 * 배치 판정. LLM 이 꺼져 있거나 실패하면 **빈 Map** 을 돌려준다.
 * 호출부는 구조 검사 결과만으로 계속 진행해야 한다 — 채점이 멈추면 안 된다.
 */
export async function judgeType2Batch(
  requests: Type2Request[],
): Promise<Map<string, Type2Verdict>> {
  const out = new Map<string, Type2Verdict>()
  if (requests.length === 0) return out

  if (isFakeLlm()) {
    for (const r of requests) out.set(r.id, fakeVerdict(r))
    return out
  }
  if (!isLlmEnabled()) return out

  // 한 번에 몰아 보내면 **응답이 조용히 잘린다.** 14건을 4096 토큰으로 보냈더니
  // 뒤 4건이 통째로 사라졌고, parseGeminiJson 이 온전한 객체만 건져 내는 탓에
  // 에러 없이 개수만 줄었다. 항목당 한국어 피드백과 예시 문장이 붙으므로
  // 출력이 길다 — 배치를 쪼개고 한도를 올린다.
  for (let i = 0; i < requests.length; i += BATCH) {
    const chunk = requests.slice(i, i + BATCH)
    try {
      const raw = await callGemini(buildType2Prompt(chunk), SYSTEM, {
        json: true,
        temperature: 0,
        maxOutputTokens: 8192,
      })
      const parsed = parseGeminiJson<unknown[]>(raw)
      if (!Array.isArray(parsed)) continue

      // 순서로 맞추지 않는다 — 이유는 verdict1.ts 의 matchById 주석에 있다.
      for (const [id, v] of matchById(parsed, chunk, coerce, "verdict2")) out.set(id, v)
      if (out.size < i + chunk.length) {
        console.warn(`[verdict2] 응답이 짧습니다 — ${chunk.length}건 요청, 누계 ${out.size}건 수신`)
      }
    } catch (e) {
      console.error("[verdict2] 판정 실패 — 구조 점수만 사용합니다:", (e as Error).message)
    }
  }
  return out
}
