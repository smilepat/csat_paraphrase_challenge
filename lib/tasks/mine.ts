// ============================================================
// 지문에서 유형별 태스크 후보를 뽑는다. **LLM 을 쓰지 않는다** — 전부 정규식과
// 빈도표로만 만든다. 여기서 나온 것은 전부 후보(review_status='raw')이며
// 사람이 승인해야 학생에게 나간다.
//
// 유형별 공급량은 313편 전수 실측 기준(사례집 분석):
//   유형1  문장 2,498개 — 사실상 전부가 후보라 지문당 상한을 둔다
//   유형2  the+파생명사+of  228건 / 137편(43%)
//   유형3  지시사+추상명사   24건 /  23편(7%)  ← 정규식의 상한. 확장은 M13.
// ============================================================

import { sentences, splitSummaryBlock, usableSentence, hasHangul } from "./segment"
import { findFiniteVerb, firstVerbLike } from "../scoring/typed/structure"

export type TaskDraft = {
  passageId: string
  type: 1 | 2 | 3
  direction: string | null
  contextStart: number
  contextEnd: number
  stimulusStart: number
  stimulusEnd: number
  stimulusText: string
  targetForm: "noun_phrase" | "clause" | null
  answerStart: number | null
  answerEnd: number | null
  avoidWords: string[] | null
  gold: { text: string; note?: string }[] | null
  origin: "gold" | "regex" | "llm"
  notes: string | null
}

export type FreqRank = Record<string, number>

/** 지문당 상한. 한 지문이 문제 은행을 독차지하지 않게 한다. */
export const CAPS = { type1: 2, type2unfold: 2, type2fold: 1, type3: 3 } as const

/** 이 순위 안쪽은 기능어에 가까워 "바꿔 쓸 대상"이 못 된다. */
const COMMON_RANK = 300

/** 유형 3 의 껍데기 이름. 앞 내용을 통째로 되받는 추상명사들. */
const SHELL = `tendency shift process idea view approach practice phenomenon phenomena assumption belief
pattern strategy principle distinction difference change effect result finding behavior notion concept
ability capacity condition situation feature factor argument claim reasoning explanation account
interpretation perspective problem mechanism relationship development transformation capability quality
property trend attitude response system structure function activity variation insight observation
constraint limitation requirement consequence advantage benefit risk case reason purpose goal method
technique procedure step stage paradox dilemma tension conflict contradiction bias error illusion
complexity uncertainty ambiguity diversity variability flexibility kind sort type form aspect element
characteristic`
  .split(/\s+/)
  .filter(Boolean)

const SHELL_ALT = [...new Set(SHELL.flatMap((w) => [w, w + "s"]))]
  .sort((a, b) => b.length - a.length)
  .join("|")

/** 명사화 접미사. -al/-y 는 너무 헐거워 뺐다(the total of, the way of 를 잡는다). */
const NOMINAL_SUFFIX = "tion|sion|ity|ment|ness|ance|ence|ism|ure|ship|hood|dom|ing"

const RE_NOMINAL = new RegExp(
  String.raw`\bthe\s+((?:[a-z]+\s+){0,2}?[a-z]+(?:${NOMINAL_SUFFIX}))\s+of\b`,
  "gi",
)
// 중간 수식어를 캡처해 둔다 — 껍데기 이름 바로 앞이 조동사면 그 낱말은 명사가
// 아니라 **동사**다("This may result"). 이 한 줄이 없으면 오탐이 그대로 들어온다.
const RE_SHELL_DEM = new RegExp(
  String.raw`\b(This|These|Such|Those)\s+((?:[A-Za-z-]+\s+){0,3}?)(?:${SHELL_ALT})\b`,
  "g",
)
const RE_SHELL_DEF = new RegExp(
  String.raw`\bThe\s+((?:[A-Za-z-]+\s+){0,3}?)(?:${SHELL_ALT})\b`,
  "g",
)

/** 껍데기 이름 앞에 오면 그것이 동사임을 뜻하는 낱말들. */
const VERB_CUE = /^(may|might|will|would|can|could|shall|should|must|to|not|never|also|often|then)$/i

