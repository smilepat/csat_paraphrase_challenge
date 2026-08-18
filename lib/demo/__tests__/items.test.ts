// ============================================================
// 데모 문항 자가 점검.
//
// 데모는 홈에서 로그인 없이 열리고 교사 연수에서 처음 보여 주는 화면이다.
// 어긋난 오프셋은 화면에서 **엉뚱한 곳에 밑줄**로 나타나고, 그 자리에서
// 고칠 방법이 없다. 그래서 문항이 바뀔 때마다 여기서 먼저 걸린다.
// ============================================================

import { describe, it, expect } from "vitest"
import { DEMO_ITEMS, demoTaskRow, demoTaskView } from "../items"
import { hintSteps } from "@/lib/tasks/hint"
import { formAgreesWithExample } from "@/lib/tasks/hint-material"

describe("데모 문항", () => {
  it("세 유형이 하나씩 있다", () => {
    expect(DEMO_ITEMS.map((i) => i.type).sort()).toEqual([1, 2, 3])
  })

  it("id 가 겹치지 않는다", () => {
    expect(new Set(DEMO_ITEMS.map((i) => i.id)).size).toBe(DEMO_ITEMS.length)
  })

  for (const item of DEMO_ITEMS) {
    describe(`${item.id} (유형 ${item.type})`, () => {
      it("오프셋이 지문과 맞는다", () => {
        const row = demoTaskRow(item)
        expect(row.body.slice(row.stimulus_start, row.stimulus_end)).toBe(item.stimulus)
        expect(row.body.slice(row.context_start, row.context_end)).toBe(item.context)
      })

      it("자극이 문맥 안에 있다 — 밖에 있으면 학생이 볼 수 없는 것을 조작하라는 말이 된다", () => {
        const row = demoTaskRow(item)
        expect(row.stimulus_start).toBeGreaterThanOrEqual(row.context_start)
        expect(row.stimulus_end).toBeLessThanOrEqual(row.context_end)
      })

      it("화면 모델의 밑줄이 자극과 같은 글자를 가리킨다", () => {
        const view = demoTaskView(item)
        expect(view.context.slice(view.highlight.start, view.highlight.end)).toBe(item.stimulus)
      })

      it("힌트 사다리가 비어 있지 않고 단계가 1부터 이어진다", () => {
        const view = demoTaskView(item)
        const steps = hintSteps(item.type, item.direction, view.stimulus, view.avoidWords, item.hints)
        expect(steps.length).toBeGreaterThan(0)
        expect(steps.map((s) => s.level)).toEqual(steps.map((_, i) => i + 1))
        for (const s of steps) expect(s.body.trim().length).toBeGreaterThan(0)
      })
    })
  }

  it("유형 1 은 피할 낱말이 실제로 자극 안에 있다", () => {
    const item = DEMO_ITEMS.find((i) => i.type === 1)!
    expect(item.avoidWords?.length).toBeGreaterThan(0)
    for (const w of item.avoidWords ?? []) {
      expect(item.stimulus.toLowerCase()).toContain(w.toLowerCase())
    }
  })

  it("유형 1 의 예시 답은 피해야 할 낱말을 쓰지 않는다 — 쓰면 앱이 자기 예시를 0점 처리한다", () => {
    const item = DEMO_ITEMS.find((i) => i.type === 1)!
    const example = (item.hints.example ?? "").toLowerCase()
    for (const w of item.avoidWords ?? []) {
      expect(example).not.toContain(w.toLowerCase())
    }
  })

  it("유형 2 는 어형(form)과 예시 답이 같은 낱말을 가리킨다 (§37)", () => {
    const item = DEMO_ITEMS.find((i) => i.type === 2)!
    expect(item.hints.form).toBeTruthy()
    expect(formAgreesWithExample(item.hints.form!, item.hints.example ?? "")).toBe(true)
  })

  it("유형 2 는 답안 틀이 있고 칸마다 안내가 붙는다", () => {
    const view = demoTaskView(DEMO_ITEMS.find((i) => i.type === 2)!)
    expect(view.scaffold).not.toBeNull()
    for (const slot of view.scaffold!.slots) expect(slot.hint.trim().length).toBeGreaterThan(0)
  })

  it("유형 2 의 틀 안내가 동사를 주어라고 부르지 않는다 (§41 ②)", () => {
    const view = demoTaskView(DEMO_ITEMS.find((i) => i.type === 2)!)
    const subjectSlot = view.scaffold!.slots[1]
    expect(subjectSlot?.source).toBeTruthy()
    // 주어 예시에 정형동사가 섞이면 같은 화면이 "동사를 명사로 바꾸라"면서 동사를 주어로 보여 준다
    expect(subjectSlot!.source!.trim().split(/\s+/).length).toBeLessThanOrEqual(2)
  })

  it("유형 3 의 정답 범위는 자극보다 앞에 있다 — 되받는 이름은 뒤에 온다", () => {
    const item = DEMO_ITEMS.find((i) => i.type === 3)!
    const row = demoTaskRow(item)
    expect(row.answer_start).not.toBeNull()
    expect(row.answer_end!).toBeLessThanOrEqual(row.stimulus_start)
    expect(row.answer_start!).toBeGreaterThanOrEqual(row.context_start)
  })
})
