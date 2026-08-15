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
