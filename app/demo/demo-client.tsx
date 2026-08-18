"use client"

// ============================================================
// 데모 화면 — 유형마다 한 문제씩, 한 번에 하나만 보여 준다.
//
// 학생 화면(study-client.tsx)과 같은 부품을 쓴다: TaskContext, 답안 틀,
// 힌트 사다리, 결과 패널. 다른 것은 이력·적응 출제가 없다는 것뿐이다.
// 부품을 새로 그리면 연수에서 본 화면과 학생이 만나는 화면이 갈라진다.
// ============================================================

import { useState } from "react"
import { TaskContext } from "@/components/task-context"
import { Emphasis } from "@/components/emphasis"
import { answerToSubmit, fillScaffold } from "@/lib/tasks/scaffold"
import { demoHint, demoSubmit, type DemoResult, type DemoTask } from "@/app/actions/demo"
import type { HintStep } from "@/lib/tasks/hint"

const AXIS_NAME: Record<number, string> = {
  1: "다른 낱말로",
  2: "이름↔문장",
  3: "되받는 이름",
}

/** 유형마다 따로 들고 있는 풀이 상태. 탭을 옮겨도 쓰던 답이 사라지지 않는다. */
type Draft = {
  slots: string[]
  answer: string
  freeWrite: boolean
  span: { start: number; end: number } | null
  steps: HintStep[]
  shown: number
  result: DemoResult | null
}

const emptyDraft: Draft = {
  slots: [],
  answer: "",
  freeWrite: false,
  span: null,
  steps: [],
  shown: 0,
  result: null,
}

const SLOT_PATTERN = /(\{\d+\})/
const SLOT_INDEX = /^\{(\d+)\}$/

