// ============================================================
// 판정 응답을 요청에 맞추는 규칙.
//
// 예전에는 id 가 안 맞으면 **순서로** 맞췄다. 정상 응답은 id 를 그대로 돌려주므로
// 그 경로가 나르던 것은 모델이 헛나간 응답뿐이었고, 그때 남의 판정이 학생 답안에
// 붙었다. 게다가 그 판정은 캐시에 저장돼 그 답안에 영원히 남는다.
// ============================================================

import { describe, it, expect, vi } from "vitest"
import { matchById } from "../verdict1"

const coerce = (raw: unknown, id: string) => ({ id, payload: raw })
const chunk = [{ id: "task-a" }, { id: "task-b" }]

describe("matchById", () => {
  it("id 가 맞으면 맞춘다", () => {
    const out = matchById([{ id: "task-b", v: 2 }, { id: "task-a", v: 1 }], chunk, coerce, "t")
    expect(out.size).toBe(2)
    expect((out.get("task-a")!.payload as { v: number }).v).toBe(1)
    expect((out.get("task-b")!.payload as { v: number }).v).toBe(2)
  })

  it("모르는 id 만 온 응답은 통째로 버린다 — 순서로 붙이지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // 판정기가 실제로 이렇게 돌아온 적이 있다: id 가 1,2,3 이고 내용은 전혀 다른 지문
    const out = matchById([{ id: 1, meaning: "same" }, { id: 2 }], chunk, coerce, "t")
    expect(out.size).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("일부만 맞으면 맞은 것만 쓴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = matchById([{ id: "task-a", v: 1 }], chunk, coerce, "t")
    expect([...out.keys()]).toEqual(["task-a"])
    warn.mockRestore()
  })

  it("응답이 비어도 터지지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(matchById([], chunk, coerce, "t").size).toBe(0)
    warn.mockRestore()
  })
})
