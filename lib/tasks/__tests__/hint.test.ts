import { describe, expect, it } from "vitest"
import { hintFor } from "../hint"

describe("hintFor — 답이 아니라 시작점만 준다", () => {
  it("접기: 핵심 동사를 짚어 준다", () => {
    const h = hintFor(
      2, "fold",
      "natural ingredients often vary appreciably in their composition and properties",
      [],
    )!
    expect(h.body).toContain("vary")
    // 정답(variability)을 그대로 주면 힌트가 아니라 답이다
    expect(h.body).not.toContain("variability")
  })

  it("접기: 무엇에 대한 것인지도 알려 준다", () => {
    const h = hintFor(2, "fold", "the production process can be controlled precisely", [])!
    expect(h.body).toContain("of")
  })

  it("펴기: 머리 낱말을 짚어 준다", () => {
    const h = hintFor(2, "unfold", "the controllability of the production process", [])!
    expect(h.body).toContain("controllability")
  })

  it("펴기: of 가 없는 이름도 머리 낱말을 찾는다", () => {
    const h = hintFor(2, "unfold", "the previously gained knowledge", [])!
    expect(h.body).toContain("knowledge")
  })

  it("유형 1: 전부가 아니라 낱말 하나만 집어 준다", () => {
    const h = hintFor(1, null, "natural ingredients vary", ["natural", "ingredients", "vary"])!
    expect(h.body).toContain("natural")
    // 금지어를 통째로 나열하면 힌트가 아니라 목록이다
    expect(h.body).not.toContain("ingredients")
  })

  it("유형 3: 어디서부터 볼지 알려 준다", () => {
    const h = hintFor(3, "span", "These variations", [])!
    expect(h.body).toContain("앞 문장")
  })

  it("동사를 못 찾아도 빈손으로 돌려보내지 않는다", () => {
    const h = hintFor(2, "fold", "the quiet room", [])!
    expect(h.body.length).toBeGreaterThan(10)
  })
})
