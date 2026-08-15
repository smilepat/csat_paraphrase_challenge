import { describe, expect, it } from "vitest"
import { hasHangul, sentences, splitSummaryBlock, usableSentence } from "../segment"
import { minePassage } from "../mine"

// 실제 지문에서 가져온 조각들. 합성 문장으로 시험하면 원천 데이터의 함정
// (본문에 섞인 한글, 사제 영역 구분자, 동사로 쓰인 껍데기 이름)을 못 잡는다.
const FREQ: Record<string, number> = {
  the: 1, and: 2, of: 5, that: 8, is: 10, are: 12, they: 40, can: 60, their: 80,
  time: 250, make: 260,
}

const P2025_40 = [
  "People often assume that synthetic food ingredients are",
  "more harmful than natural ones, but this is not always the",
  "case. Typically, synthetic ingredients can be made in a",
  "precisely controlled fashion and have well-defined",
  "compositions and properties, allowing careful evaluation of",
  "their potential toxicity. On the other hand, natural ingredients",
  "often vary appreciably in their composition and properties",
  "depending on their origin, the time of year they were",
  "harvested, the climate they experienced throughout their",
  "lifetime, the soil quality, and how they were isolated and",
  "stored. These variations can make testing their safety",
  "extremely difficult.",
  // 실제 코퍼스의 구분자는 U+F003B — BMP 사제 영역이 아니라 Plane 15 다.
  "\u{F003B}",
  "The (A) of the production process for synthetic",
  "food ingredients and the variability of natural food ingredients",
  "may (B) people's commonly held assumption that",
  "the natural ingredients are more secure.",
].join("\n")

