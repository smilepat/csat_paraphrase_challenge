import { describe, expect, it } from "vitest"
import { goldSpanInContext, promptFor, toTaskView, type TaskRow } from "../render"

const BODY =
  "Aaa bbb ccc. Natural ingredients vary a lot depending on origin and climate. " +
  "These variations make testing hard. Zzz."

// 오프셋을 손으로 적으면 반드시 어긋난다(실제로 한 칸 틀렸다).
// 문자열에서 직접 뽑아 쓰면 픽스처가 스스로 맞는다.
const at = (needle: string) => {
  const start = BODY.indexOf(needle)
  if (start < 0) throw new Error(`픽스처에 없는 조각: ${needle}`)
  return { start, end: start + needle.length }
}
const SENT = at("Natural ingredients vary a lot depending on origin and climate.")
const SHELL = at("These variations")
const CONTEXT_END = at("These variations make testing hard.").end

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "T#t3-01",
  type: 3,
  direction: "span",
  context_start: SENT.start,
  context_end: CONTEXT_END,
  stimulus_start: SHELL.start,
  stimulus_end: SHELL.end,
  target_form: null,
  answer_start: SENT.start,
  answer_end: SENT.end,
  avoid_words: null,
  ...over,
})

describe("toTaskView", () => {
  it("지문 전문이 아니라 문맥만 내보낸다", () => {
    const v = toTaskView(task(), BODY)
    // 저작권 설계의 핵심 — 서버가 자른 뒤에는 그 밖이 존재하지 않는다
    expect(v.context).not.toContain("Aaa bbb ccc")
    expect(v.context).not.toContain("Zzz")
    expect(v.context.length).toBeLessThan(BODY.length)
  })

  it("자극 오프셋을 문맥 기준으로 옮긴다", () => {
    const v = toTaskView(task(), BODY)
    expect(v.context.slice(v.highlight.start, v.highlight.end)).toBe(v.stimulus)
    expect(v.stimulus).toBe("These variations")
  })

  it("유형 1 은 금지어를 함께 보낸다", () => {
    const v = toTaskView(
      task({ type: 1, direction: null, avoid_words: '["natural","ingredients"]' }),
      BODY,
    )
    expect(v.avoidWords).toEqual(["natural", "ingredients"])
  })

  it("유형 2 는 목표 구조를 함께 보낸다", () => {
    const v = toTaskView(task({ type: 2, direction: "unfold", target_form: "clause" }), BODY)
    expect(v.targetForm).toBe("clause")
    expect(v.prompt).toContain("문장으로")
  })

  it("지시문은 유형과 방향으로 갈린다", () => {
    expect(promptFor(2, "fold")).toContain("명사구")
    expect(promptFor(2, "unfold")).toContain("문장")
    expect(promptFor(1, null)).toContain("같은 뜻의 다른 말로")
    expect(promptFor(3, "span")).toContain("범위")
  })
})

describe("goldSpanInContext", () => {
  it("정답 범위도 같은 기준으로 옮긴다", () => {
    const t = task()
    const g = goldSpanInContext(t)!
    const v = toTaskView(t, BODY)
    expect(v.context.slice(g.start, g.end)).toBe(BODY.slice(t.answer_start!, t.answer_end!))
  })

  it("정답 범위가 없으면 null", () => {
    expect(goldSpanInContext(task({ answer_start: null, answer_end: null }))).toBeNull()
  })
})
