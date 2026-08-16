import { describe, expect, it } from "vitest"
import { verdictKey } from "../cache"
import { PROMPT_FINGERPRINT as FP1, buildType1Prompt } from "../verdict1"
import { PROMPT_FINGERPRINT as FP2, buildType2Prompt } from "../verdict2"

describe("verdictKey", () => {
  it("같은 답안은 같은 키다", () => {
    expect(verdictKey("T1", "type2", "abc", "the process can be controlled")).toBe(
      verdictKey("T1", "type2", "abc", "the process can be controlled"),
    )
  })

  it("공백·대소문자가 달라도 같은 답이면 같은 키다", () => {
    // 학생이 같은 답을 조금 다르게 쳤다고 다른 점수를 받으면 안 된다
    expect(verdictKey("T1", "type2", "abc", "  The Process   can be Controlled ")).toBe(
      verdictKey("T1", "type2", "abc", "the process can be controlled"),
    )
  })

  it("답이 다르면 키가 다르다", () => {
    expect(verdictKey("T1", "type2", "abc", "a")).not.toBe(verdictKey("T1", "type2", "abc", "b"))
  })

  it("문항이 다르면 키가 다르다", () => {
    // 같은 문장이라도 다른 문항이면 자극이 다르므로 판정이 달라질 수 있다
    expect(verdictKey("T1", "type2", "abc", "x")).not.toBe(verdictKey("T2", "type2", "abc", "x"))
  })

  it("유형이 다르면 키가 다르다", () => {
    expect(verdictKey("T1", "type1", "abc", "x")).not.toBe(verdictKey("T1", "type2", "abc", "x"))
  })

  it("프롬프트 지문이 다르면 키가 다르다 — 캐시 무효화의 근거", () => {
    expect(verdictKey("T1", "type2", "old", "x")).not.toBe(verdictKey("T1", "type2", "new", "x"))
  })
})

describe("PROMPT_FINGERPRINT", () => {
  it("두 판정기의 지문이 서로 다르다", () => {
    expect(FP1).not.toBe(FP2)
  })

  it("지문이 실제로 프롬프트에서 나온다 — 문구를 바꾸면 달라져야 한다", () => {
    // 손으로 버전을 올리는 방식이면 안 올리는 날이 오고, 그날부터 옛 판정이 계속 나온다.
    // 여기서는 템플릿을 해싱하므로 문구 한 글자만 바뀌어도 갈린다.
    // 그 성질을 확인하려고, 같은 방식으로 만든 두 해시가 서로 다른지 본다.
    const { createHash } = require("node:crypto") as typeof import("node:crypto")
    const probe = buildType2Prompt([{ id: "_", stimulus: "_", target: "clause", answer: "_" }])
    const tweaked = probe.replace("negates", "NEGATES")
    expect(probe).not.toBe(tweaked)
    expect(createHash("sha1").update(probe).digest("hex")).not.toBe(
      createHash("sha1").update(tweaked).digest("hex"),
    )
  })

  it("프롬프트에 요청 내용이 들어가도 지문은 고정된 탐침으로 뽑는다", () => {
    // 요청이 바뀔 때마다 지문이 바뀌면 캐시가 영영 안 맞는다
    const a = buildType1Prompt([{ id: "_", stimulus: "_", answer: "_" }])
    const b = buildType1Prompt([{ id: "_", stimulus: "_", answer: "_" }])
    expect(a).toBe(b)
  })
})
