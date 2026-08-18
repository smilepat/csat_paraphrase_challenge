"use server"

// ============================================================
// 데모 액션 — 교사 연수용. 로그인·승인·초대 코드 없이 홈에서 바로 열린다.
//
// 자습(study.ts)과 다른 점은 셋뿐이다:
//   ① 문항이 DB 가 아니라 코드에 있다(lib/demo/items.ts, 자작 지문)
//   ② 시도를 기록하지 않는다 — 데모는 이력이 아니고, 남기면 축 추세가 오염된다
//   ③ 답안 길이를 막는다 — 공개 경로라 판정 API 를 남에게 열어 주는 셈이 된다
//
// 채점은 자습과 **같은 함수**(gradeTypedAnswer)를 부른다. 여기서 갈리면
// 연수에서 보여 준 점수와 학생이 실제로 받는 점수가 달라진다.
// ============================================================

import { hintSteps, type HintStep } from "@/lib/tasks/hint"
import { gradeTypedAnswer, toGradable } from "@/lib/scoring/typed/grade"
import { demoTaskRow, demoTaskView, findDemoItem, DEMO_ITEMS } from "@/lib/demo/items"
import type { TaskView } from "@/lib/tasks/render"

/** 공개 경로라 답안 길이를 막는다. 데모 과제는 구 하나·명사구 하나라 이 정도면 넉넉하다. */
const MAX_ANSWER = 300

export type DemoTask = {
  view: TaskView
  teacherNote: string
}

export async function demoTasks(): Promise<DemoTask[]> {
  return DEMO_ITEMS.map((item) => ({ view: demoTaskView(item), teacherNote: item.teacherNote }))
}

export async function demoHint(id: string): Promise<HintStep[]> {
  const item = findDemoItem(id)
  if (!item) return []
  const view = demoTaskView(item)
  return hintSteps(item.type, item.direction, view.stimulus, view.avoidWords, item.hints)
}

export type DemoResult = {
  score: number
  errorName: string | null
  message: string
  suggested: string
  judged: boolean
  /** 모범답안. 자습과 같이 **점수와 상관없이** 준다. 유형 3 은 산출 과제가 아니라 없다. */
  model: string | null
}

export async function demoSubmit(
  id: string,
  answer: string,
  span?: { start: number; end: number },
): Promise<DemoResult> {
  const item = findDemoItem(id)
  if (!item) throw new Error("데모 문항이 아닙니다.")

  const text = String(answer ?? "").slice(0, MAX_ANSWER)
  const row = demoTaskRow(item)
  const graded = await gradeTypedAnswer(toGradable(row), row.body, text, span)

  return {
    ...graded,
    model: item.type === 3 ? null : (item.hints.example?.trim() || null),
  }
}
