import { describe, expect, it } from "vitest"
import { fillScaffold, scaffoldFor } from "../scaffold"

describe("scaffoldFor — 백지 대신 빈칸", () => {
  it("유형 1 은 대상 단어만 빈칸으로 뚫는다", () => {
    const s = scaffoldFor(
      1, null,
      "natural ingredients often vary appreciably in their composition",
      ["ingredients", "vary", "composition"],
    )!
    // 문장은 그대로 남고 대상 단어 자리만 빈칸이 된다
    expect(s.frame).toContain("often")
    expect(s.frame).toContain("{0}")
    expect(s.slots).toHaveLength(3)
    expect(s.slots[0].hint).toContain("ingredients")
  })

  it("유형 1 은 굴절형도 빈칸으로 잡는다", () => {
    const s = scaffoldFor(1, null, "the system varies across regions", ["vary"])!
    // "vary" 를 찾을 때 "varies" 도 잡아야 한다 — 아니면 빈칸이 안 생긴다
    expect(s.frame).toContain("{0}")
    expect(s.frame).not.toContain("varies")
  })

  it("묶기는 the (   ) of (   ) 틀을 준다", () => {
    const s = scaffoldFor(2, "fold", "natural ingredients often vary in their composition", [])!
    expect(s.frame).toBe("the {0} of {1}")
    expect(s.slots[0].hint).toContain("vary")   // 명사로 바꿀 동사를 짚어 준다
    expect(s.slots[0].hint).not.toContain("variability") // 답을 주지는 않는다
  })

  it("풀기는 주어와 서술어 칸을 준다", () => {
    const s = scaffoldFor(2, "unfold", "the controllability of the production process", [])!
    expect(s.frame).toBe("{0} {1}")
    expect(s.slots[0].hint).toContain("the production process") // 주어 재료
    expect(s.slots[1].hint).toContain("controllability")        // 풀어야 할 머리 단어
  })

  it("범위를 끄는 과제에는 채울 칸이 없다", () => {
    expect(scaffoldFor(3, "span", "These variations", [])).toBeNull()
  })

  it("대상 단어가 없으면 유형 1 틀을 만들지 않는다", () => {
    expect(scaffoldFor(1, null, "some sentence here", [])).toBeNull()
  })
})

describe("fillScaffold", () => {
  it("칸을 채워 답안을 만든다", () => {
    expect(fillScaffold("the {0} of {1}", ["variability", "natural ingredients"]))
      .toBe("the variability of natural ingredients")
  })

  it("빈 칸은 지워지고 공백이 정리된다", () => {
    expect(fillScaffold("{0} {1}", ["the process", ""])).toBe("the process")
  })

  it("유형 1 처럼 문장 안에 칸이 있어도 합쳐진다", () => {
    expect(fillScaffold("natural {0} often {1}", ["materials", "differ"]))
      .toBe("natural materials often differ")
  })
})

describe("주어 예시는 깨끗해야 한다 — 틀린 예시는 없는 것만 못하다", () => {
  it("앞의 전치사구를 떼어 낸다", () => {
    const s = scaffoldFor(2, "fold", "During deep sleep the brain replays what it learned.", [])!
    expect(s.slots[1].hint).toContain("the brain")
    expect(s.slots[1].hint).not.toContain("During")
  })

  it("주어에 동사가 딸려오지 않는다", () => {
    const s = scaffoldFor(2, "fold", "During deep sleep the brain replays what it learned.", [])!
    expect(s.slots[1].hint).not.toContain("replays")
  })

  it("뒤의 부사를 떼어 낸다", () => {
    const s = scaffoldFor(2, "fold", "natural ingredients often vary in their composition.", [])!
    expect(s.slots[1].hint).toContain("natural ingredients")
    expect(s.slots[1].hint).not.toContain("often")
  })
})
