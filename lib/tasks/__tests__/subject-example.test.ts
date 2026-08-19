// ============================================================
// 묶기 빈칸의 "무엇에 대한 내용인지 (예: …)" 에 들어가는 주어.
//
// 이 칸은 학생에게 **예시**로 나간다. 틀린 예시는 없는 것만 못하므로,
// 확신이 없으면 null 을 돌려 예시 없이 안내만 하게 한다(§49).
// ============================================================

import { describe, it, expect } from "vitest"
import { subjectExample } from "../scaffold"

describe("subjectExample", () => {
  it("평범한 주어는 그대로 보여 준다", () => {
    expect(subjectExample("The class improves slowly.")).toBe("The class")
    expect(subjectExample("Steady practice beats cramming.")).toBe("Steady practice")
  })

  it("지문의 줄바꿈이 예시에 딸려 나오지 않는다", () => {
    // 승인된 묶기 문항 5건이 이 상태였다 — "Social↵and" 가 그대로 화면에 나갔다
    expect(subjectExample("Presentational\nstyles vary by culture.")).not.toContain("\n")
  })

  it("전치사·접속사로 시작하면 예시를 주지 않는다 — 그건 주어가 아니다", () => {
    for (const s of [
      "Without them the system stops.",
      "If this happens, the class slows down.",
      "In contrast, the second group waited a week.",
    ]) {
      expect(subjectExample(s)).toBeNull()
    }
  })

  it("주어 뒤 조동사·계사는 딸려 나오지 않는다", () => {
    // "동사를 명사로 바꾸라"고 하면서 동사를 주어 자리에 앉히면 학생이 헷갈린다
    expect(subjectExample("The teacher is careful with new words.")).toBe("The teacher")
    expect(subjectExample("The class improves slowly.")).toBe("The class")
  })

  it("주어 뒤에 동사가 딸려 오면 예시를 주지 않는다", () => {
    // "People vary" 를 주어 예시로 보여 주면 같은 화면이 vary 를 주어라고 가르치는 셈이다
    expect(subjectExample("People vary in how fast they read.")).toBeNull()
  })

  it("한정사 없이 명사·동사를 가릴 수 없으면 예시를 지어내지 않는다", () => {
    // "studies" · "changes" 는 명사도 동사도 된다. 잘못 자르면 "Some" 만 남는데,
    // 그런 예시는 없는 것만 못하다. 대신 칸 안내만 나간다.
    expect(subjectExample("Some studies show a clear pattern.")).toBeNull()
    expect(subjectExample("Small changes add up over a term.")).toBeNull()
  })

  it("한정사가 있으면 안심하고 자른다 — 그 뒤 한 낱말이 머리 명사다", () => {
    expect(subjectExample("The changes add up over a term.")).toBe("The changes")
  })
})
