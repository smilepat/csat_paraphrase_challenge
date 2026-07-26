// ============================================================
// 채점 조립 — 총점 100 = 의미 50 + 간결 25 + 쉬움 25
//
// 이 모듈은 I/O 를 하지 않는다. 임베딩은 호출부가 미리 구해 넘긴다
// (라운드 전체를 한 번에 배치 임베딩하기 위해).
// ============================================================

import { scoreBrevity, type BrevityResult } from "./brevity"
import { scoreEase, type EaseResult, type FreqRank } from "./ease"
import {
  checkContradiction, checkDuplicateOfModel, checkLength, checkPeerCopy, checkVerbatim,
  needsTeacherReview, type Flag,
} from "./guards"
import { scoreMeaning, weakestPropositions, type MeaningResult } from "./meaning"
import { wordCount } from "./text"

export interface ScoreInput {
  answer: string
  passageBody: string
  targetWords: number
  freq: FreqRank
  /** 답안 전체 + 문장별 벡터 */
  answerVectors: number[][]
  propositionVectors: number[][]
  modelVectors: number[][]
  /** 채점 기준이 된 모범 답안 원문 — 베낌 판정은 표면 비교로 한다 */
  modelAnswers?: string[]
  /** 같은 방 다른 학생들의 (닉네임, 답안 원문) */
  peers?: Array<{ nickname: string; text: string }>
  contradictedIndices?: number[]
  /** LLM 이 담았다고 판정한 명제 인덱스 (있으면 커버리지의 기준) */
  coveredIndices?: number[]
  /** 플래그 문구에 명제 원문을 넣기 위해 */
  propositions?: string[]
}

export interface ScoreResult {
  total: number
  meaning: number
  brevity: number
  ease: number
  /** 총점 밖 보너스 — 팀 점수에 가산 */
  bonus: number
  words: number
  flags: Flag[]
  needsReview: boolean
  weakPropositions: number[]
  detail: {
    meaning: MeaningResult["detail"]
    brevity: Omit<BrevityResult, "score">
    ease: EaseResult["detail"]
  }
}

/** 빈 제출에 대한 0점 결과. 어떤 축도 "기본 만점"으로 새지 않게 한 곳에서 만든다. */
function emptyResult(words: number, flags: Flag[]): ScoreResult {
  return {
    total: 0, meaning: 0, brevity: 0, ease: 0, bonus: 0, words, flags,
    needsReview: false,
    weakPropositions: [],
    detail: {
      meaning: { propositions: [], coverage: 0, gist: 0, gistSim: 0, coverageSource: "embedding" },
      brevity: { bonus: 0, over: 0 },
      ease: { contentWords: 0, easyShare: 0, hardShare: 0, avgSentenceLength: 0, hardWords: [] },
    },
  }
}

export function scoreSubmission(input: ScoreInput): ScoreResult {
  const words = wordCount(input.answer)

  // 빈 답안은 간결 점수 만점(0단어 ≤ 목표)을 받아버린다. 축별로 막지 않고
  // 여기서 한 번에 끊는다.
  const lengthGuard = checkLength(words)
  if (lengthGuard?.kind === "empty") return emptyResult(words, [lengthGuard])

  const meaning = scoreMeaning({
    answerVectors: input.answerVectors,
    propositionVectors: input.propositionVectors,
    modelVectors: input.modelVectors,
    contradictedIndices: input.contradictedIndices,
    coveredIndices: input.coveredIndices,
  })
  const brevity = scoreBrevity(words, input.targetWords)
  const ease = scoreEase(input.answer, input.freq)

  // --- 가드 (전부 표면 비교) ---
  const flags: Flag[] = []
  if (lengthGuard) flags.push(lengthGuard)

  const verbatim = checkVerbatim(input.passageBody, input.answer)
  if (verbatim) flags.push(verbatim)

  const dup = checkDuplicateOfModel(input.answer, input.modelAnswers ?? [])
  if (dup) flags.push(dup)

  const peerFlag = checkPeerCopy(input.answer, input.peers ?? [])
  if (peerFlag) flags.push(peerFlag)

  const contra = checkContradiction(input.contradictedIndices ?? [], input.propositions ?? [])
  if (contra) flags.push(contra)

  const total = Math.round((meaning.score + brevity.score + ease.score) * 10) / 10

  return {
    total: Math.min(100, total),
    meaning: meaning.score,
    brevity: brevity.score,
    ease: ease.score,
    bonus: brevity.bonus,
    words,
    flags,
    needsReview: needsTeacherReview(flags),
    weakPropositions: weakestPropositions(meaning),
    detail: {
      meaning: meaning.detail,
      brevity: { bonus: brevity.bonus, over: brevity.over },
      ease: ease.detail,
    },
  }
}

export * from "./config"
export * from "./guards"
export * from "./meaning"
export * from "./text"
export { scoreBrevity, scoreEase }
export type { FreqRank }