function looksLikeVerb(middle: string): boolean {
  const last = middle.trim().split(/\s+/).pop() ?? ""
  return VERB_CUE.test(last)
}

/**
 * of 보문이 여기서 끝난다고 볼 낱말들. 접속사뿐 아니라 **조동사·계사**도 넣어야
 * "the variability of natural food ingredients **may** (B) people's ..." 처럼
 * 명사구를 넘어 술부까지 삼키는 일이 없다.
 */
const STOP_OF =
  /^(and|or|but|which|that|who|whose|because|while|although|may|might|will|would|can|could|shall|should|must|is|are|was|were|be|been|has|have|had|do|does|did|seems?|becomes?)$/

/**
 * of 보문의 끝을 근사한다. 구문 분석이 아니라 근사이므로 후보는 전부 사람이 본다.
 *
 * **자연스럽게 끝나지 않으면 null 을 준다.** 낱말 수 상한에 걸려 끊긴 자리는
 * 어구 경계가 아니라서 "the sharp division of time into past" 처럼 중간이 잘린
 * 자극이 나온다(표본 10개 중 3개가 그랬다). 그런 문항은 학생을 헷갈리게 하므로
 * 뽑지 않는 편이 낫다 — 유형 2 는 공급이 넉넉하다(137편/43%).
 */
/**
 * of 보문의 끝을 근사한다.
 *
 * 다섯 번을 고쳐 보고 방침을 바꿨다. 정규식으로 명사구 경계를 **정확히** 잡으려 하면
 * 계속 새로운 실패가 나온다 — 낱말 수 상한에 걸려 잘리고, 쉼표에서 나열이 끊기고,
 * 나열을 이어 붙이면 술부를 먹고, 문맥 없이 부른 동사 판정이 수식어를 동사로 본다.
 *
 * 그래서 **정확한 경계를 잡는 대신 확실한 것만 뽑는다.** 조금이라도 애매하면 버린다:
 *   · 쉼표가 들어가면 버린다(나열인지 삽입구인지 구별하려다 계속 틀렸다)
 *   · 낱말 수 상한에 걸리면 버린다(중간에서 잘린 자리다)
 *   · of 뒤에 내용어가 없으면 버린다("the experience of" 같은 껍데기)
 * 유형 2 는 공급이 넉넉하므로(137편/43%) 엄격해도 문항이 모자라지 않는다.
 */
/**
 * 끝에 매달린 기능어를 떼어 낸다.
 * 문장이 "…everyone being judged." 처럼 끝나면 뒤에 낱말이 없어 수식어 규칙이
 * 구조적으로 발동할 수 없고, "the performance of everyone **being**" 이 남는다.
 * 경계를 더 정교하게 잡으려 하기보다 꼬리를 자르는 편이 확실하다.
 */
const TRAILING_JUNK = /\s+(being|been|having|of|the|a|an|in|on|at|to|for|with|by|from|and|or|as|than|that|which)$/i

function trimTrailing(text: string): string {
  let out = text.trimEnd()
  for (let i = 0; i < 3; i++) {
    const next = out.replace(TRAILING_JUNK, "")
    if (next === out) break
    out = next
  }
  return out
}

const MAX_OF_WORDS = 8

function ofComplementEnd(body: string, from: number, limit: number): number | null {
  let i = from
  let words = 0
  let prevWord = ""
  let prevStart = -1
  while (i < limit && words < MAX_OF_WORDS) {
    while (i < limit && /\s/.test(body[i]!)) i++
    const start = i
    const windowStart = prevStart >= 0 ? prevStart : start
    while (i < limit && !/[\s,;:.!?]/.test(body[i]!)) i++
    const w = body.slice(start, i)
    if (!w) break
    const lower = w.toLowerCase()

    if (STOP_OF.test(lower)) return words > 0 ? start : null
    // 문맥 없이 부르면 "an ever more **varied** set" 의 varied 를 동사로 본다.
    // 게다가 수식어 판정은 **뒤에 낱말이 있어야** 발동하므로("being judged" 만으로는
    // 절대 안 걸린다) 앞뒤를 모두 담은 창을 넘긴다. 창 안의 다른 낱말이 동사로
    // 잡히면 안 되므로 **이 낱말이 바로 그 동사일 때만** 멈춘다.
    const hit = findFiniteVerb(body.slice(windowStart, Math.min(limit, i + 25)))
    if (hit.finite && hit.cue === lower) return words > 0 ? start : null
    if (lower.startsWith("(")) return words > 0 ? start : null

    words++
    prevWord = lower
    prevStart = start
    if (i < limit && body[i] === ",") return null // 쉼표가 끼면 버린다
    if (i < limit && /[;:.!?]/.test(body[i]!)) return i
  }
  // 문장 끝에 닿았으면 자연스러운 끝. 상한에 걸린 것이면 잘린 것이다.
  return i >= limit && words > 0 ? limit : null
}

