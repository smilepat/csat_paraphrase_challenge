// ============================================================
// 유형 2 채점의 1단계 — **구조 검사**. LLM 을 부르지 않는다.
//
// 유형 2 는 "문장을 이름으로 접기(fold)" 와 "이름을 문장으로 펴기(unfold)" 다.
// 목표가 명사구인데 정형동사가 있으면 접지 못한 것이고, 목표가 절인데 정형동사가
// 없으면 편 것이 아니다. 이 판정은 표층에서 되므로 **공짜로 걸러진다.**
// 의미 보존(유료 verdict)은 이 관문을 통과한 답안에만 쓴다.
//
// 정형동사 판별에 품사 태거를 쓰지 않는다. 대신
//   ① 조동사·계사처럼 **언제나 정형인 낱말**을 목록으로 잡고
//   ② 흔한 어휘동사의 굴절형(-s/-ed)을 목록에서 만들어 잡는다.
// 정확도는 추측이 아니라 코퍼스로 잰다 — `npm run typed:measure` 참고.
// 라벨이 공짜로 나오기 때문이다: 채굴된 `the X of Y` 자극은 정의상 명사구이고,
// 지문 문장은 정의상 절이다.
// ============================================================

/** 언제나 정형인 낱말. 이것이 있으면 절이다. */
const FINITE_MARKERS = new Set([
  "am", "is", "are", "was", "were",
  "has", "have", "had",
  "do", "does", "did",
  "can", "could", "may", "might", "will", "would", "shall", "should", "must",
  "cannot", "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't",
  "doesn't", "don't", "didn't", "can't", "won't", "wouldn't", "shouldn't", "couldn't",
  "'re", "'ve", "'ll", "'d", "'m",
  // "'s" 는 여기 없다 — 소유격과 구별이 안 되기 때문이다(아래 COPULA_S 참고)
])

/**
 * "have/do" 는 to-부정사 뒤에서는 정형이 아니다("to have", "to do").
 * 짧은 답안에서 자주 나오므로 앞 낱말을 본다.
 */
const NONFINITE_BEFORE = new Set(["to", "not"])

/**
 * 흔한 어휘동사의 원형. 여기서 -s / -es / -ed 형을 만들어 쓴다.
 * 명사와 겹치는 낱말(work, use, change ...)은 오탐을 내므로 일부러 뺐다 —
 * 재현율보다 정확도를 택한 자리이고, 그 대가는 measure 로 드러난다.
 */
const VERB_BASES = `
allow appear apply argue arise become begin believe belong bring build carry cause
claim come consider consist contain continue create decide define depend derive describe
determine develop differ discover emerge enable encourage ensure exist explain express
fail feel find follow gain generate give grow happen help hold identify imply improve
include increase indicate involve keep know lead learn leave lie live look lose maintain
make mean meet mention move need note notice obtain occur offer operate own perceive
perform permit persist play prefer prevent produce prove provide reach realize recall
receive recognize reduce refer reflect regard reject relate remain remember render
represent require resemble resist respond result retain reveal rise seek seem sell send
serve share show sound speak spend stand start stay stem stop strike suggest support
suppose take teach tell tend think threaten treat try turn understand vary view want
wish wonder write yield
accept account achieve act add address admit affect agree aim allocate alter amount
analyze answer apply approach arrange assume attach attempt attend attract avoid base
behave benefit build call capture care carry challenge change combine compare compete
complete concern conclude conduct confirm connect consist constrain construct consume
contribute control convert convey cover cross deal decline defend deliver demand deny
depict deserve design detect direct discuss display distinguish divide draw drive earn
eat encounter end engage enhance enjoy enter establish estimate evaluate examine exceed
exchange exclude expand expect experience explore extend face fall favor fear fill fit
focus force form gather get govern guide handle hear hide hope host ignore illustrate
imagine impose impress influence inform inspire integrate interpret introduce judge
justify lack land last lay lend limit link list listen locate manage mark match matter
measure miss mix modify monitor observe occupy open order organize participate pass pay
place point possess post practice predict prepare present preserve press promote propose
protect publish pull pursue push put raise range rank rate read reason recover reduce
regulate relax release rely remove repeat replace reply report respect rest restrict
return reward run save say scan search secure select separate set settle shape shift
shop sing sit solve sort sound spread stress stretch struggle study submit succeed
suffer suit supply survive sustain switch talk target test threaten throw touch trace
track trade train transfer transform translate travel trust update urge use vote wait
walk warn watch wear weigh welcome win wonder work worry
adapt adopt arise assert assess assign associate attribute collapse commit comprise
conceive confront consult convince cope correspond dedicate defer delay depict devote
diminish discard dismiss dominate elicit embody employ enact encode endure enforce
engender entail evoke evolve exert exhibit exploit expose foster fulfil govern imitate
implement incur induce infer inherit initiate insist install instruct intend interact
invent invest invoke isolate legislate lessen manipulate mediate merge narrow negotiate
obey oblige omit oppose overcome overlap penetrate persist pioneer precede preclude
prescribe presume prevail proceed pronounce prosper qualify react recruit redeem reform
refuse regain reinforce relieve relocate resolve restore resume retreat revise revive
satisfy scatter seize simplify specify speculate stimulate strengthen strive substitute
summarize supervise surpass surround symbolize terminate thrive tolerate transform
undergo underlie undermine underpin unify unite unveil uphold utilize validate vanish
verify violate weaken widen withdraw withstand
`.trim().split(/\s+/)

