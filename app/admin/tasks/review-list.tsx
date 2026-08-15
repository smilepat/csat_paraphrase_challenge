"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { TaskContext } from "@/components/task-context"
import {
  approveManyType2, saveGold, setTaskStatus, updateAnswerSpan, updateStimulus,
  type ReviewTask,
} from "@/app/actions/task-review"

const TYPE_NAME: Record<number, string> = {
  1: "다른 낱말로",
  2: "이름 ↔ 문장",
  3: "되받는 이름",
}

const PRIORITY_LABEL: Record<number, string> = {
  0: "요약문 골드 — 손으로 채워야 함",
  1: "정관사 캡슐 — 되받기가 아닐 수 있음",
  2: "정답 범위 확인 필요",
}

function Card({ task, onDone }: { task: ReviewTask; onDone: () => void }) {
  const [span, setSpan] = useState<{ start: number; end: number } | null>(null)
  // 골드 스텁은 지문에서 절을 골라야 한다. 그 선택은 **지문 본문 기준** 좌표다.
  const [bodySpan, setBodySpan] = useState<{ start: number; end: number } | null>(null)
  const [goldText, setGoldText] = useState(task.gold?.[0]?.text ?? "")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      onDone()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const isSpanTask = task.view.type === 3
  const isGoldStub = task.origin === "gold"

  return (
    <article className="card space-y-3 p-5">
      <header className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[var(--color-brand)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-brand)]">
          유형 {task.view.type} · {TYPE_NAME[task.view.type]}
          {task.view.direction ? ` · ${task.view.direction}` : ""}
        </span>
        <span className="text-[11px] text-[var(--color-muted)]">{task.view.id}</span>
        {PRIORITY_LABEL[task.priority] && (
          <span className="rounded bg-[#fff7ed] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-warn)]">
            {PRIORITY_LABEL[task.priority]}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">{task.reviewStatus}</span>
      </header>

      <p className="text-xs text-[var(--color-muted)]">{task.view.prompt}</p>

      <div className="rounded-xl bg-[var(--color-soft)] p-4">
        <TaskContext
          context={task.view.context}
          stimulus={task.view.highlight}
          gold={isSpanTask ? task.goldSpan : null}
          selection={span}
          onSelect={isSpanTask ? setSpan : undefined}
        />
      </div>

      {isSpanTask && (
        <p className="text-xs">
          <span className="mr-2 inline-block h-2 w-3 rounded bg-[#dcfce7] align-middle" />
          현재 정답 범위
          {span && (
            <>
              {" · "}
              <span className="mr-2 inline-block h-2 w-3 rounded bg-[#fef08a] align-middle" />
              새로 표시한 범위
            </>
          )}
        </p>
      )}

      {task.view.type === 1 && task.view.avoidWords.length > 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          금지어: <span className="font-semibold text-[var(--color-ink)]">{task.view.avoidWords.join(" · ")}</span>
        </p>
      )}

      {task.notes && (
        <p className="rounded-lg bg-[#fffbeb] p-2 text-xs text-[var(--color-ink)]">{task.notes}</p>
      )}

      {task.passageBody && (
        <div className="space-y-2">
          <p className="text-xs font-semibold">
            지문 — 요약문에 대응하는 <span className="text-[var(--color-brand)]">절 하나를 끌어서</span> 고르세요
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-white p-3">
            <TaskContext
              context={task.passageBody}
              stimulus={{ start: -1, end: -1 }}
              selection={bodySpan}
              onSelect={setBodySpan}
            />
          </div>
          {bodySpan && (
            <div className="flex items-center gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const r = await updateStimulus(task.view.id, bodySpan)
                    if (!r.ok) throw new Error(r.error)
                  })
                }
                className="rounded-xl border border-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-[var(--color-brand)]"
              >
                이 절을 자극으로 지정
              </button>
              <span className="truncate text-xs text-[var(--color-muted)]">
                «{task.passageBody.slice(bodySpan.start, bodySpan.end).replace(/\s+/g, " ").slice(0, 70)}»
              </span>
            </div>
          )}
        </div>
      )}

      {isGoldStub && (
        <label className="block">
          <span className="text-xs font-semibold">정답 쌍 (지문의 절 → 요약문의 이름)</span>
          <textarea
            value={goldText}
            onChange={(e) => setGoldText(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] p-2 font-serif text-sm"
          />
        </label>
      )}

      {msg && <p className="text-sm text-[var(--color-team-red)]">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        {isSpanTask && span && (
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await updateAnswerSpan(task.view.id, span)
                if (!r.ok) throw new Error(r.error)
              })
            }
            className="rounded-xl border border-[var(--color-line)] px-3 py-1.5 text-sm font-semibold"
          >
            범위 저장
          </button>
        )}
        {isGoldStub && (
          <button
            disabled={busy}
            onClick={() => act(() => saveGold(task.view.id, goldText))}
            className="rounded-xl border border-[var(--color-line)] px-3 py-1.5 text-sm font-semibold"
          >
            정답 저장
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => act(() => setTaskStatus(task.view.id, "approved"))}
          className="rounded-xl bg-[var(--color-good)] px-3 py-1.5 text-sm font-semibold text-white"
        >
          승인
        </button>
        <button
          disabled={busy}
          onClick={() => act(() => setTaskStatus(task.view.id, "rejected"))}
          className="rounded-xl border border-[var(--color-team-red)] px-3 py-1.5 text-sm font-semibold text-[var(--color-team-red)]"
        >
          반려
        </button>
      </div>
    </article>
  )
}

export default function TaskReviewList({ tasks }: { tasks: ReviewTask[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const type2Raw = tasks.filter((t) => t.view.type === 2 && t.reviewStatus === "raw" && t.origin !== "gold")

  async function bulk() {
    setBusy(true)
    try {
      const n = await approveManyType2(type2Raw.map((t) => t.view.id))
      setNote(`유형 2 ${n}건을 승인했습니다.`)
      router.refresh()
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-4">
      {type2Raw.length > 0 && (
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              화면에 보이는 <strong>유형 2 {type2Raw.length}건</strong>을 한 번에 승인합니다.
              <span className="ml-1 text-xs text-[var(--color-muted)]">
                목표 구조가 기계적이라 일괄 승인 위험이 가장 작습니다. 유형 1·3 은 눈으로 봐야 합니다.
              </span>
            </p>
            <button
              disabled={busy}
              onClick={bulk}
              className="rounded-xl bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              일괄 승인
            </button>
          </div>
          {note && <p className="mt-2 text-sm text-[var(--color-good)]">{note}</p>}
        </section>
      )}

      {tasks.length === 0 && (
        <p className="card p-6 text-sm text-[var(--color-muted)]">해당하는 문항이 없습니다.</p>
      )}

      {tasks.map((t) => (
        <Card key={t.view.id} task={t} onDone={() => router.refresh()} />
      ))}
    </div>
  )
}