/**
 * 닫힌 부류(대명사·한정사·접속사 등). 빈도 순위만으로는 안 걸러진다 —
 * "those / other / while" 은 순위가 300 밖이어도 **다르게 표현할 대상이 아니다.**
 */
const CLOSED_CLASS = new Set(`
those these such other others another same own both each every either neither
while whereas although though unless until since because therefore however moreover
their theirs your yours ours whose which what when where whether whom
more most less least many much some any none all several various certain
about above across after against along among around before behind below beneath
beside between beyond during except inside near outside over through toward under
within without upon onto into likely often always never sometimes usually rather
quite very just even still also thus hence indeed perhaps maybe
`.trim().split(/\s+/))

/**
 * 다르게 표현할 낱말 후보. **적게 고른다.**
 *
 * 예전에는 내용어를 12개까지 담았는데, 그러면 문장의 거의 모든 낱말이 목록에 오른다.
 * 학생에게 "이 문장을 통째로 다시 쓰라"고 요구하는 셈이고, 유형 1 이 재려는 것은
 * 그게 아니다 — 핵심어 몇 개를 다른 말로 바꿀 수 있는가다.
 * 그래서 **드문 낱말(의미를 지고 있는 쪽) 순으로 최대 5개**만 고른다.
 */
const AVOID_MAX = 5

function contentWords(text: string, freq: FreqRank): string[] {
  const seen = new Map<string, number>()
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    const w = raw.replace(/^['-]+|['-]+$/g, "")
    if (w.length < 4 || CLOSED_CLASS.has(w)) continue
    const rank = freq[w]
    if (rank !== undefined && rank <= COMMON_RANK) continue
    // 빈도표 밖(= 가장 드문 낱말)을 가장 앞에 둔다
    if (!seen.has(w)) seen.set(w, rank ?? Number.MAX_SAFE_INTEGER)
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w)
}

/**
 * 명사구 하나로 묶을 수 있는 문장인가.
 *
 * 묶기가 성립하려면 **주어 하나 + 정형동사 하나**여야 한다. 관계절이나 종속절이 끼면
 * 명사구 하나에 다 담을 수 없고, 학생은 무엇을 버려야 할지 몰라 막힌다.
 */