/** 불규칙 과거형. 규칙 굴절로는 안 나오는 것들만. */
const IRREGULAR_PAST = `
became began believed brought built came chose did drew fell felt found gave grew held
kept knew led left lost made meant met paid put ran said sat saw sent showed sold spoke
spent stood taught thought told took understood wrote arose bore broke chose drove ate
forgot got gave went heard let lay lost read rose sought sought spoke stole struck swore
took tore wore won
`.trim().split(/\s+/)

function inflect(base: string): string[] {
  const out = [base]
  // 3인칭 단수
  if (/(s|x|z|ch|sh|o)$/.test(base)) out.push(base + "es")
  else if (/[^aeiou]y$/.test(base)) out.push(base.slice(0, -1) + "ies")
  else out.push(base + "s")
  // 과거·과거분사(규칙)
  if (base.endsWith("e")) out.push(base + "d")
  else if (/[^aeiou]y$/.test(base)) out.push(base.slice(0, -1) + "ied")
  else out.push(base + "ed")
  return out
}

/** 원형은 정형이 아닐 수 있으므로(to explain) 굴절형만 정형 후보로 둔다. */
const INFLECTED = new Set<string>()
for (const b of VERB_BASES) for (const f of inflect(b).slice(1)) INFLECTED.add(f)
for (const p of IRREGULAR_PAST) INFLECTED.add(p)

/** 원형이 정형이 되는 자리(they explain)를 잡기 위한 복수·1·2인칭 주어. */
/** 이 낱말 뒤의 -ed 는 서술어가 아니라 수식어다. */
const MODIFIER_BEFORE =
  /ly$|^(of|the|a|an|in|on|at|for|with|by|from|its|their|his|her|our|your|my|more|most|less|least|very|ever|quite|rather|so|too|being|been|having)$/

const COPULA_S_SUBJECT = new Set(["it", "he", "she", "that", "there", "this", "what", "who", "here"])

const PLURAL_SUBJECT = new Set(["i", "we", "you", "they", "people", "who", "that", "which", "these", "those"])
const BASE_SET = new Set(VERB_BASES)

/**
 * 축약형은 **쪼개야** 한다. "it's" 를 통째로 두면 FINITE_MARKERS 의 "'s" 와
 * 안 맞아 조용히 새 나간다(실측에서 이 한 줄이 누락의 큰 몫이었다).
 */