export default function DemoClient({ tasks }: { tasks: DemoTask[] }) {
  const [at, setAt] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const task = tasks[at]
  if (!task) return null
  const view = task.view
  const draft = drafts[view.id] ?? emptyDraft

  function patch(next: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [view.id]: { ...(d[view.id] ?? emptyDraft), ...next } }))
  }

  const isSpanTask = view.type === 3
  const scaffold = !draft.freeWrite && !isSpanTask ? view.scaffold : null
  const composed = scaffold ? fillScaffold(scaffold.frame, draft.slots) : draft.answer
  const submitted = answerToSubmit(view.type, scaffold, draft.slots, composed)
  const canSubmit = isSpanTask
    ? draft.span !== null
    : scaffold
      ? scaffold.slots.every((_, i) => (draft.slots[i] ?? "").trim().length > 0)
      : draft.answer.trim().length > 0

  async function onSubmit() {
    setBusy(true)
    setError(null)
    try {
      patch({ result: await demoSubmit(view.id, submitted, draft.span ?? undefined) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* 유형 고르기 — 세 유형이 나란히 보여야 "바꿔 말하기가 셋이다" 가 한눈에 든다 */}
      <nav className="mt-6 grid grid-cols-3 gap-2">
        {tasks.map((t, i) => (
          <button
            key={t.view.id}
            onClick={() => setAt(i)}
            className={`rounded-xl border px-2 py-2 text-center text-xs font-bold transition ${
              i === at
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                : "border-[var(--color-line)] bg-white text-[var(--color-muted)]"
            }`}
          >
            <span className="block">유형 {t.view.type}</span>
            <span className="block text-[11px] font-semibold opacity-90">
              {AXIS_NAME[t.view.type]}
            </span>
          </button>
        ))}
      </nav>

      {/* 연수 진행자용 설명. 학생 화면에는 없는 칸이다. */}
      <p className="mt-4 rounded-xl border-l-4 border-[var(--color-brand)] bg-white p-3 text-sm leading-relaxed">
        {task.teacherNote}
      </p>

      {error && (
        <p className="mt-4 rounded-xl bg-[#fef2f2] p-3 text-sm text-[var(--color-team-red)]">
          {error}
        </p>
      )}

      <section className="card mt-4 space-y-4 p-6">
        <p className="text-sm font-semibold">
          <Emphasis text={view.prompt} />
        </p>

        <div className="rounded-xl bg-[var(--color-soft)] p-4">
          <TaskContext
            context={view.context}
            stimulus={view.highlight}
            selection={draft.span}
            onSelect={isSpanTask && !draft.result ? (s) => patch({ span: s }) : undefined}
          />
        </div>

        {view.type === 1 && view.avoidWords.length > 0 && (
          <p className="text-xs text-[var(--color-muted)]">
            다르게 표현할 단어:{" "}
            <span className="font-semibold text-[var(--color-ink)]">
              {view.avoidWords.join(" · ")}
            </span>
          </p>
        )}

        {isSpanTask ? (
          <p className="text-sm">
            표시한 범위:{" "}
            {draft.span ? (
              <span className="font-semibold">
                “{view.context.slice(draft.span.start, draft.span.end).slice(0, 60)}…”
              </span>
            ) : (
              <span className="text-[var(--color-muted)]">문맥에서 끌어서 선택하세요</span>
            )}
          </p>
        ) : scaffold ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-white p-3 font-serif text-[1.02rem] leading-relaxed">
              {scaffold.frame.split(SLOT_PATTERN).map((part, i) => {
                const m = part.match(SLOT_INDEX)
                if (!m) return <span key={i}>{part}</span>
                const idx = Number(m[1])
                return (
                  <span
                    key={i}
                    className="mx-0.5 inline-block min-w-[4.5rem] border-b-2 border-[var(--color-brand)] px-1 text-center font-semibold text-[var(--color-brand)]"
                  >
                    {draft.slots[idx]?.trim() || `(${idx + 1})`}
                  </span>
                )
              })}
            </p>

            {scaffold.slots.map((slot, i) => (
              <label key={i} className="block">
                <span className="text-xs font-semibold text-[var(--color-muted)]">
                  ({i + 1}) {slot.hint}
                </span>
                <input
                  value={draft.slots[i] ?? ""}
                  onChange={(e) => {
                    const next = [...draft.slots]
                    next[i] = e.target.value
                    patch({ slots: next })
                  }}
                  disabled={!!draft.result}
                  className="mt-1 w-full rounded-xl border border-[var(--color-line)] p-2 font-serif disabled:bg-slate-50"
                />
              </label>
            ))}

            {!draft.result && (
              <button
                onClick={() => patch({ answer: composed, freeWrite: true })}
                className="text-xs text-[var(--color-muted)] underline"
              >
                틀 없이 직접 쓸게요
              </button>
            )}
          </div>
        ) : (
          <textarea
            value={draft.answer}
            onChange={(e) => patch({ answer: e.target.value })}
            rows={3}
            disabled={!!draft.result}
            placeholder="여기에 영어로 쓰세요"
            className="w-full rounded-xl border border-[var(--color-line)] p-3 font-serif text-[1rem] disabled:bg-slate-50"
          />
        )}

        {draft.steps.slice(0, draft.shown).map((s) => (
          <div
            key={s.level}
            className="rounded-xl border border-dashed border-[var(--color-brand)] bg-white p-3"
          >
            <p className="text-[11px] font-bold text-[var(--color-brand)]">
              도움 {s.level}/{draft.steps.length} · {s.label}
            </p>
            <p className="mt-1 whitespace-pre-line text-sm">
              <Emphasis text={s.body} />
            </p>
          </div>
        ))}

        {!draft.result ? (
          <div className="space-y-2">
            <button
              onClick={onSubmit}
              disabled={busy || !canSubmit}
              className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 font-semibold text-white disabled:opacity-40"
            >
              {busy ? "채점 중…" : "제출"}
            </button>
            {draft.shown < (draft.steps.length || 1) && (
              <button
                onClick={async () => {
                  // 첫 요청에서만 서버를 부른다. 그 뒤로는 받아 둔 칸을 하나씩 연다.
                  const list = draft.steps.length ? draft.steps : await demoHint(view.id)
                  patch({ steps: list, shown: Math.min(draft.shown + 1, list.length) })
                }}
                className="w-full rounded-xl border border-[var(--color-line)] px-4 py-2 text-sm font-semibold text-[var(--color-muted)]"
              >
                {draft.shown === 0
                  ? "막혔어요 — 도움 받기"
                  : `아직 어려워요 — 더 도와주세요 (${draft.shown}/${draft.steps.length})`}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className={`rounded-xl p-4 ${
                draft.result.score >= 70
                  ? "bg-[#f0fdf4]"
                  : draft.result.score > 0
                    ? "bg-[#fffbeb]"
                    : "bg-[#fef2f2]"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{draft.result.score}</span>
                {draft.result.errorName && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">
                    {draft.result.errorName}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm">{draft.result.message}</p>
              {draft.result.suggested && (
                <p className="mt-2 font-serif text-sm text-[var(--color-muted)]">
                  이 답을 고친다면: {draft.result.suggested}
                </p>
              )}
              {/* 모범답안은 점수와 상관없이 나온다 — 학생 화면과 같은 규칙이다(§38) */}
              {draft.result.model && (
                <div className="mt-3 rounded-lg bg-white p-2">
                  <p className="text-[11px] font-bold text-[var(--color-brand)]">모범답안</p>
                  <p className="mt-1 font-serif text-sm">{draft.result.model}</p>
                  <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                    정답은 하나가 아닙니다. 이 답과 내 답이 어디서 갈렸는지 견줘 보세요.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDrafts((d) => ({ ...d, [view.id]: emptyDraft }))}
                className="rounded-xl border border-[var(--color-line)] px-4 py-2.5 font-semibold"
              >
                다시 풀기
              </button>
              <button
                onClick={() => setAt((i) => Math.min(i + 1, tasks.length - 1))}
                disabled={at >= tasks.length - 1}
                className="rounded-xl bg-[var(--color-brand)] px-4 py-2.5 font-semibold text-white disabled:opacity-40"
              >
                다음 유형
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