export function isFoldable(text: string): boolean {
  // 빈칸 문항의 빈 자리가 " ." 로 남는다("… but by its .")
  if (/\s\.(\s|$)/.test(text)) return false
  if (/\(\s*[AB]\s*\)/.test(text)) return false
  if (/[;:]/.test(text)) return false
  // 관계절·종속절이 있으면 단문이 아니다
  if (/\b(which|who|whom|whose|that|because|although|though|while|whereas|unless|until)\b/i.test(text)) {
    return false
  }
  // 의문사절도 같은 이유로 뺀다 — "…on what the scientific method can achieve"
  if (/\b(what|when|where|how|whether)\b/i.test(text)) return false
  // 괄호·인용부호·숫자 기호가 든 문장은 묶으면 읽을 수 없는 명사구가 된다
  // ("This 15% (actually －15%) figure would then represent “average” performance.")
  if (/[()"“”%–—―]|\d/.test(text)) return false
  // 축약 관계절 — "One exercise in teamwork **I do** at a company retreat is …"
  if (/\b(?:I|we|you|they|he|she|it)\s+[a-z]+\b/.test(text)) return false
  // 명령문·2인칭은 명사구로 묶을 주어가 없다
  // ("Then tell him to keep his eyes closed…", "You have to challenge…")
  if (/\b(?:you|your)\b/i.test(text)) return false
  if (/^\s*(?:Then|Now|First|Next|Instead|Also)?\s*(?:tell|make|put|take|keep|imagine|consider|think|try|look|note|ask|give|let)\b/i.test(text)) {
    return false
  }
  // 쉼표가 둘 이상이면 삽입구·열거다. "The film director, as compared to the
  // theater director, has as his material, the finished celluloid." 같은 것은
  // 명사구 하나로 묶을 수가 없다.
  if ((text.match(/,/g) ?? []).length >= 2) return false
  // 주어가 이미 "the N of X" 면 묶을 것이 남아 있지 않다
  if (/^\s*(?:The|A|An)\s+[A-Za-z-]+\s+of\b/i.test(text)) return false
  if (text.length < 55 || text.length > 140) return false
  if (text.trimEnd().endsWith("?")) return false
  // 명사형이 있을 법한 흔한 동사여야 한다 — 그래야 "the …ity of …" 가 만들어진다
  return firstVerbLike(text) !== null
}

/**
 * 문장에서 **다시 말할 구 하나**를 고른다.
 *
 * 단어 수로 좌우를 넓히면 "insights and intuitions **that**" 이나
 * "Surprises can fall **from**" 처럼 매달린 조각이 나온다. 그래서 **명사구 구조**로 잡는다:
 * 드문 명사를 머리로 두고 **왼쪽 수식어만** 끌어온다. 오른쪽으로는 넓히지 않는다.
 *
 * 사례집의 실제 정답 쌍이 그 모양이다 — "a precisely controlled fashion → controllability".
 */
const MODIFIER_SUFFIX = /(?:ed|ing|ous|al|ive|ic|able|ible|ful|less|ary|ent|ant|ly)$/
const DETERMINER_W = /^(?:a|an|the|this|these|those|his|her|their|our|its|no|every|each)$/i

function isModifier(w: string): boolean {
  const lower = w.toLowerCase()
  if (DETERMINER_W.test(lower)) return true
  if (w.includes("-")) return true
  if (MODIFIER_SUFFIX.test(lower) && lower.length > 4) return true
  return false
}

function pickPhrase(
  sentence: string,
  rareFirst: string[],
): { start: number; end: number; text: string } | null {
  for (const w of rareFirst) {
    // 동사를 머리로 삼으면 "the brain replays" 같은 절 조각이 된다. 명사만 머리로 쓴다.
    if (firstVerbLike(w)) continue
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const m = sentence.match(new RegExp(`\\b${esc}[a-z-]*\\b`, "i"))
    if (!m || m.index === undefined) continue

    // 왼쪽 수식어만 최대 3 개까지 끌어온다
    let left = m.index
    for (let k = 0; k < 3; k++) {
      const before = sentence.slice(0, left).match(/([A-Za-z][A-Za-z-]*)(\s*)$/)
      if (!before) break
      if (/[,;:.!?]/.test(before[2] ?? "")) break
      if (!isModifier(before[1]!)) break
      left = left - before[1]!.length - (before[2]?.length ?? 0)
    }

    const text = sentence.slice(left, m.index + m[0].length).trim()
    const words = text.split(/\s+/).length
    if (words < 2 || words > 6 || hasHangul(text)) continue
    const offset = sentence.indexOf(text, Math.max(0, left - 2))
    if (offset < 0) continue
    return { start: offset, end: offset + text.length, text }
  }
  return null
}

/**
 * 한 지문의 태스크 후보 전부.
 * 요약문 블록(40번)은 읽기 지문이 아니므로 유형 1·3 에서 제외하고,
 * 유형 2 에서는 오히려 **사람이 만든 정답 쪽**이므로 origin='gold' 로 표시한다.
 */
export function minePassage(
  passageId: string,
  body: string,
  freq: FreqRank,
): TaskDraft[] {
  const { passageEnd, summaryStart, summary: summaryText } = splitSummaryBlock(body)
  const sents = sentences(body)
  const readable = sents.filter((s) => s.end <= passageEnd && usableSentence(s.text))
  const out: TaskDraft[] = []

  const sentenceAt = (pos: number) => sents.find((s) => pos >= s.start && pos < s.end)
  const inSummary = (pos: number) => pos >= passageEnd

  // ── 유형 1 : 구(句)를 같은 뜻의 다른 말로 ─────────────────
  // ⚠ 예전에는 **문장 전체**를 주고 내용어를 하나씩 바꾸라고 했다. 그건 유형 1 이
  //   아니다 — 사례집의 다섯 장치(파생·동의어·상위어·비유 해독·관용어 압축)는 전부
  //   **구 단위**다. "a precisely controlled fashion → controllability" 처럼.
  //   단어 대 단어 치환은 "long-term 을 다른 말로" 같은 불가능한 요구를 만든다.
  const ranked = readable
    .map((s) => ({ s, words: contentWords(s.text, freq) }))
    .filter((x) => x.words.length >= 2)
    .sort((a, b) => b.words.length - a.words.length)

  for (const { s: sent, words } of ranked.slice(0, CAPS.type1)) {
    const phrase = pickPhrase(sent.text, words)
    if (!phrase) continue
    // 내용어가 하나뿐인 구("the insights")는 다시 말하기가 너무 쉽다.
    // 사례집의 실제 사례는 "a precisely controlled fashion" 처럼 수식어가 붙어 있다.
    const inside = contentWords(phrase.text, freq)
    if (inside.length < 2) continue
    const start = sent.start + phrase.start
    const end = sent.start + phrase.end
    out.push({
      passageId, type: 1, direction: null,
      contextStart: sent.start, contextEnd: sent.end,
      stimulusStart: start, stimulusEnd: end,
      stimulusText: body.slice(start, end),
      targetForm: null, answerStart: null, answerEnd: null,
      avoidWords: inside.slice(0, 4),
      gold: null, origin: "regex",
      notes: null,
    })
  }

  // ── 유형 2 unfold : 이름을 문장으로 ─────────────────────────────
  // 40번 요약문 블록의 명사화는 **사람이 만든 정답 쪽**이라 가장 값지다.
  // 문서 순서대로 상한을 먹이면 본문 앞쪽이 자리를 다 차지해 골드가 밀려난다.
  // → 골드를 먼저 세우고, 상한은 일반 후보에만 적용한다.
  const nominalHits = [...body.matchAll(RE_NOMINAL)].sort(
    (a, b) => Number(inSummary(b.index!)) - Number(inSummary(a.index!)),
  )
  let unfold = 0
  for (const m of nominalHits) {
    const start = m.index!
    const gold = inSummary(start)
    if (!gold && unfold >= CAPS.type2unfold) continue
    const host = sentenceAt(start)
    if (!host || hasHangul(host.text)) continue
    const end = ofComplementEnd(body, start + m[0].length, host.end)
    if (end === null) continue // 중간에서 잘린 자극은 내지 않는다
    const text = trimTrailing(body.slice(start, end).trim())
    if (text.length < 12 || hasHangul(text)) continue

    // 요약문 안의 명사화라면 문맥이 구분자 글리프까지 거슬러 올라가지 않게 자른다
    let ctxStart = gold ? Math.max(host.start, summaryStart) : host.start
    while (ctxStart < body.length && !/[A-Za-z]/.test(body[ctxStart])) ctxStart++

    out.push({
      passageId, type: 2, direction: "unfold",
      contextStart: Math.min(ctxStart, start), contextEnd: host.end,
      stimulusStart: start, stimulusEnd: start + text.length, stimulusText: text,
      targetForm: "clause", answerStart: null, answerEnd: null,
      avoidWords: null, gold: null,
      origin: gold ? "gold" : "regex",
      notes: gold
        ? "40번 요약문의 명사화 — 지문 본문에 대응하는 절이 있다. 검수 시 gold 에 적을 것"
        : null,
    })
    if (!gold) unfold++
  }

  // ── 유형 2 fold : 문장을 명사구로 묶기 ─────────────────────
  // ⚠ 예전에는 "읽을 만한 문장 아무거나" 를 골랐다. 그러면 빈칸이 남은 조각,
  //   복문, 이미 명사구가 주어인 문장이 섞여 **묶는 것이 불가능한 문항**이 나온다.
  //   골드 쌍의 공통 모양은 단문이다:
  //     "synthetic ingredients can be made in a precisely controlled fashion"
  //     → "the controllability of the production process"
  const foldable = readable.find((s) => isFoldable(s.text))
  if (foldable) {
    out.push({
      passageId, type: 2, direction: "fold",
      contextStart: foldable.start, contextEnd: foldable.end,
      stimulusStart: foldable.start, stimulusEnd: foldable.end, stimulusText: foldable.text,
      targetForm: "noun_phrase", answerStart: null, answerEnd: null,
      avoidWords: null, gold: null, origin: "regex", notes: null,
    })
  }

  // ── 유형 2 골드 : 40번 요약문 ──────────────────────────────────
  // ⚠ 요약문의 명사화 자리는 **빈칸 (A)** 그 자체다("The (A) of the production process").
  //   즉 사람이 만든 정답 쌍은 원리적으로 정규식에 안 잡힌다. 자동 추출을 포기하고
  //   검수 대기 스텁으로 세워 둔다 — 12개년 중 가장 값진 12쌍을 놓치지 않으려면
  //   보이게 만들어야 한다.
  if (summaryText) {
    // 구분자 글리프는 문장 분할에서 요약문 첫 문장의 **앞머리에 붙는다.**
    // 그래서 "요약문 뒤에서 시작하는 문장"을 찾으면 하나도 안 나온다 —
    // 걸치는 문장을 찾아 시작점을 요약문 쪽으로 밀어야 한다.
    const host = sents.find((s) => s.end > summaryStart && !hasHangul(s.text))
    let start = host ? Math.max(host.start, summaryStart) : -1
    while (start >= 0 && start < body.length && !/[A-Za-z]/.test(body[start])) start++
    const block = host && start < host.end ? { start, end: host.end } : null
    if (block) {
      out.push({
        passageId, type: 2, direction: "fold",
        contextStart: block.start, contextEnd: block.end,
        stimulusStart: block.start, stimulusEnd: block.end,
        stimulusText: body.slice(block.start, block.end),
        targetForm: "noun_phrase", answerStart: null, answerEnd: null,
        avoidWords: null,
        gold: [{ text: summaryText, note: "40번 요약문 원문" }],
        origin: "gold",
        notes:
          "검수 필요: 지문에서 이 요약문에 대응하는 절을 찾아 stimulus 를 그쪽으로 옮기고, " +
          "gold 에 (절 → 이름) 쌍을 적을 것. 빈칸 (A)/(B) 가 곧 정답이라 자동 추출이 안 된다.",
      })
    }
  }

  // ── 유형 3 : 되받는 이름 ───────────────────────────────────────
  let t3 = 0
  const seen3 = new Set<number>()
  for (const [re, confident] of [[RE_SHELL_DEM, true], [RE_SHELL_DEF, false]] as const) {
    for (const m of body.matchAll(re)) {
      if (t3 >= CAPS.type3) break
      const start = m.index!
      if (seen3.has(start) || inSummary(start)) continue
      // 마지막 캡처가 중간 수식어다. 조동사로 끝나면 뒤 낱말은 동사다.
      if (looksLikeVerb(m[m.length - 1] ?? "")) continue
      const host = sentenceAt(start)
      if (!host || hasHangul(host.text)) continue

      // 앞에 받을 것이 없으면 되받기가 아니다
      const hostIdx = sents.indexOf(host)
      if (hostIdx < 1) continue
      const prev = sents[hostIdx - 1]
      if (prev.end > passageEnd) continue

      seen3.add(start)
      out.push({
        passageId, type: 3, direction: "span",
        contextStart: sents[Math.max(0, hostIdx - 2)].start, contextEnd: host.end,
        stimulusStart: start, stimulusEnd: start + m[0].length, stimulusText: m[0],
        targetForm: null,
        // 기본 후보는 **직전 한 문장**이다. 나열이 두 문장에 걸치면 검수에서 넓힌다.
        answerStart: prev.start, answerEnd: prev.end,
        avoidWords: null, gold: null, origin: "regex",
        notes: confident ? null : "정관사 캡슐 — 되받기가 아닐 수 있다. 우선 검수 대상",
      })
      t3++
    }
  }

  return out
}
