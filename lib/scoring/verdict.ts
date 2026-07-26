// ============================================================
// LLM 판정 게이트
//
// 왜 필요한가 (진단으로 확인한 사실):
//   임베딩은 "의미 역전"을 잡지 못한다. 캘리브레이션 세트에서 원문의 주장을
//   뒤집은 답안의 명제 유사도가 0.732 로, 부분만 맞은 정직한 답안(0.772)과
//   거의 같았다. 코사인은 "같은 주제인가"를 재지 "같은 주장인가"를 재지 않는다.
//   따라서 모순 판정만은 LLM 이 해야 한다.
//
// 비용: 라운드 종료 시 제출물 전체를 1콜로 배치 판정한다(30명 = 1~2콜).
// ============================================================

import { callGemini, isLlmEnabled, parseGeminiJson } from "../gemini"

export interface VerdictRequest {
  id: string
  answer: string
}

export interface Verdict {
  id: string
  /** 이 답안이 사실과 반대로 진술한 명제 인덱스 (0-based) */
  contradicted: number[]
  /** 답안이 담고 있는 명제 인덱스 */
  covered: number[]
  /** 영어가 문법적으로 통하는가 */
  grammatical: boolean
  /** 자연스러움 1~5 */
  naturalness: number
  /** 학생에게 보여줄 한국어 한 줄 */
  koreanFeedback: string
  /** 더 짧게 쓴 예시 */
  suggestedShorter: string
}

const SYSTEM = `You grade short English paraphrases written by Korean secondary students.
You are strict about one thing above all: whether the student states something the passage
does NOT claim, or the OPPOSITE of what it claims. A fluent sentence that reverses the
passage's claim is a serious error, not a minor one.
Judge only what the student wrote. Do not reward effort or intent.`

/**
 * 청구항마다 명시적 입장(agree/disagree/absent)을 강제한다.
 *
 * "모순된 명제 인덱스를 나열하라"고 물으면 모델이 그냥 빈 배열을 내놓기 쉬웠다
 * (초기 측정에서 모순 탐지 67%). 명제 하나하나에 대해 입장을 고르게 하면
 * 건너뛸 수가 없다.
 */
export function buildVerdictPrompt(
  propositions: string[],
  requests: VerdictRequest[],
): string {
  return `The passage makes these core claims:
${propositions.map((p, i) => `${i}. ${p}`).join("\n")}

Student answers:
${requests.map((r) => `[${r.id}] ${r.answer}`).join("\n")}

For EACH answer, go through EVERY claim ${propositions.map((_, i) => i).join(", ")} one by one
and decide the student's stance on it:
  "agree"   — the answer states this claim (rewording counts; vague hinting does NOT)
  "disagree"— the answer states the opposite of this claim, or misrepresents it
  "absent"  — the answer simply does not talk about this claim
Omitting a claim is "absent", never "disagree".

Return for each answer:
- "id": the id in brackets
- "claims": array with one entry per claim, {"i": <claim index>, "stance": "agree"|"disagree"|"absent"}
  — you MUST include an entry for every claim, in order
- "grammatical": true if the English is understandable and broadly correct
- "naturalness": 1-5
- "koreanFeedback": ONE Korean sentence (max 60 characters) naming the single most useful
  thing to fix. Encouraging but specific.
- "suggestedShorter": a corrected version in easy English, max 20 words.

Return ONLY a JSON array with one object per answer, in the same order.`
}

function coerce(raw: unknown, id: string, propCount: number): Verdict {
  const o = (raw ?? {}) as Record<string, unknown>

  // 새 형식(claims 배열)을 우선하고, 구형 covered/contradicted 도 받아준다.
  const covered: number[] = []
  const contradicted: number[] = []
  if (Array.isArray(o.claims)) {
    for (const c of o.claims as Array<Record<string, unknown>>) {
      const i = Number(c?.i)
      if (!Number.isInteger(i) || i < 0 || i >= propCount) continue
      if (c?.stance === "agree") covered.push(i)
      else if (c?.stance === "disagree") contradicted.push(i)
    }
  } else {
    const nums = (v: unknown): number[] =>
      Array.isArray(v)
        ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < propCount)
        : []
    covered.push(...nums(o.covered))
    contradicted.push(...nums(o.contradicted))
  }

  return {
    id,
    contradicted,
    covered,
    grammatical: o.grammatical !== false,
    naturalness: Math.max(1, Math.min(5, Number(o.naturalness) || 3)),
    koreanFeedback: typeof o.koreanFeedback === "string" ? o.koreanFeedback.slice(0, 120) : "",
    suggestedShorter: typeof o.suggestedShorter === "string" ? o.suggestedShorter.slice(0, 300) : "",
  }
}

/**
 * 제출물 배치 판정. LLM 이 꺼져 있거나 실패하면 빈 Map 을 돌려준다 —
 * 호출부는 임베딩+규칙 점수만으로 계속 진행해야 한다(채점이 멈추면 안 된다).
 */
export async function judgeBatch(
  propositions: string[],
  requests: VerdictRequest[],
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>()
  if (!isLlmEnabled() || requests.length === 0) return out

  try {
    const raw = await callGemini(buildVerdictPrompt(propositions, requests), SYSTEM, {
      json: true,
      temperature: 0,
      maxOutputTokens: 8192,
    })
    const parsed = parseGeminiJson<unknown[]>(raw)
    if (!Array.isArray(parsed)) return out

    // id 로 맞추되, 모델이 id 를 흘리면 순서로 폴백한다.
    const byId = new Map(
      parsed
        .map((o) => [(o as { id?: string })?.id, o] as const)
        .filter(([id]) => typeof id === "string"),
    )
    requests.forEach((r, i) => {
      const found = byId.get(r.id) ?? parsed[i]
      if (found) out.set(r.id, coerce(found, r.id, propositions.length))
    })
  } catch (e) {
    console.error("[verdict] 판정 실패 — 임베딩 점수만 사용합니다:", (e as Error).message)
  }
  return out
}
