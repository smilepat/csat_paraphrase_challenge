"use client"

import { useCallback, useEffect, useState } from "react"
import { nextTask, studyReport, submitAnswer, taskHint, type NextTask, type SubmitResult } from "@/app/actions/study"
import type { HintStep } from "@/lib/tasks/hint"
import { TaskContext } from "@/components/task-context"
import { fillScaffold } from "@/lib/tasks/scaffold"

type Report = Awaited<ReturnType<typeof studyReport>>

const AXIS_NAME: Record<number, string> = {
  1: "다른 낱말로",
  2: "이름↔문장",
  3: "되받는 이름",
}

function AxisBars({ report }: { report: Report }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {report.profile.map((p) => (
        <div key={p.axis} className="rounded-xl border border-[var(--color-line)] bg-white p-3">
          <div className="text-[11px] font-semibold text-[var(--color-muted)]">
            유형 {p.axis} · {AXIS_NAME[p.axis]}
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums">
            {p.mean === null ? "–" : Math.round(p.mean)}
          </div>
          <div className="mt-1 h-1.5 rounded bg-[var(--color-soft)]">
            <div
              className="h-1.5 rounded bg-[var(--color-brand)]"
              style={{ width: `${p.mean ?? 0}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-muted)]">
            {p.n === 0 ? "아직 안 해봄" : `${p.n}회`}
            {p.trend !== null && ` · ${p.trend > 0 ? "▲" : "▼"}${Math.abs(Math.round(p.trend))}`}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function StudyClient({ learnerId }: { learnerId: string }) {
  const [item, setItem] = useState<NextTask>(null)
  const [answer, setAnswer] = useState("")
  const [span, setSpan] = useState<{ start: number; end: number } | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 힌트 사다리. steps 는 이 문항에서 열 수 있는 전부이고 shown 은 지금까지 연 칸 수다.
  const [steps, setSteps] = useState<HintStep[]>([])
  const [shown, setShown] = useState(0)
  // 틀에 채운 값들. 틀이 없거나 학생이 직접 쓰기를 고르면 answer 를 쓴다.
  const [slots, setSlots] = useState<string[]>([])
  const [freeWrite, setFreeWrite] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [t, r] = await Promise.all([nextTask(learnerId), studyReport(learnerId)])
      setItem(t)
      setReport(r)
      setAnswer("")
      setSpan(null)
      setResult(null)
      setSteps([])
      setShown(0)
      setSlots([])
      setFreeWrite(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [learnerId])

  useEffect(() => {
    void load()
  }, [load])

  async function onSubmit() {
    if (!item) return
    setBusy(true)
    setError(null)
    try {
      const r = await submitAnswer(learnerId, item.task.id, composed, span ?? undefined, shown)
      setResult(r)
      setReport(await studyReport(learnerId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const view = item?.task
  const isSpanTask = view?.type === 3
  const scaffold = !freeWrite && !isSpanTask ? (view?.scaffold ?? null) : null

  // 틀을 쓰면 칸을 합쳐 답안을 만든다. 채점기는 어느 쪽인지 알 필요가 없다.
  const composed = scaffold ? fillScaffold(scaffold.frame, slots) : answer
  const canSubmit = isSpanTask
    ? span !== null
    : scaffold
      ? scaffold.slots.every((_, i) => (slots[i] ?? "").trim().length > 0)
      : answer.trim().length > 0

  return (
    <main className="mx-auto max-w-[640px] px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">오늘의 연습</h1>
        {report && <span className="text-xs text-[var(--color-muted)]">누적 {report.total}회</span>}
      </header>

      {report && (
        <div className="mt-4">
          <AxisBars report={report} />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-[#fef2f2] p-3 text-sm text-[var(--color-team-red)]">{error}</p>
      )}

      {!view && !busy && (
        <p className="card mt-6 p-6 text-sm text-[var(--color-muted)]">
          지금은 낼 문항이 없습니다. 선생님이 문항을 승인하면 이어서 할 수 있습니다.
        </p>
      )}

      {view && (
        <section className="card mt-5 space-y-4 p-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--color-brand)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-brand)]">
              유형 {view.type} · {AXIS_NAME[view.type]}
            </span>
            <span className="text-[11px] text-[var(--color-muted)]">{item.reason}</span>
          </div>

          <p className="text-sm font-semibold">{view.prompt}</p>

          <div className="rounded-xl bg-[var(--color-soft)] p-4">
            <TaskContext
              context={view.context}
              stimulus={view.highlight}
              selection={span}
              onSelect={isSpanTask ? setSpan : undefined}
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
              {span ? (
                <span className="font-semibold">
                  “{view.context.slice(span.start, span.end).slice(0, 60)}…”
                </span>
              ) : (
                <span className="text-[var(--color-muted)]">문맥에서 끌어서 선택하세요</span>
              )}
            </p>
          ) : scaffold ? (
            <div className="space-y-3">
              {/* 틀을 그대로 보여 준다 — 어디에 무엇이 들어가는지가 먼저 보여야 한다 */}
              <p className="rounded-xl bg-white p-3 font-serif text-[1.02rem] leading-relaxed">
                {scaffold.frame.split(/(\{\d+\})/).map((part, i) => {
                  const m = part.match(/^\{(\d+)\}$/)
                  if (!m) return <span key={i}>{part}</span>
                  const idx = Number(m[1])
                  return (
                    <span
                      key={i}
                      className="mx-0.5 inline-block min-w-[4.5rem] border-b-2 border-[var(--color-brand)] px-1 text-center font-semibold text-[var(--color-brand)]"
                    >
                      {slots[idx]?.trim() || `(${idx + 1})`}
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
                    value={slots[i] ?? ""}
                    onChange={(e) => {
                      const next = [...slots]
                      next[i] = e.target.value
                      setSlots(next)
                    }}
                    disabled={!!result}
                    className="mt-1 w-full rounded-xl border border-[var(--color-line)] p-2 font-serif disabled:bg-slate-50"
                  />
                </label>
              ))}

              {!result && (
                <button
                  onClick={() => {
                    setAnswer(composed)
                    setFreeWrite(true)
                  }}
                  className="text-xs text-[var(--color-muted)] underline"
                >
                  틀 없이 직접 쓸게요
                </button>
              )}
            </div>
          ) : (
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              disabled={!!result}
              placeholder="여기에 영어로 쓰세요"
              className="w-full rounded-xl border border-[var(--color-line)] p-3 font-serif text-[1rem] disabled:bg-slate-50"
            />
          )}

          {steps.slice(0, shown).map((s) => (
            <div
              key={s.level}
              className="rounded-xl border border-dashed border-[var(--color-brand)] bg-white p-3"
            >
              <p className="text-[11px] font-bold text-[var(--color-brand)]">
                도움 {s.level}/{steps.length} · {s.label}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm">{s.body}</p>
            </div>
          ))}

          {!result ? (
            <div className="space-y-2">
              <button
                onClick={onSubmit}
                disabled={busy || !canSubmit}
                className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 font-semibold text-white disabled:opacity-40"
              >
                {busy ? "채점 중…" : "제출"}
              </button>
              {shown < (steps.length || 1) && (
                <button
                  onClick={async () => {
                    // 첫 요청에서만 서버를 부른다. 그 뒤로는 이미 받아 둔 칸을 하나씩 연다.
                    const list = steps.length ? steps : await taskHint(view.id)
                    if (!steps.length) setSteps(list)
                    setShown((n) => Math.min(n + 1, list.length))
                  }}
                  className="w-full rounded-xl border border-[var(--color-line)] px-4 py-2 text-sm font-semibold text-[var(--color-muted)]"
                >
                  {shown === 0
                    ? "막혔어요 — 도움 받기"
                    : `아직 어려워요 — 더 도와주세요 (${shown}/${steps.length})`}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className={`rounded-xl p-4 ${
                  result.score >= 70 ? "bg-[#f0fdf4]" : result.score > 0 ? "bg-[#fffbeb]" : "bg-[#fef2f2]"
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums">{result.score}</span>
                  {result.errorName && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">
                      {result.errorName}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm">{result.message}</p>
                {result.suggested && (
                  <p className="mt-2 font-serif text-sm text-[var(--color-muted)]">
                    예시: {result.suggested}
                  </p>
                )}
                {result.gold && (
                  <div className="mt-3 rounded-lg bg-white p-2">
                    <p className="text-[11px] font-bold text-[var(--color-good)]">수능 정답 쌍</p>
                    <p className="mt-1 font-serif text-sm">{result.gold}</p>
                  </div>
                )}
              </div>
              <button
                onClick={load}
                className="w-full rounded-xl border border-[var(--color-line)] px-4 py-2.5 font-semibold"
              >
                다음 문항
              </button>
            </div>
          )}
        </section>
      )}

      {report && report.errors.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold">자주 나오는 오답</h2>
          <ul className="mt-2 space-y-1">
            {report.errors.slice(0, 4).map((e) => (
              <li key={e.name} className="flex justify-between text-sm">
                <span>{e.name}</span>
                <span className="tabular-nums text-[var(--color-muted)]">
                  {e.n}회 · {Math.round(e.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
