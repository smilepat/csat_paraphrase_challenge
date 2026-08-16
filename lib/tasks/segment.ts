// ============================================================
// 지문 본문을 태스크가 가리킬 수 있는 구간으로 쪼갠다.
//
// 원천 데이터의 현실 두 가지를 여기서 흡수한다:
//  ① 본문에 **한글이 섞여 있다.** 함축 의미 문항은 발문("밑줄 친 …가 의미하는")이
//     본문 앞에 붙어 있고, 배점 표시 "[3점]"의 '점'도 한글이다.
//     → 한글이 든 구간은 태스크 자극이 될 수 없다.
//  ② 40번 요약문 지문은 본문 뒤에 **요약문 블록**이 붙어 있다(U+F03B 등 사제 영역
//     글리프로 구분). 이 블록은 읽기 지문이 아니라 정답 쪽이므로 분리해야 한다.
//     동시에 유형 2 의 사람이 만든 정답 쌍이 여기 들어 있다.
// ============================================================

/** 한글(음절·자모)이 하나라도 있는가. */
export function hasHangul(s: string): boolean {
  return /[가-힣ㄱ-ㆎ]/.test(s)
}

/** 마침표가 문장 끝이 아닌 흔한 경우. 마침표 **앞** 토큰으로 판정한다. */
const ABBREV = new Set([
  "e.g", "i.e", "etc", "vs", "cf", "al", "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr",
  "fig", "no", "vol", "pp", "ca", "approx",
])

/**
 * 문장 경계를 오프셋과 함께 돌려준다.
 * body 는 OCR 유래라 문장 중간에 줄바꿈이 있다 — 공백으로 취급하면 된다.
 */
export function sentences(body: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = []
  let start = 0

  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== "." && c !== "!" && c !== "?") continue

    // 닫는 따옴표·괄호는 문장 끝에 붙어 있을 수 있다
    let j = i + 1
    while (j < body.length && /["'’”)\]]/.test(body[j])) j++

    // 뒤에 공백이나 문서 끝이 와야 문장 경계다
    if (j < body.length && !/\s/.test(body[j])) continue

    if (c === ".") {
      // 약어 — 마침표 앞의 토큰을 본다
      const before = body.slice(Math.max(0, i - 12), i)
      const tok = before.match(/([A-Za-z.]+)$/)?.[1]?.toLowerCase()
      if (tok && ABBREV.has(tok.replace(/\.$/, ""))) continue
      // 머리글자 하나(J. Smith)와 소수점(15.3)
      if (/(^|[\s(])[A-Za-z]$/.test(before)) continue
      if (/\d$/.test(before) && /^\s*\d/.test(body.slice(j))) continue
    }

    const text = body.slice(start, j).trim()
    if (text) {
      const lead = body.slice(start, j).length - body.slice(start, j).trimStart().length
      out.push({ start: start + lead, end: start + lead + text.length, text })
    }
    start = j
    i = j - 1
  }

  const tail = body.slice(start).trim()
  if (tail) {
    const lead = body.slice(start).length - body.slice(start).trimStart().length
    out.push({ start: start + lead, end: start + lead + tail.length, text: tail })
  }
  return out
}

/**
 * 40번 요약문 지문을 읽기 지문과 요약문 블록으로 가른다.
 * 구분자는 아래화살표 자리의 글리프만 있는 줄이다. 없으면 전부 지문.
 *
 * WARNING 이 코퍼스의 실제 구분자는 U+F003B 로, BMP 사제 영역(U+E000~U+F8FF)이 아니라
 * Plane 15 보충 사제 영역(U+F0000~U+FFFFD)에 있다. JS 문자열에서는 서로게이트 쌍이므로
 * 문자 클래스로 잡으려면 u 플래그가 필요하다. 범위를 좁게 잡으면 조용히 0건이 된다.
 */
const SUMMARY_MARK =
  /\n[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\u2193\u21D3]+[ \t]*\n/u

export function splitSummaryBlock(
  body: string,
): { passageEnd: number; summaryStart: number; summary: string | null } {
  const m = body.match(SUMMARY_MARK)
  if (!m || m.index === undefined) {
    return { passageEnd: body.length, summaryStart: body.length, summary: null }
  }

  const summary = body
    .slice(m.index + m[0].length)
    // 선택지 열 머리글 "(A) (B) (A) (B)" 는 요약문이 아니다
    .replace(/\n\s*\((?:A|B)\)[\s()AB]*$/i, "")
    .trim()

  // summaryStart 는 구분자 글리프 **뒤**다. 마커가 자극이나 문맥에 섞이지 않게 한다.
  return { passageEnd: m.index, summaryStart: m.index + m[0].length, summary: summary || null }
}

/** 태스크 자극으로 쓸 수 있는 문장인가. */
export function usableSentence(text: string): boolean {
  if (hasHangul(text)) return false
  // 빈칸 문항은 빈칸이 지워져 " ." 같은 조각을 남긴다
  if (text.replace(/[^A-Za-z]/g, "").length < 40) return false
  if (text.length > 320) return false
  return true
}
