// ============================================================
// 텍스트 정규화 — 채점 전 단계의 순수 함수들
// ============================================================

/** 화면 카운터와 동일한 규칙. 공백 기준이라 하이픈 복합어는 1단어로 센다. */
export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/** 소문자 알파벳 토큰. 축약형의 어포스트로피는 살린다(don't → don't). */
export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z']*/g) ?? []
}

/** 문장 분리. 약어(Dr. 등)까지 다루지 않는다 — 학생 답안은 1~2문장이라 충분하다. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 캐시 키·중복 판정을 위한 정규화. 대소문자·구두점·공백 차이를 없앤다. */
export function normalizeForCompare(text: string): string {
  return tokens(text).join(" ")
}

/**
 * 빈도표 조회용 표제어 후보들. 표제어 사전이 굴절형을 담고 있지 않으므로
 * 규칙 기반으로 되돌린다. 조회는 "후보 중 사전에 있는 것"을 쓰므로
 * 과생성(틀린 후보 포함)은 안전하지만 누락은 단어를 고난도로 오판하게 만든다.
 */
export function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase().replace(/'s$/, "")
  const out = [w]
  const add = (s: string) => {
    if (s.length >= 2 && !out.includes(s)) out.push(s)
  }

  if (w.endsWith("ies") && w.length > 4) add(w.slice(0, -3) + "y")
  if (w.endsWith("ied") && w.length > 4) add(w.slice(0, -3) + "y")
  if (w.endsWith("ier") && w.length > 4) add(w.slice(0, -3) + "y")
  if (w.endsWith("iest") && w.length > 5) add(w.slice(0, -4) + "y")
  if (w.endsWith("ily") && w.length > 4) add(w.slice(0, -3) + "y")

  for (const suf of ["ing", "ed", "es", "s", "er", "est", "ly", "ness", "ment"]) {
    if (w.endsWith(suf) && w.length > suf.length + 2) {
      const base = w.slice(0, -suf.length)
      add(base)
      add(base + "e") // making → mak → make
      // 자음 중복 되돌리기: stopped → stopp → stop
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        add(base.slice(0, -1))
      }
    }
  }
  return out
}

/**
 * 기능어. "쉬운 표현" 점수에서 제외한다 — 전부 최상위 빈도라 포함하면
 * 누구나 쉬운 글을 쓴 것처럼 보인다.
 */
export const FUNCTION_WORDS = new Set([
  "a", "an", "the",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what", "where", "when", "why", "how",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "and", "or", "but", "if", "so", "than", "as", "because", "while", "when",
  "of", "in", "on", "at", "to", "for", "with", "by", "from", "about", "into",
  "over", "after", "before", "between", "through", "during", "without", "within",
  "not", "no", "yes", "very", "too", "also", "just", "only", "more", "most",
  "some", "any", "all", "both", "each", "many", "much", "few", "other", "another",
  "there", "here", "then", "now", "up", "out", "down", "off", "again",
])
