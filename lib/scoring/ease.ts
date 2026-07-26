// ============================================================
// 쉬운 표현 점수 (25점)
//
// standalone.html 은 어려운 단어 14개를 하드코딩해 뺐다. 그 목록은 근거가 없었다
// (예: "therefore" 는 수능 코퍼스 빈도 842위로 오히려 흔한 단어인데 감점 대상이었다).
// 여기서는 수능 코퍼스 상위빈도 6,302 표제어의 순위를 근거로 쓴다.
// ============================================================

import { EASE } from "./config"
import { FUNCTION_WORDS, lemmaCandidates, sentences, tokens, wordCount } from "./text"

export type FreqRank = Record<string, number>

export interface EaseResult {
  score: number
  detail: {
    contentWords: number
    easyShare: number
    hardShare: number
    avgSentenceLength: number
    /** 빈도표 밖이라 고난도로 잡힌 단어들 — 학생 피드백에 그대로 보여준다 */
    hardWords: string[]
  }
}

/** 굴절형을 되돌려가며 조회한다. 못 찾으면 null(= 빈도표 밖 = 고난도). */
export function lookupRank(word: string, freq: FreqRank): number | null {
  let best: number | null = null
  for (const cand of lemmaCandidates(word)) {
    const r = freq[cand]
    if (r !== undefined && (best === null || r < best)) best = r
  }
  return best
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function scoreEase(answer: string, freq: FreqRank): EaseResult {
  const all = tokens(answer)
  const content = all.filter((w) => !FUNCTION_WORDS.has(w))

  const sents = sentences(answer)
  const avgSentenceLength = sents.length ? wordCount(answer) / sents.length : wordCount(answer)

  if (content.length === 0) {
    return {
      score: 0,
      detail: { contentWords: 0, easyShare: 0, hardShare: 0, avgSentenceLength, hardWords: [] },
    }
  }

  let easy = 0
  const hardWords: string[] = []
  for (const w of content) {
    const rank = lookupRank(w, freq)
    if (rank === null) {
      if (!hardWords.includes(w)) hardWords.push(w)
    } else if (rank <= EASE.easyRank) {
      easy++
    }
  }

  const easyShare = easy / content.length
  const hardShare = hardWords.length / content.length

  // 평균 문장 길이: 12단어 이하 만점, 25단어에서 0점
  const lenScore = clamp01(
    (EASE.sentLenZero - avgSentenceLength) / (EASE.sentLenZero - EASE.sentLenFull),
  )

  const raw =
    EASE.weights.easy * easyShare +
    EASE.weights.notHard * (1 - hardShare) +
    EASE.weights.sentenceLength * lenScore

  return {
    score: Math.round(25 * clamp01(raw) * 10) / 10,
    detail: {
      contentWords: content.length,
      easyShare: Math.round(easyShare * 1000) / 1000,
      hardShare: Math.round(hardShare * 1000) / 1000,
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      hardWords: hardWords.slice(0, 8),
    },
  }
}
