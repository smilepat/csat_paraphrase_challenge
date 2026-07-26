import { describe, expect, it } from "vitest"
import freqJson from "../../../data/freq-rank.json"
import { scoreBrevity } from "../brevity"
import { lookupRank, scoreEase } from "../ease"
import {
  checkDuplicateOfModel, checkVerbatim, longestCommonRun, needsTeacherReview, surfaceOverlap,
} from "../guards"
import { cosine, ramp, scoreMeaning } from "../meaning"
import { lemmaCandidates, sentences, tokens, wordCount } from "../text"
import { scoreSubmission } from "../index"

const freq = freqJson as Record<string, number>

// 임베딩을 흉내내는 2차원 단위벡터. 각도로 유사도를 직접 통제한다.
const vec = (deg: number) => {
  const r = (deg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}

describe("text", () => {
  it("단어 수는 화면 카운터와 같은 공백 기준", () => {
    expect(wordCount("  one   two three ")).toBe(3)
    expect(wordCount("")).toBe(0)
    expect(wordCount("   ")).toBe(0)
  })

  it("문장 분리는 종결부호 기준", () => {
    expect(sentences("A cat sat. It slept! Did it?")).toHaveLength(3)
    expect(sentences("no terminator")).toHaveLength(1)
  })

  it("축약형의 어포스트로피를 살린다", () => {
    expect(tokens("don't stop, it's fine")).toEqual(["don't", "stop", "it's", "fine"])
  })

  it("굴절형에서 표제어 후보를 만든다", () => {
    expect(lemmaCandidates("studies")).toContain("study")
    expect(lemmaCandidates("stopped")).toContain("stop")
    expect(lemmaCandidates("making")).toContain("make")
    expect(lemmaCandidates("easiest")).toContain("easy")
  })
})

describe("brevity", () => {
  it("목표 이내면 만점", () => {
    expect(scoreBrevity(25, 25).score).toBe(25)
    expect(scoreBrevity(10, 25).score).toBe(25)
  })

  it("초과 1단어당 2점 감점, 0점에서 멈춘다", () => {
    expect(scoreBrevity(30, 25).score).toBe(15)
    expect(scoreBrevity(100, 25).score).toBe(0)
  })

  it("보너스는 25점 상한을 넘기지 않고 별도로 나온다", () => {
    const r = scoreBrevity(15, 25)
    expect(r.score).toBe(25) // 상한 유지 — standalone.html 의 30점 오버플로 버그 회귀 방지
    expect(r.bonus).toBe(5)
  })

  it("너무 짧으면 보너스를 주지 않는다", () => {
    expect(scoreBrevity(3, 25).bonus).toBe(0)
  })
})

describe("ease", () => {
  it("빈도 순위를 굴절형에서도 찾는다", () => {
    expect(lookupRank("people", freq)).toBe(freq.people)
    expect(lookupRank("studies", freq)).toBe(freq.study)
    expect(lookupRank("qwertyzzz", freq)).toBeNull()
  })

  it("쉬운 문장이 어려운 문장보다 높다", () => {
    const easy = scoreEase("People learn better when they make mistakes.", freq)
    const hard = scoreEase(
      "Pedagogical scaffolding attenuates metacognitive disequilibrium among adolescent cohorts.",
      freq,
    )
    expect(easy.score).toBeGreaterThan(hard.score)
  })

  it("빈도표 밖 단어를 고난도로 잡아 피드백에 노출한다", () => {
    const r = scoreEase("Students demonstrate zzzqqqx behaviour.", freq)
    expect(r.detail.hardWords).toContain("zzzqqqx")
  })

  it("기능어만 있으면 0점", () => {
    expect(scoreEase("the a of and to", freq).score).toBe(0)
  })

  it("빈 문자열도 죽지 않는다", () => {
    expect(scoreEase("", freq).score).toBe(0)
  })
})

describe("guards", () => {
  const passage =
    "Learning quickly often looks impressive, but speed can hide an important weakness " +
    "when a guide tells travelers every turn they may reach their destination faster."

  it("최장 공통 연속 구간을 찾는다", () => {
    const r = longestCommonRun(passage, "speed can hide an important weakness")
    expect(r.length).toBe(6)
    expect(r.text).toBe("speed can hide an important weakness")
  })

  it("12단어 이상 옮겨 적으면 verbatim 플래그", () => {
    const copied = "Learning quickly often looks impressive but speed can hide an important weakness"
    const flag = checkVerbatim(passage, copied)
    expect(flag?.kind).toBe("verbatim")
    expect(needsTeacherReview([flag!])).toBe(true)
  })

  it("자기 말로 바꿔 쓴 답안은 플래그가 없다", () => {
    expect(checkVerbatim(passage, "Fast help feels good but it hides a real problem.")).toBeNull()
  })

  it("빈 입력에서 죽지 않는다", () => {
    expect(longestCommonRun("", "abc")).toEqual({ length: 0, text: "" })
  })

  it("모범답안을 그대로 옮기면 duplicate", () => {
    const model = "Fast guidance improves results, but struggle helps students think independently."
    expect(checkDuplicateOfModel(model, [model])?.kind).toBe("duplicate")
  })

  it("같은 뜻을 다른 말로 쓰면 duplicate 가 아니다 — 이 게임이 장려하는 행동", () => {
    const model = "Fast guidance improves results, but struggle helps students think independently."
    const own = "Quick help works at first, yet difficulty teaches learners to solve problems alone."
    expect(checkDuplicateOfModel(own, [model])).toBeNull()
  })

  it("내용어가 거의 같으면 순서를 바꿔도 잡는다", () => {
    const a = "Struggle and mistakes help students build independent thinking skills over time."
    const b = "Over time, mistakes and struggle build independent thinking skills in students."
    expect(surfaceOverlap(a, b)).toBeGreaterThan(0.85)
  })
})

describe("meaning", () => {
  it("cosine 은 같은 방향에서 1, 직교에서 0", () => {
    expect(cosine(vec(0), vec(0))).toBeCloseTo(1)
    expect(cosine(vec(0), vec(90))).toBeCloseTo(0)
    expect(cosine([], [1, 2])).toBe(0)
  })

  it("ramp 는 구간 밖에서 0/1 로 잘린다", () => {
    expect(ramp(0.4, 0.55, 0.78)).toBe(0)
    expect(ramp(0.9, 0.55, 0.78)).toBe(1)
    expect(ramp(0.665, 0.55, 0.78)).toBeCloseTo(0.5, 1)
  })

  it("문장별 벡터를 써서 서로 다른 명제를 각각 잡는다", () => {
    const p1 = vec(0), p2 = vec(80)
    // 전체 벡터 하나(두 명제의 중간)로는 둘 다 애매하지만, 문장별로는 각각 맞는다
    const bySentences = scoreMeaning({
      answerVectors: [vec(40), vec(2), vec(78)],
      propositionVectors: [p1, p2],
      modelVectors: [vec(40)],
    })
    const wholeOnly = scoreMeaning({
      answerVectors: [vec(40)],
      propositionVectors: [p1, p2],
      modelVectors: [vec(40)],
    })
    expect(bySentences.score).toBeGreaterThan(wholeOnly.score)
  })

  it("모순 판정된 명제는 유사도가 높아도 0점", () => {
    const p = vec(0)
    const base = scoreMeaning({ answerVectors: [vec(0)], propositionVectors: [p], modelVectors: [] })
    const contradicted = scoreMeaning({
      answerVectors: [vec(0)],
      propositionVectors: [p],
      modelVectors: [],
      contradictedIndices: [0],
    })
    expect(base.score).toBeGreaterThan(0)
    expect(contradicted.score).toBe(0)
  })

  it("명제가 없으면 0으로 떨어지고 예외를 던지지 않는다", () => {
    expect(scoreMeaning({ answerVectors: [vec(0)], propositionVectors: [], modelVectors: [] }).score)
      .toBe(0)
  })
})

describe("scoreSubmission 통합", () => {
  const passageBody =
    "Learning quickly often looks impressive, but speed can hide an important weakness. " +
    "When a guide tells travelers every turn, they may reach their destination faster and " +
    "make fewer mistakes. However, people who always depend on guidance may fail to develop " +
    "a strong sense of direction."

  const base = {
    passageBody,
    targetWords: 25,
    freq,
    propositionVectors: [vec(0), vec(60)],
    modelVectors: [vec(20)],
  }

  it("동의어로 바꿔 쓴 좋은 답안이 높은 점수를 받는다", () => {
    const r = scoreSubmission({
      ...base,
      answer: "Fast help makes people quicker, but they never learn to find their own way.",
      answerVectors: [vec(20), vec(2), vec(58)],
    })
    expect(r.meaning).toBeGreaterThan(40)
    expect(r.flags).toHaveLength(0)
    expect(r.total).toBeGreaterThan(80)
  })

  it("원문 복붙은 의미 점수가 높아도 교사 확인 대상이 된다", () => {
    const r = scoreSubmission({
      ...base,
      answer:
        "When a guide tells travelers every turn, they may reach their destination faster and make fewer mistakes.",
      answerVectors: [vec(0), vec(0)],
    })
    expect(r.flags.some((f) => f.kind === "verbatim")).toBe(true)
    expect(r.needsReview).toBe(true)
  })

  it("총점은 100을 넘지 않는다", () => {
    const r = scoreSubmission({
      ...base,
      answer: "Fast help hides a weakness and stops learners finding their own way home.",
      answerVectors: [vec(20), vec(0), vec(60)],
    })
    expect(r.total).toBeLessThanOrEqual(100)
  })

  it("빈 답안은 0점이고 empty 플래그", () => {
    const r = scoreSubmission({ ...base, answer: "", answerVectors: [] })
    expect(r.total).toBe(0)
    expect(r.flags.some((f) => f.kind === "empty")).toBe(true)
  })

  it("또래 복사를 잡는다", () => {
    const r = scoreSubmission({
      ...base,
      answer: "Fast help makes people quicker but they never learn their own way.",
      answerVectors: [vec(20)],
      peers: [
        { nickname: "민수", text: "Fast help makes people quicker but they never learn their own way." },
      ],
    })
    expect(r.flags.some((f) => f.kind === "peer-copy")).toBe(true)
  })
})
