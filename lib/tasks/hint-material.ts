// ============================================================
// 힌트 재료의 **내부 정합성** 검사.
//
// 생성기(scripts/build-hints.mjs)와 검사가 같은 함수를 봐야 하는데, 생성기는
// 모듈을 불러오는 것만으로 DB 를 때린다. 그래서 규칙만 여기로 떼어 둔다.
// ============================================================

/**
 * "vary → variability" 의 오른쪽이 예시 답에 실제로 쓰였는가.
 *
 * 왜 필요한가: 3칸이 "이 어형을 쓰라"고 하고 4칸이 다른 낱말을 보여 주면 학생은
 * 둘 중 무엇을 믿어야 할지 모른다(자가진단 실측 26%). 게다가 이 검사는
 * **지어낸 낱말**도 같이 걸러낸다 — 존재하지 않는 어형("unmovedness")은
 * 자연스러운 예시 문장에 나타날 수가 없기 때문이다.
 *
 * 굴절 꼬리는 봐준다. "evolve" 를 예시가 "evolved" 로 쓰는 것은 어긋난 것이 아니다.
 */
export function formAgreesWithExample(form: string, example: string): boolean {
  const derived = String(form).split(/[→>]/).pop()?.trim().toLowerCase()
  if (!derived || !example) return false
  const ex = String(example).toLowerCase()
  // "large, complex" 처럼 둘일 수 있다. 하나라도 쓰였으면 통과.
  return derived.split(/[,;]/).some((raw) => {
    const w = raw.trim().replace(/[^a-z-]/g, "")
    if (w.length < 3) return false
    // 굴절 꼬리를 떼고 어간으로 본다(evolve → evolv, variability → variabilit)
    const stem = w.replace(/(e|es|s|ed|ing|y)$/, "")
    return ex.includes(stem.length >= 4 ? stem : w)
  })
}
