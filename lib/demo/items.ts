// ============================================================
// 교사 연수용 데모 문항 — 유형마다 **한 문제씩**.
//
// 세 가지를 일부러 이렇게 했다:
//
// ① 지문이 자작이다. 데모는 승인 없이 홈에서 바로 열리므로 CSAT 원문을 쓰면
//    앱의 저작권 전제(비공개 + 교사 경로 인증)가 무너진다. 여기 실린 네 문단은
//    이 데모를 위해 새로 쓴 것이라 공개해도 된다.
//
// ② DB 를 타지 않는다. 문항이 검수 상태에 걸려 있으면 연수 도중에 "낼 문항이
//    없습니다" 가 뜬다. 연수는 다시 못 하므로 그 위험을 아예 없앤다.
//
// ③ 채점은 진짜다. 화면만 흉내 내면 보여 주는 값과 실제 앱이 갈라진다.
//    lib/scoring/typed 를 그대로 부른다(gradeTypedAnswer).
//
// 오프셋은 손으로 적지 않고 본문에서 **찾는다.** 손으로 적으면 문장을 한 글자
// 고칠 때마다 어긋나고, 어긋난 오프셋은 화면에서 조용히 이상한 곳을 밑줄 친다(§43).
// ============================================================

import type { HintMaterial } from "@/lib/tasks/hint"
import { toTaskView, type TaskRow, type TaskView } from "@/lib/tasks/render"

export type DemoItem = {
  id: string
  type: 1 | 2 | 3
  direction: string | null
  /** 지문 전문(자작). 데모는 짧아서 문맥이 곧 전문이다. */
  body: string
  /** 학생이 조작할 대상. body 안에 그대로 있어야 한다. */
  stimulus: string
  /** 화면에 보여 줄 범위. body 안에 그대로 있어야 한다. */
  context: string
  /** 유형 3 의 정답 범위. body 안에 그대로 있어야 한다. */
  answer?: string
  targetForm?: "noun_phrase" | "clause"
  avoidWords?: string[]
  hints: HintMaterial
  /** 연수 진행자용 한 줄 — 이 유형이 무엇을 재고 수능 어디에 나오는가 */
  teacherNote: string
}

export const DEMO_ITEMS: DemoItem[] = [
  {
    id: "demo-1",
    type: 1,
    direction: null,
    body:
      "Students who go over their notes the same evening remember far more than students who wait a week. " +
      "The gap comes from the delay itself, not from how long each group studied.",
    stimulus: "remember far more",
    context:
      "Students who go over their notes the same evening remember far more than students who wait a week.",
    avoidWords: ["remember", "more"],
    hints: {
      gloss: "훨씬 더 많이 기억한다",
      shape: "r_____ m___ b_____  (3낱말)",
      example: "recall much better",
    },
    teacherNote:
      "같은 개념을 다른 낱말로 옮기는 힘입니다. 특정 문항 번호에만 나오는 것이 아니라 " +
      "빈칸·함축·제목 어디서든 선택지와 지문을 잇는 다리로 쓰입니다.",
  },
  {
    id: "demo-2",
    type: 2,
    direction: "fold",
    body:
      "A beginner class rarely changes overnight. " +
      "The class improves slowly. " +
      "What looks like no progress on Monday often shows up as fluent speech three weeks later.",
    stimulus: "The class improves slowly.",
    context:
      "A beginner class rarely changes overnight. " +
      "The class improves slowly. " +
      "What looks like no progress on Monday often shows up as fluent speech three weeks later.",
    targetForm: "noun_phrase",
    hints: {
      gloss: "그 반은 천천히 나아진다",
      form: "improves → improvement",
      example: "the slow improvement of the class",
    },
    teacherNote:
      "문장을 이름으로 접는 힘(명사화)입니다. 수능 40번 요약문이 12개년 내내 이것 하나를 " +
      "묻습니다 — 지문의 문장이 요약문에서는 명사구로 접혀 있습니다.",
  },
  {
    id: "demo-3",
    type: 3,
    direction: "span",
    body:
      "Many students read a page, look away, and try to say it back in their own words. " +
      "Teachers see this habit most often in the learners who improve the fastest.",
    stimulus: "this habit",
    context:
      "Many students read a page, look away, and try to say it back in their own words. " +
      "Teachers see this habit most often in the learners who improve the fastest.",
    answer:
      "Many students read a page, look away, and try to say it back in their own words.",
    hints: {
      gloss: "이 습관 — 앞에서 말한 무엇을 되받는다",
      example: "앞 문장 전체(페이지를 읽고 고개를 돌려 자기 말로 말해 보는 것)",
    },
    teacherNote:
      "여러 문장을 하나의 이름으로 되받는 힘(캡슐화)입니다. 지시사+추상명사가 앞의 무엇을 " +
      "가리키는지 놓치면 그다음 문장부터 통째로 흔들립니다.",
  },
]

/** body 안에서 조각을 찾는다. 없으면 **바로 터뜨린다** — 조용히 0 으로 뭉개면 화면에서 엉뚱한 곳이 밑줄 쳐진다. */
function locate(body: string, piece: string, label: string, itemId: string): { start: number; end: number } {
  const start = body.indexOf(piece)
  if (start < 0) throw new Error(`[demo:${itemId}] ${label} 를 지문에서 찾지 못했습니다: "${piece.slice(0, 40)}"`)
  if (body.indexOf(piece, start + 1) >= 0) {
    throw new Error(`[demo:${itemId}] ${label} 가 지문에 두 번 이상 나옵니다 — 어느 쪽인지 정할 수 없습니다`)
  }
  return { start, end: start + piece.length }
}

/** 데모 문항을 pc_tasks 의 행과 같은 모양으로 만든다. 화면·채점이 실제 문항과 같은 길을 타게 하려는 것이다. */
export function demoTaskRow(item: DemoItem): TaskRow & { body: string } {
  const stimulus = locate(item.body, item.stimulus, "자극", item.id)
  const context = locate(item.body, item.context, "문맥", item.id)
  const answer = item.answer ? locate(item.body, item.answer, "정답 범위", item.id) : null

  return {
    id: item.id,
    type: item.type,
    direction: item.direction,
    context_start: context.start,
    context_end: context.end,
    stimulus_start: stimulus.start,
    stimulus_end: stimulus.end,
    target_form: item.targetForm ?? null,
    answer_start: answer?.start ?? null,
    answer_end: answer?.end ?? null,
    avoid_words: item.avoidWords ? JSON.stringify(item.avoidWords) : null,
    body: item.body,
  }
}

export function demoTaskView(item: DemoItem): TaskView {
  const row = demoTaskRow(item)
  return toTaskView(row, row.body)
}

export function findDemoItem(id: string): DemoItem | null {
  return DEMO_ITEMS.find((i) => i.id === id) ?? null
}
