// ============================================================
// 복붙 가드
//
// standalone.html 에는 이 검사가 전혀 없었다. 원문에서 25단어를 그대로 잘라
// 붙이면 핵심어가 전부 들어 있으니 만점에 가까웠다 — 게임의 목적과 정반대다.
// ============================================================

import { GUARDS } from "./config"
import { tokens } from "./text"

export type FlagKind =
  | "verbatim" | "duplicate" | "peer-copy" | "too-short" | "empty" | "contradiction"

export interface Flag {
  kind: FlagKind
  /** 교사 화면에 그대로 보여줄 한국어 설명 */
  message: string
  /** 근거 (베낀 구간 등) */
  evidence?: string
}

/**
 * 원문과 답안의 최장 공통 연속 토큰 길이.
 * 지문 180 × 답안 40 = 7,200 셀이라 DP 로 충분하다.
 * 롤링 배열로 메모리는 O(답안 길이).
 */
export function longestCommonRun(
  passage: string,
  answer: string,
): { length: number; text: string } {
  const a = tokens(passage)
  const b = tokens(answer)
  if (a.length === 0 || b.length === 0) return { length: 0, text: "" }

  let prev = new Array<number>(b.length + 1).fill(0)
  let best = 0
  let bestEndB = 0

  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) {
          best = cur[j]
          bestEndB = j
        }
      }
    }
    prev = cur
  }

  return { length: best, text: b.slice(bestEndB - best, bestEndB).join(" ") }
}

export function checkVerbatim(passage: string, answer: string): Flag | null {
  const run = longestCommonRun(passage, answer)
  if (run.length < GUARDS.verbatimRun) return null
  return {
    kind: "verbatim",
    message: `원문을 ${run.length}단어 연속으로 옮겨 적었습니다. 자기 말로 바꿔야 합니다.`,
    evidence: run.text,
  }
}

/**
 * 내용어 집합의 자카드 유사도. 표면 형태 비교용.
 *
 * 베낌 판정에 임베딩 유사도를 쓰면 안 된다. 임베딩은 "같은 뜻"을 재는 도구라,
 * 같은 생각을 자기 말로 다르게 쓴 정직한 답안도 0.95 를 넘긴다 — 그걸 부정행위로
 * 몰면 이 게임이 장려하려는 바로 그 행동을 처벌하게 된다.
 * 베낌은 "같은 단어를 같은 순서로 썼는가"라는 표면 문제이므로 표면으로 잰다.
 */
export function surfaceOverlap(a: string, b: string): number {
  const sa = new Set(tokens(a).filter((w) => !SHORT_COMMON.has(w)))
  const sb = new Set(tokens(b).filter((w) => !SHORT_COMMON.has(w)))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const w of sa) if (sb.has(w)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** 자카드에서 뺄 초고빈도 기능어. 짧은 답안에서 우연 일치를 부풀린다. */
const SHORT_COMMON = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "to", "of", "in", "on", "and", "or",
  "but", "it", "they", "we", "you", "that", "this", "for", "with", "as", "at", "by", "from",
])

export function checkDuplicateOfModel(answer: string, modelAnswers: string[]): Flag | null {
  for (const model of modelAnswers) {
    const run = longestCommonRun(model, answer)
    const overlap = surfaceOverlap(model, answer)
    if (run.length >= GUARDS.modelRun || overlap >= GUARDS.duplicateOverlap) {
      return {
        kind: "duplicate",
        message: "예시 답안을 거의 그대로 옮겼습니다.",
        evidence: run.length >= GUARDS.modelRun ? run.text : `단어 겹침 ${overlap.toFixed(2)}`,
      }
    }
  }
  return null
}

export function checkPeerCopy(
  answer: string,
  peers: Array<{ nickname: string; text: string }>,
): Flag | null {
  for (const p of peers) {
    const run = longestCommonRun(p.text, answer)
    const overlap = surfaceOverlap(p.text, answer)
    if (run.length >= GUARDS.peerRun || overlap >= GUARDS.peerCopyOverlap) {
      return {
        kind: "peer-copy",
        message: `다른 학생(${p.nickname})의 답안과 거의 같습니다.`,
        evidence: run.length >= GUARDS.peerRun ? run.text : `단어 겹침 ${overlap.toFixed(2)}`,
      }
    }
  }
  return null
}

/** LLM 이 모순으로 판정한 명제가 있으면 교사 화면에 띄운다. */
export function checkContradiction(contradicted: number[], propositions: string[]): Flag | null {
  if (!contradicted.length) return null
  return {
    kind: "contradiction",
    message: `원문과 반대로 진술한 내용이 있습니다 (명제 ${contradicted.map((i) => i + 1).join(", ")}).`,
    evidence: contradicted.map((i) => propositions[i]).filter(Boolean).join(" / "),
  }
}

export function checkLength(words: number): Flag | null {
  if (words === 0) return { kind: "empty", message: "답안이 비어 있습니다." }
  if (words < 5) return { kind: "too-short", message: "5단어 미만은 요약으로 보기 어렵습니다." }
  return null
}

/** 교사 확인이 필요한 플래그인지. 이 경우 점수를 확정하지 않는다. */
export function needsTeacherReview(flags: Flag[]): boolean {
  return flags.some(
    (f) =>
      f.kind === "verbatim" || f.kind === "duplicate" ||
      f.kind === "peer-copy" || f.kind === "contradiction",
  )
}
