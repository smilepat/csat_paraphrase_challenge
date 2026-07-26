// ============================================================
// 의미 보존 점수 (50점)
//
// standalone.html 은 핵심어를 문자열 stem 으로 매칭했다. 그래서 동의어로 잘
// 바꿔 쓴 좋은 패러프레이즈일수록 감점됐다 — 게임의 목적과 정반대다.
// 여기서는 핵심 명제와의 임베딩 유사도로 본다. 바꿔 쓰기가 가점이 된다.
// ============================================================

import { MEANING } from "./config"

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** lo 이하 0, hi 이상 1, 사이는 선형. */
export function ramp(v: number, lo: number, hi: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

export interface MeaningInput {
  /** 답안 전체 + 문장별 벡터. 명제별로 최댓값을 쓴다 —
   *  2문장 답안에서 각 문장이 다른 명제를 담은 경우를 전체 벡터 하나로는 놓친다. */
  answerVectors: number[][]
  propositionVectors: number[][]
  modelVectors: number[][]
  /** LLM 이 "이 명제와 모순된다"고 판정한 명제 인덱스. 해당 명제는 0점 처리. */
  contradictedIndices?: number[]
  /**
   * LLM 이 "이 명제를 담았다"고 판정한 명제 인덱스.
   *
   * 있으면 이쪽을 커버리지의 기준으로 쓴다. 임베딩 유사도는 커버리지를 재지
   * 못한다는 것이 측정으로 드러났다 — 한 지문의 명제들은 서로 주제가 같아서,
   * 4개 중 1개만 담은 답안도 나머지 3개와 0.78+ 의 유사도를 보였다
   * (커버리지 1.00→50.0점 vs 0.25→47.8점, 사실상 구별 불가).
   * 반면 LLM 의 명제별 입장 판정은 독립 구성 사양과 36/36 일치했다.
   * 임베딩은 LLM 이 꺼졌을 때의 폴백으로 남긴다.
   */
  coveredIndices?: number[]
}

export interface MeaningResult {
  score: number
  detail: {
    /** 명제별 유사도와 획득 비율 */
    propositions: Array<{ index: number; sim: number; credit: number; contradicted: boolean }>
    coverage: number
    gist: number
    gistSim: number
    /** 커버리지를 무엇으로 판정했는지 — 교사 화면과 리포트에 표시한다 */
    coverageSource: "llm" | "embedding"
  }
}

export function scoreMeaning(input: MeaningInput): MeaningResult {
  const { answerVectors, propositionVectors, modelVectors } = input
  const contradicted = new Set(input.contradictedIndices ?? [])
  const llmCovered = input.coveredIndices ? new Set(input.coveredIndices) : null
  const coverageSource: "llm" | "embedding" = llmCovered ? "llm" : "embedding"

  const maxSim = (target: number[]) =>
    answerVectors.length ? Math.max(...answerVectors.map((v) => cosine(v, target))) : 0

  const propositions = propositionVectors.map((pv, index) => {
    const sim = maxSim(pv)
    const isContradicted = contradicted.has(index)
    const credit = isContradicted
      ? 0
      : llmCovered
        ? (llmCovered.has(index) ? 1 : 0)
        : ramp(sim, MEANING.propLo, MEANING.propHi)
    return {
      index,
      sim: Math.round(sim * 1000) / 1000,
      credit: Math.round(credit * 1000) / 1000,
      contradicted: isContradicted,
    }
  })

  // 모순은 누락보다 무겁게 친다.
  // 0점 처리만 하면 "명제 3개 담고 1개를 거꾸로 말한 답안"과 "3개만 담고 1개를
  // 빠뜨린 답안"이 같은 점수가 된다(측정에서 42.5 vs 42.5 로 실제로 겹쳤다).
  // 틀리게 말하는 것은 말하지 않는 것보다 나쁘다 — 명제당 -1 로 계산한다.
  const rawCoverage = propositions.length
    ? propositions.reduce((s, p) => s + (p.contradicted ? -1 : p.credit), 0) / propositions.length
    : 0
  const coverage = Math.max(0, rawCoverage)

  const gistSim = modelVectors.length ? Math.max(...modelVectors.map((mv) => maxSim(mv))) : 0
  const gist = ramp(gistSim, MEANING.gistLo, MEANING.gistHi)

  const raw = MEANING.coverageWeight * coverage + MEANING.gistWeight * gist

  return {
    score: Math.round(50 * raw * 10) / 10,
    detail: {
      propositions,
      coverage: Math.round(coverage * 1000) / 1000,
      gist: Math.round(gist * 1000) / 1000,
      gistSim: Math.round(gistSim * 1000) / 1000,
      coverageSource,
    },
  }
}

/** 가장 덜 담긴 명제 인덱스 — 학생 피드백에 "이게 빠졌다"고 알려줄 때 쓴다. */
export function weakestPropositions(result: MeaningResult, n = 2): number[] {
  return [...result.detail.propositions]
    .sort((a, b) => a.credit - b.credit)
    .filter((p) => p.credit < 0.6)
    .slice(0, n)
    .map((p) => p.index)
}
