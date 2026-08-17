import { answerToSubmit, fillScaffold, scaffoldFor } from "../scaffold"
import { checkAvoidance } from "../../scoring/typed/type1"
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

// ⚠ 고1 학생으로 직접 써 보다가 만났다. 유형 2 틀이 이렇게 나갔다:
//      (1) “fall” 를 명사로 바꾼 말
//      (2) 무엇에 대한 것인지 (예: Surprises can)
//    같은 힌트가 "동사를 명사로 바꾸라"고 하면서 **조동사를 주어 자리에 앉혔다.**
describe("유형 2 묶기 틀 — 주어 예시에 조동사가 딸려오면 안 된다", () => {
  it("조동사를 잘라 낸다", () => {
    const s = scaffoldFor(2, "fold", "Surprises can fall from the sky like volcanic ash.", [])!
    const subject = s.slots[1]!.hint
    expect(subject).toContain("Surprises")
    expect(subject, "조동사가 주어 예시에 들어갔다").not.toContain("can")
  })

  it("계사도 마찬가지다", () => {
    const s = scaffoldFor(2, "fold", "The results are difficult to interpret.", [])!
    expect(s.slots[1]!.hint).not.toMatch(/\bare\b/)
  })

  it("멀쩡한 주어는 그대로 둔다", () => {
    const s = scaffoldFor(2, "fold", "natural ingredients often vary in their composition", [])!
    expect(s.slots[1]!.hint).toContain("natural ingredients")
  })
})

// ⚠ 고1 학생으로 써 보다가 만난 가장 비싼 결함(§42).
//    `moral principles` 를 `ethical rules` 로 바꿨는데 **0점**이 나왔다:
//      "principles, moral 은(는) 아직 원문 그대로입니다"
//    내 답에는 그 낱말이 하나도 없었다. 빈칸 틀이 **문장 전체**를 조립해 보냈고,
//    문장 나머지에 남아 있던 원문 단어를 회피 검사가 셌기 때문이다.
//    같은 화면이 모범답안으로 `ethical standards` 를 보여 주고 있었다.
describe("채점기에 보낼 답안 고르기", () => {
  const CTX =
    "most people pause to reflect on their own {0} and on the practical implications of those principles"

  it("유형 1 은 문장이 아니라 **빈칸에 쓴 구**를 보낸다", () => {
    const sc = { frame: CTX, slots: [{ hint: "" }] }
    const composed = fillScaffold(sc.frame, ["ethical rules"])
    expect(composed, "화면에는 문장 전체가 보인다").toContain("practical implications")
    expect(answerToSubmit(1, sc, ["ethical rules"], composed)).toBe("ethical rules")
  })

  it("그래서 문장 나머지의 원문 단어가 회피 검사에 안 걸린다", () => {
    const sc = { frame: CTX, slots: [{ hint: "" }] }
    const sent = answerToSubmit(1, sc, ["ethical rules"], fillScaffold(sc.frame, ["ethical rules"]))
    const free = checkAvoidance({
      answer: sent,
      stimulus: "moral principles",
      avoidWords: ["principles", "moral"],
    })
    expect(free.reused, "보낸 답에 없는 낱말이 재사용으로 잡혔다").toEqual([])
    expect(free.fail).toBe(false)
  })

  it("유형 2 는 합친 것이 곧 답이다 — 그대로 보낸다", () => {
    const sc = { frame: "the {0} of {1}", slots: [{ hint: "" }, { hint: "" }] }
    const composed = fillScaffold(sc.frame, ["variability", "natural ingredients"])
    expect(answerToSubmit(2, sc, ["variability", "natural ingredients"], composed)).toBe(
      "the variability of natural ingredients",
    )
  })

  it("틀 없이 직접 쓰면 쓴 그대로 보낸다", () => {
    expect(answerToSubmit(1, null, [], "my own wording")).toBe("my own wording")
  })
})
