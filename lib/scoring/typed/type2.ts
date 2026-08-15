// ============================================================
// 유형 2 채점 — 문장↔이름(명사화). **2단 구조**다.
//
//   1단 구조 검사(무료)  … 목표가 명사구인데 동사가 남았는가 / 절인데 동사가 없는가
//   2단 의미 판정(유료)  … 1단을 통과했거나 판단을 미룬 답안만 verdict 로 넘긴다
//
// 왜 2단인가: 유형 2 의 흔한 실패는 "구조를 안 바꾼 것"이고, 그건 표층에서 잡힌다.
// 구조에서 떨어진 답안에 돈을 쓸 이유가 없다. 실측(853건)에서 명사구 판별은 100%,
// 절 판별은 95.7% 라 **명사구 목표는 즉결, 절 목표는 애매하면 유료로 미룬다.**
// ============================================================

import { checkStructure, type StructureVerdict } from "./structure"
import type { Type2Verdict } from "./verdict2"

export type Type2Target = "noun_phrase" | "clause"

export type Type2Input = {
  answer: string
  /** 학생이 바꿔야 했던 원래 구간 */
  stimulus: string
  target: Type2Target
}

export type Type2Result = {
  structure: StructureVerdict
  /** 학생에게 보여줄 한 줄. 자습이라 이 문구가 유일한 지도다. */
  message: string
  cue: string | null
  /** 유료 의미 판정으로 넘겨야 하는가 */
  needsVerdict: boolean
  /** 구조만으로 확정된 점수. 미확정이면 null(의미 판정 후 결정) */
  structureScore: number | null
  flags: string[]
}

/** 내용어만 남긴 집합. 베낌 판정에 임베딩을 쓰지 않는 이유는 guards.ts 참고. */
function contentSet(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().replace(/[’ʼ]/g, "'").match(/[a-z][a-z']{2,}/g) ?? [])
      .filter((w) => !/^(the|and|for|that|this|with|from|into|their|its|are|was|were|has|have)$/.test(w)),
  )
}

/**
 * 원문을 거의 그대로 옮겼는가. 구조만 살짝 바꾸고 낱말을 통째로 베끼면
 * 유형 2 로서는 통과지만 학생에게 알려는 줘야 한다(감점은 의미 판정 쪽에서).
 */
function verbatimShare(answer: string, stimulus: string): number {
  const a = contentSet(answer)
  const s = contentSet(stimulus)
  if (s.size === 0) return 0
  let shared = 0
  for (const w of s) if (a.has(w)) shared++
  return shared / s.size
}

export const TYPE2 = {
  /** 구조에서 떨어지면 이 점수로 확정한다. 의미 판정을 부르지 않는다. */
  structureFailScore: 0,
  /** 내용어를 이만큼 이상 그대로 옮기면 표시한다 */
  verbatimShare: 0.9,
} as const

export function scoreType2(input: Type2Input): Type2Result {
  const s = checkStructure(input.answer, input.target)
  const flags: string[] = []

  if (verbatimShare(input.answer, input.stimulus) >= TYPE2.verbatimShare) {
    flags.push("verbatim")
  }

  if (s.verdict === "fail") {
    return {
      structure: "fail",
      message: s.message,
      cue: s.cue,
      needsVerdict: false,
      structureScore: TYPE2.structureFailScore,
      flags,
    }
  }

  // pass 든 unclear 든 의미가 보존됐는지는 아직 모른다 — 여기서 유료 판정이 필요하다.
  return {
    structure: s.verdict,
    message: s.message,
    cue: s.cue,
    needsVerdict: true,
    structureScore: null,
    flags,
  }
}

// ── 2단: 의미 판정을 합쳐 최종 점수를 낸다 ────────────────────

/**
 * 의미 갈래별 점수. 이름은 **교수 설계의 오답 5종과 같은 어휘**를 쓴다 —
 * 교사가 없는 자습이라 이 문구가 유일한 지도이고, 학생이 자기 오류를
 * 분류할 수 있어야 다음에 다르게 쓴다.
 */
export const MEANING_SCORE = {
  same: 100,
  narrower: 60,
  broader: 50,
  changed: 20,
  reversed: 0,
} as const

export const MEANING_LABEL = {
  same: "뜻이 같다",
  narrower: "절반만 맞는 말",
  broader: "원문보다 크게 말한 것",
  changed: "비슷하지만 다른 말",
  reversed: "뜻은 맞는데 방향이 반대",
} as const

export type Type2Final = {
  score: number
  /** 학생에게 보여줄 오답의 이름. 정답이면 null */
  errorName: string | null
  message: string
  suggested: string
  /** 유료 판정을 실제로 썼는가 */
  judged: boolean
  flags: string[]
}

/**
 * 구조 결과와 의미 판정을 합친다.
 *
 * 형식 관문을 누가 보는가:
 *   구조 검사가 **확신했으면 그 판단을 쓴다**(명사구 판별 실측 100%).
 *   미뤘을 때만 LLM 의 form 을 심판으로 쓴다. 이 순서를 뒤집으면
 *   공짜로 맞힐 수 있는 것에 돈을 쓰고 정확도는 떨어진다.
 *
 * 판정이 없으면(LLM 꺼짐·실패) 구조 점수만으로 진행한다 — 채점이 멈추면 안 된다.
 */
export function finalizeType2(
  input: Type2Input,
  structure: Type2Result,
  verdict: Type2Verdict | null,
): Type2Final {
  const flags = [...structure.flags]

  if (structure.structure === "fail") {
    return {
      score: TYPE2.structureFailScore,
      errorName: "구조를 바꾸지 않음",
      message: structure.message,
      suggested: "",
      judged: false,
      flags,
    }
  }

  if (!verdict) {
    // 의미를 확인하지 못했다. 통과시키지도 떨어뜨리지도 않는다.
    return {
      score: 50,
      errorName: null,
      message: "구조는 맞았습니다. 의미 확인은 잠시 뒤에 다시 시도합니다.",
      suggested: "",
      judged: false,
      flags: [...flags, "verdict-missing"],
    }
  }

  // 구조 검사가 미뤘던 것만 LLM 의 form 이 심판한다
  if (structure.structure === "unclear" && verdict.form !== input.target) {
    return {
      score: TYPE2.structureFailScore,
      errorName: "구조를 바꾸지 않음",
      message:
        input.target === "noun_phrase"
          ? "아직 문장입니다. 동사를 지우고 이름 하나로 접어 보세요."
          : "아직 이름입니다. 주어와 동사를 세워 문장으로 펴 보세요.",
      suggested: verdict.suggested,
      judged: true,
      flags,
    }
  }

  const score = MEANING_SCORE[verdict.meaning]
  return {
    score,
    errorName: verdict.meaning === "same" ? null : MEANING_LABEL[verdict.meaning],
    message: verdict.koreanFeedback || MEANING_LABEL[verdict.meaning],
    suggested: verdict.suggested,
    judged: true,
    flags,
  }
}