describe("segment", () => {
  it("문장 오프셋이 본문과 정확히 일치한다", () => {
    for (const s of sentences(P2025_40)) {
      expect(P2025_40.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it("Plane 15 사제 영역 구분자로 요약문 블록을 가른다", () => {
    const { passageEnd, summary } = splitSummaryBlock(P2025_40)
    expect(summary).toContain("the variability of natural food ingredients")
    expect(P2025_40.slice(0, passageEnd)).toContain("These variations")
    expect(P2025_40.slice(0, passageEnd)).not.toContain("(A)")
  })

  it("본문에 섞인 한글 발문은 자극이 될 수 없다", () => {
    expect(hasHangul("밑줄 친 hunting the shadow가 의미하는")).toBe(true)
    expect(usableSentence("밑줄 친 hunting the shadow, not the substance가 다음 글에서 의미하는 바로 가장 적절한 것은? [3점]")).toBe(false)
  })
})

describe("minePassage", () => {
  const drafts = minePassage("T", P2025_40, FREQ)

  it("세 유형을 모두 뽑는다", () => {
    for (const t of [1, 2, 3]) {
      expect(drafts.some((d) => d.type === t), `유형 ${t} 누락`).toBe(true)
    }
  })

  it("모든 자극의 오프셋이 본문과 일치한다", () => {
    for (const d of drafts) {
      expect(P2025_40.slice(d.stimulusStart, d.stimulusEnd)).toBe(d.stimulusText)
    }
  })

  it("자극은 항상 문맥 안에 있다", () => {
    for (const d of drafts) {
      expect(d.stimulusStart).toBeGreaterThanOrEqual(d.contextStart)
      expect(d.stimulusEnd).toBeLessThanOrEqual(d.contextEnd)
    }
  })

  it("유형3 은 These variations 를 잡고, 받는 범위는 자극보다 앞이다", () => {
    const t3 = drafts.filter((d) => d.type === 3)
    expect(t3.some((d) => d.stimulusText.includes("These variations"))).toBe(true)
    for (const d of t3) {
      expect(d.answerStart).not.toBeNull()
      expect(d.answerEnd!).toBeLessThanOrEqual(d.stimulusStart)
    }
  })

  it("유형3 은 조동사 뒤의 동사를 이름으로 오인하지 않는다", () => {
    // "This may result in ..." 의 result 는 명사가 아니라 동사다
    const d = minePassage("V", "Some cause exists here already. This may result in harm to many people who read.", FREQ)
    expect(d.filter((x) => x.type === 3)).toHaveLength(0)
  })

  it("요약문 블록은 유형1·3 의 자극이 되지 않는다", () => {
    const { passageEnd } = splitSummaryBlock(P2025_40)
    for (const d of drafts.filter((x) => x.type === 1 || x.type === 3)) {
      expect(d.stimulusStart).toBeLessThan(passageEnd)
    }
  })

  // 위 검사는 P2025_40 의 요약문 블록에 애초에 후보가 될 재료가 없어 통과한다 —
  // 가드를 지워도 죽지 않는 공허한 검사였다(변이 검사로 확인). 그래서 요약문 쪽에
  // **일부러 후보가 될 문장을 넣은** 픽스처를 따로 둔다.
  it("요약문 블록 안에 후보 재료가 있어도 유형1·3 은 거기서 뽑지 않는다", () => {
    // 픽스처 설계 의도(둘 다 지켜야 이 검사가 공허해지지 않는다):
    //  ① 요약문 블록의 **첫** 문장이 되받는 이름을 갖는다 → 그 앞 문장이 지문 안에 있어
    //     "앞 문장도 지문 안이어야 한다"는 별개 가드가 아니라 요약문 가드만 작동한다.
    //  ② 요약문 문장이 지문 문장보다 내용어가 많다 → 유형1 상한 정렬에서 반드시 앞선다.
    const withBait = [
      "Scientists gathered material about migration across nearby regions.",
      "These findings reshaped older accounts about settlement quite thoroughly.",
      "\u{F003B}",
      "These factors explain accelerating dispersal, unprecedented demographic expansion,",
      "widespread environmental disturbance, and remarkable technological innovation everywhere.",
    ].join("\n")
    const { passageEnd } = splitSummaryBlock(withBait)
    const d = minePassage("B", withBait, FREQ)

    // 미끼가 살아 있음을 증명한다 — 요약문 부분만 따로 지문으로 넣으면 후보가 나와야 한다.
    // (한 번 "These pressures" 로 썼다가 pressure 가 껍데기 이름 목록에 없어
    //  미끼가 무력했고, 그 탓에 이 검사가 통과만 하고 있었다.)
    // 구분자를 빼고 요약문 본문만 가져온다 — 마커째 잘라 붙이면 그 사본에서도
    // 요약문 블록으로 인식돼 검사가 스스로를 무력화한다.
    const baitAlone = "Something earlier established the general background here already.\n" +
      splitSummaryBlock(withBait).summary
    expect(
      minePassage("X", baitAlone, FREQ).some((x) => x.type === 3),
      "미끼가 후보를 만들지 못한다 — 이 검사는 공허하다",
    ).toBe(true)
    expect(d.some((x) => x.type === 3 && x.stimulusText.includes("These findings"))).toBe(true)

    for (const x of d.filter((t) => t.type === 1 || t.type === 3)) {
      expect(x.stimulusStart, `${x.type}: "${x.stimulusText}"`).toBeLessThan(passageEnd)
    }
  })

  it("40번 요약문은 골드 스텁으로 남는다 — 빈칸이 곧 정답이라 자동 추출이 안 된다", () => {
    const gold = drafts.filter((d) => d.origin === "gold")
    expect(gold.length).toBeGreaterThan(0)
    expect(gold.some((d) => d.gold?.[0]?.text.includes("(A)"))).toBe(true)
    expect(gold.every((d) => d.notes?.includes("검수"))).toBe(true)
  })

  it("유형1 은 흔한 낱말을 회피 대상으로 삼지 않는다", () => {
    for (const d of drafts.filter((x) => x.type === 1)) {
      expect(d.avoidWords!.length).toBeGreaterThanOrEqual(4)
      expect(d.avoidWords).not.toContain("the")
      expect(d.avoidWords).not.toContain("their")
    }
  })

  it("유형2 는 목표 구조가 항상 정해져 있다", () => {
    for (const d of drafts.filter((x) => x.type === 2)) {
      expect(["noun_phrase", "clause"]).toContain(d.targetForm)
      expect(["fold", "unfold"]).toContain(d.direction)
    }
  })
})