function tokens(text: string): string[] {
  // 코퍼스의 아포스트로피는 곱슬표(U+2019)다. 곧은표로 맞춰야 축약형이 잡힌다.
  const norm = text.toLowerCase().replace(/[’ʼ՚]/g, "'")
  // ⚠ 하이픈 복합어는 **한 낱말로** 잡는다. 쪼개면 "stress-related disorders" 의
  //   related 가 굴절형 목록에 걸려 정형동사가 된다. 복합 형용사이지 서술어가 아니다.
  //   (실측: 이 한 줄이 없어서 정상 명사구가 절로 오판되고 있었다)
  return (norm.match(/[a-z]+(?:-[a-z]+)+|[a-z]+(?:'[a-z]+)?|'[a-z]+/g) ?? [])
    .flatMap((t) => {
      const m = t.match(/^([a-z]+)('(?:s|re|ve|ll|d|m|t))$/)
      if (!m) return [t]
      // "don't" 의 n't 는 부정이지 계사가 아니다 — 원형 쪽에 붙여 둔다
      if (m[2] === "'t") return [t]
      return [m[1], m[2]]
    })
    .filter(Boolean)
}

/**
 * 후치 분사(축약 관계절) 뒤에 오는 전치사들.
 *   "the assistance **provided** by …"  "outcomes **based** on …"
 * 여기 걸리면 서술어가 아니라 앞의 이름을 꾸미는 말이다. 학술 영어에서
 * 명사구를 늘리는 가장 흔한 방법이라, 잘 쓰는 학생일수록 자주 만든다.
 */
const POST_MODIFIER_NEXT = new Set([
  "by", "on", "in", "at", "for", "with", "from", "through", "under", "within",
  "as", "upon", "into", "among", "against", "across", "during", "between",
])

/** 종속절을 여는 낱말. 이 뒤의 정형동사는 **내포된** 것이라 전체 구조를 안 정한다. */
const COMPLEMENTIZER = new Set([
  "that", "which", "who", "whom", "whose", "where", "when", "while",
  "because", "although", "though", "if", "whether", "since", "unless", "until",
])

/** 과거형·과거분사 모양. 정형과 수식어 사이가 원래 모호한 자리다. */
function participleShaped(w: string | null): boolean {
  if (!w) return false
  return /ed$/.test(w) || IRREGULAR_PAST.includes(w)
}

export type FiniteHit = {
  finite: boolean
  cue: string | null
  /**
   * 그 정형동사가 종속절 안에 있는가.
   * "the claim **that** conflict **results** from animosity" 는 통째로 명사구다 —
   * results 는 that 절 안이라 바깥 구조를 정하지 못한다.
   */
  embedded?: boolean
}

/** 정형동사가 있는가. 있으면 어떤 낱말 때문인지도 돌려준다(디버깅·피드백용). */
export function findFiniteVerb(text: string): FiniteHit {
  const tk = tokens(text)
  let sawComplementizer = false
  for (let i = 0; i < tk.length; i++) {
    const w = tk[i]
    const prev = i > 0 ? tk[i - 1] : ""
    const next = i + 1 < tk.length ? tk[i + 1]! : ""
    if (COMPLEMENTIZER.has(w!)) sawComplementizer = true

    // "'s" 는 대명사 뒤에서만 계사다. 명사 뒤면 소유격이라
    // "the importance of an individual's action" 이 절로 오인된다.
    if (w === "'s") {
      if (COPULA_S_SUBJECT.has(prev)) return { finite: true, cue: "'s", embedded: sawComplementizer }
      continue
    }
    if (FINITE_MARKERS.has(w)) {
      // "to have", "to do" 는 정형이 아니다
      if (NONFINITE_BEFORE.has(prev) && (w === "have" || w === "do")) continue
      return { finite: true, cue: w, embedded: sawComplementizer }
    }
    // 굴절형은 그 자체로 정형이다. 다만 "to" 뒤는 아니다.
    if (INFLECTED.has(w) && !NONFINITE_BEFORE.has(prev)) {
      // 과거분사가 명사를 꾸미는 자리는 정형이 아니다.
      //   "a precisely controlled fashion" · "the previously gained knowledge"
      // 한정사를 **앞 두 칸 안에서만** 본다. 더 멀리 보면
      // "The arrival of the Industrial Age changed ..." 의 changed 까지 수식어로 삼킨다.
      // 판정 기준은 한정사와의 거리가 아니라 **바로 앞 낱말의 종류**다.
      //   "remotely sensed imagery" · "of dedicated bike lanes" · "a precisely controlled fashion"
      // 부사(-ly)나 전치사·한정사 뒤에 오고 뒤에 낱말이 더 있으면 수식어로 본다.
      // 거리로 재면 "The arrival of the Industrial Age **changed** ..." 까지 삼킨다.
      if (MODIFIER_BEFORE.test(prev) && i + 1 < tk.length) continue
      // **후치** 분사도 수식어다 — 여기까지 오는 것이 앞의 MODIFIER_BEFORE 로는 안 잡힌다.
      //   "the assistance provided by group communication"
      //   "the assessment of outcomes based on personal management"
      // 전치사가 뒤따르는 -ed 형이고 앞이 주어가 될 대명사가 아니면 축약 관계절로 본다.
      if (participleShaped(w!) && POST_MODIFIER_NEXT.has(next) && !PLURAL_SUBJECT.has(prev)) continue
      return { finite: true, cue: w, embedded: sawComplementizer }
    }
    // 복수·1·2인칭 주어 뒤의 원형은 정형이다(they vary, people believe)
    if (BASE_SET.has(w) && PLURAL_SUBJECT.has(prev)) {
      return { finite: true, cue: w, embedded: sawComplementizer }
    }
  }
  return { finite: false, cue: null }
}

export function hasFiniteVerb(text: string): boolean {
  return findFiniteVerb(text).finite
}

export type StructureVerdict = "pass" | "fail" | "unclear"

export type StructureResult = {
  verdict: StructureVerdict
  /** 학생에게 그대로 보여줄 한 줄. 교사가 없으므로 이 문구가 유일한 지도다. */
  message: string
  cue: string | null
}

const DETERMINER = /^(a|an|the|this|that|these|those|its|their|his|her|our|your|my|such)$/

/**
 * 누가 봐도 맨 명사구인가. 한정사로 시작하고 동사 비슷한 것이 하나도 없을 때만 참.
 * 절 목표에서 **확신을 갖고 떨어뜨릴** 때만 쓴다.
 */
function looksBareNounPhrase(text: string): boolean {
  const tk = (text.toLowerCase().match(/[a-z']+/g) ?? [])
  if (tk.length === 0 || tk.length > 14) return false
  return DETERMINER.test(tk[0] ?? "")
}

/**
 * 목표 구조를 달성했는가. 유형 2 채점의 1관문.
 *
 * 세 갈래인 이유: 정형동사 판별은 **명사구 쪽이 100%, 절 쪽이 95.7%** 다
 * (`npm run typed:measure`). 절을 놓치는 4.3% 를 그대로 실패 처리하면
 * 제대로 편 학생에게 "아직 이름입니다"라고 말하게 된다. 교사가 없는 자습에서
 * 그 오류는 회복이 안 되므로, **확신이 있을 때만 떨어뜨리고 아니면 미룬다.**
 * 미룬 것만 유료 판정으로 넘어가므로 비용 절감도 그대로 유지된다.
 */
export function checkStructure(
  answer: string,
  target: "noun_phrase" | "clause",
): StructureResult {
  const text = answer.trim()
  if (!text) return { verdict: "fail", message: "답을 아직 쓰지 않았습니다.", cue: null }

  const { finite, cue, embedded } = findFiniteVerb(text)

  if (target === "clause") {
    if (finite) return { verdict: "pass", message: "문장으로 폈습니다.", cue }
    if (looksBareNounPhrase(text)) {
      return {
        verdict: "fail",
        cue: null,
        message: "아직 이름(명사구)입니다. 주어와 동사를 세워 문장으로 펴 보세요.",
      }
    }
    return { verdict: "unclear", message: "구조를 확인하는 중입니다.", cue: null }
  }

  // target === "noun_phrase"
  // 동사를 못 찾았다고 곧바로 통과시키면 안 된다 — 절 판별이 95.7% 라
  // 목록에 없는 동사를 쓴 문장이 "접었다"로 통과해 버린다.
  // 맨 명사구로 보일 때만 확정하고, 아니면 유료 판정에 미룬다.
  if (!finite) {
    if (looksBareNounPhrase(text)) {
      return { verdict: "pass", message: "이름으로 접었습니다.", cue }
    }
    return { verdict: "unclear", message: "구조를 확인하는 중입니다.", cue: null }
  }
  // ⚠ **확신이 있을 때만 떨어뜨린다.** -ed 형은 정형과 분사 수식어 사이가 원래
  //    모호하고("the horse raced past the barn"), 종속절 안의 동사는 바깥 구조를
  //    정하지 못한다. 이 둘을 fail 로 처리하면 **제대로 접은 학생이 0점**을 받는다.
  //    실측: 앱 자신의 예시 답 124건 중 21건(17%)이 이 자리에서 떨어지고 있었고,
  //    그 21건은 전부 멀쩡한 명사구였다. 캘리브레이션 세트의 명사구가 전부
  //    짧은 `the X of Y` 라서 이 결함이 드러날 수가 없었다.
  if (participleShaped(cue) || embedded) {
    return { verdict: "unclear", message: "구조를 확인하는 중입니다.", cue }
  }
  return {
    verdict: "fail",
    cue,
    message: `아직 문장입니다 — "${cue}" 가 남아 있습니다. 동사를 지우고 이름 하나로 접어 보세요.`,
  }
}

/**
 * 동사처럼 보이는 첫 낱말. **정형인지는 따지지 않는다.**
 *
 * 채점에는 못 쓴다(정형 판별이 핵심이므로). 힌트에는 이게 맞다 —
 * "often vary" 의 vary 는 정형 판별에서 빠지지만, 학생에게 짚어 줘야 할 동사는 그것이다.
 * 채점 기준을 힌트에 그대로 쓰면 정작 필요한 순간에 침묵한다.
 */
export function firstVerbLike(text: string): string | null {
  const tk = tokens(text)
  for (let i = 0; i < tk.length; i++) {
    const w = tk[i]!
    if (FINITE_MARKERS.has(w) || w === "'s") continue // 조동사·계사는 짚어 줄 대상이 아니다
    if (INFLECTED.has(w) || BASE_SET.has(w)) {
      const prev = i > 0 ? tk[i - 1]! : ""
      if (MODIFIER_BEFORE.test(prev) && i + 1 < tk.length) continue // 수식어 자리
      return w
    }
  }
  return null
}
