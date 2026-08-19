import { describe, expect, it } from "vitest"
import { hintSteps } from "../hint"

/** 전략 칸(예전의 그 힌트)만 꺼내 본다. 재료 없이도 항상 나와야 하는 칸이다. */
function strategy(type: number, dir: string | null, stim: string, avoid: string[] = []) {
  const s = hintSteps(type, dir, stim, avoid, null)
  expect(s, "재료가 없어도 전략 칸은 있어야 한다").toHaveLength(1)
  return s[0]!.body
}

describe("전략 칸 — 답이 아니라 시작점만 준다", () => {
  it("접기: 핵심 동사를 짚어 준다", () => {
    const b = strategy(2, "fold", "natural ingredients often vary appreciably in their composition and properties")
    expect(b).toContain("vary")
    // 정답(variability)을 그대로 주면 힌트가 아니라 답이다
    expect(b).not.toContain("variability")
  })

  it("접기: 무엇에 대한 것인지도 알려 준다", () => {
    expect(strategy(2, "fold", "the production process can be controlled precisely")).toContain("of")
  })

  it("펴기: 머리 낱말을 짚어 준다", () => {
    expect(strategy(2, "unfold", "the controllability of the production process")).toContain("controllability")
  })

  it("펴기: of 가 없는 이름도 머리 낱말을 찾는다", () => {
    expect(strategy(2, "unfold", "the previously gained knowledge")).toContain("knowledge")
  })

  it("유형 1: 전부가 아니라 낱말 하나만 집어 준다", () => {
    const b = strategy(1, null, "natural ingredients vary", ["natural", "ingredients", "vary"])
    expect(b).toContain("natural")
    // 금지어를 통째로 나열하면 힌트가 아니라 목록이다
    expect(b).not.toContain("ingredients")
  })

  it("유형 3: 어디서부터 볼지 알려 준다", () => {
    expect(strategy(3, "span", "These variations")).toContain("앞 문장")
  })

  it("동사를 못 찾아도 빈손으로 돌려보내지 않는다", () => {
    expect(strategy(2, "fold", "the quiet room").length).toBeGreaterThan(10)
  })
})

describe("힌트 사다리", () => {
  const material = {
    gloss: "천연 재료는 성분이 크게 달라진다",
    form: "vary → variability",
    example: "the variability of natural ingredients",
  }
  const stim = "natural ingredients often vary appreciably in their composition"

  it("뜻 → 전략 → 어형 → 예시 순서로 열린다", () => {
    const s = hintSteps(2, "fold", stim, [], material)
    expect(s.map((x) => x.label)).toEqual([
      "우리말 뜻",
      "푸는 방법",
      "품사 바꾸기",
      "예시 답안",
    ])
    expect(s.map((x) => x.level)).toEqual([1, 2, 3, 4])
  })

  it("첫 칸은 한국어 뜻만 준다 — 영어를 주면 그건 답이다", () => {
    const first = hintSteps(2, "fold", stim, [], material)[0]!
    expect(first.body).toContain("천연 재료")
    expect(first.body).not.toContain("variability")
  })

  it("정답은 마지막 칸에서만 나온다", () => {
    const s = hintSteps(2, "fold", stim, [], material)
    // 앞 세 칸 어디에도 예시 답이 새면 사다리가 무너진다
    for (const step of s.slice(0, 3)) {
      expect(step.body, `"${step.label}" 칸에 답이 샜다`).not.toContain(
        "the variability of natural ingredients",
      )
    }
    expect(s[3]!.body).toContain("the variability of natural ingredients")
  })

  it("재료가 없는 칸은 아예 만들지 않는다 — 빈 칸은 고장으로 보인다", () => {
    const s = hintSteps(2, "fold", stim, [], { gloss: "성분이 달라진다" })
    expect(s.map((x) => x.label)).toEqual(["우리말 뜻", "푸는 방법"])
    // level 은 배열 위치다. 재료가 빠져도 1,2 로 이어져야 한다
    expect(s.map((x) => x.level)).toEqual([1, 2])
  })

  it("유형 1 은 어형 대신 첫 글자 모양을 준다", () => {
    const s = hintSteps(1, null, "accomplished professionals", ["accomplished"], {
      gloss: "능숙한 전문가들",
      shape: "s______ e______  (2낱말)",
      example: "skilled experts",
    })
    expect(s.map((x) => x.label)).toEqual([
      "우리말 뜻",
      "푸는 방법",
      "답의 형태",
      "예시 답안",
    ])
    // 모양 칸은 첫 글자만 준다 — 낱말이 통째로 보이면 예시 칸과 다를 게 없다
    expect(s[2]!.body).not.toContain("skilled experts")
  })

  // ⚠ 자가진단에서 나왔다. 2칸(전략)은 firstVerbLike 가, 3칸(어형)은 LLM 이
  //    **각자 따로** 낱말을 골라서 45% 가 서로 다른 것을 가리켰다 —
  //    2칸 "핵심 동사는 fall", 3칸 "change → alteration".
  //    막혀서 도움을 청한 학생에게 모순된 지시를 주고 있었다.
  it("2칸과 3칸은 같은 낱말을 가리킨다", () => {
    // 문장의 첫 동사(fall)와 재료의 동사(change)가 다른, 실제로 어긋났던 사례
    const s = hintSteps(
      2, "fold",
      "Surprises can fall from the sky like volcanic ash and appear to change everything.",
      [],
      { gloss: "모든 것을 바꾸는 것처럼 보이는 것", form: "change → alteration", example: "the apparent alteration of everything" },
    )
    const strategy = s.find((x) => x.label === "푸는 방법")!.body
    expect(strategy).toContain("change")
    expect(strategy, "문장에서 먼저 보이는 동사를 짚으면 3칸과 어긋난다").not.toContain("fall")
  })

  it("펴기도 같은 정본을 쓴다", () => {
    const s = hintSteps(2, "unfold", "the centrality of this mode of thinking", [], {
      gloss: "이 사고방식이 얼마나 중요한지",
      form: "centrality → central",
      example: "this way of thought is central",
    })
    expect(s.find((x) => x.label === "푸는 방법")!.body).toContain("centrality")
  })

  it("재료가 없으면 예전처럼 문장에서 찾는다 — 침묵하지 않는다", () => {
    const s = hintSteps(2, "fold", "natural ingredients often vary in their composition", [], {
      gloss: "성분이 크게 달라진다",
    })
    expect(s.find((x) => x.label === "푸는 방법")!.body).toContain("vary")
  })

  it("유형 3 은 산출이 없으므로 예시 칸도 없다", () => {
    const s = hintSteps(3, "span", "These variations", [], { gloss: "앞의 여러 차이" })
    expect(s.map((x) => x.label)).toEqual(["우리말 뜻", "푸는 방법"])
  })
})
