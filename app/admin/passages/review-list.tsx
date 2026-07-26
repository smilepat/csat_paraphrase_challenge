"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  approveMany, approvePassage, rejectPassage, savePassage, unapprovePassage,
  type ReviewPassage,
} from "@/app/actions/admin"
import { wordCount } from "@/lib/scoring/text"

export default function ReviewList({ passages }: { passages: ReviewPassage[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const clean = passages.filter((p) => p.severity === "clean" && p.reviewStatus !== "approved")
  const flagged = passages.filter((p) => p.severity !== "clean")

  async function bulkApprove() {
    setBusy(true)
    try {
      const n = await approveMany(clean.map((p) => p.id))
      setNote(`${n}개를 승인했습니다.`)
      router.refresh()
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-4">
      {passages.length > 0 && (
        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              자동 점검 — <strong>지적 없음 {passages.filter((p) => p.severity === "clean").length}</strong>
              {" · "}경고 {passages.filter((p) => p.severity === "warn").length}
              {" · "}오류 {passages.filter((p) => p.severity === "error").length}
              {flagged.length > 0 && (
                <span className="text-[var(--color-muted)]"> · 지적 있는 지문을 위로 올렸습니다</span>
              )}
            </div>
            {clean.length > 0 && (
              <button
                onClick={bulkApprove}
                disabled={busy}
                className="rounded-xl bg-[var(--color-good)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy ? "승인 중..." : `지적 없는 ${clean.length}개 한꺼번에 승인`}
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            자동 점검은 기계가 확실히 잡을 수 있는 것만 봅니다(원문 발췌·중복·길이·어휘).
            명제가 지문의 논지를 제대로 대표하는지는 판단하지 못하므로, 일괄 승인은 선생님의 선택입니다.
          </p>
          {note && <p className="mt-2 text-sm text-[var(--color-good)]">{note}</p>}
        </section>
      )}

      {passages.map((p) => (
        <PassageCard key={p.id} passage={p} />
      ))}
    </div>
  )
}

function SeverityBadge({ severity }: { severity: ReviewPassage["severity"] }) {
  if (severity === "clean") {
    return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">지적 없음</span>
  }
  const isError = severity === "error"
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs ${
        isError ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
      }`}
    >
      {isError ? "오류" : "경고"}
    </span>
  )
}

function PassageCard({ passage }: { passage: ReviewPassage }) {
  const router = useRouter()
  const [title, setTitle] = useState(passage.title)
  const [topic, setTopic] = useState(passage.topic ?? "")
  const [props, setProps] = useState(passage.propositions.join("\n"))
  const [models, setModels] = useState(passage.modelAnswers.join("\n"))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const propList = props.split("\n").map((s) => s.trim()).filter(Boolean)
  const modelList = models.split("\n").map((s) => s.trim()).filter(Boolean)
  const longModels = modelList.filter((m) => wordCount(m) > 30)

  const payload = { id: passage.id, title, topic, propositions: propList, modelAnswers: modelList }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      setDone(true)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      data-testid="passage-card"
      data-passage-id={passage.id}
      className={`card p-5 ${done ? "opacity-50" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--color-line)] px-3 py-1.5 font-bold"
        />
        <span className="text-sm text-[var(--color-muted)]">
          <SeverityBadge severity={passage.severity} />{" "}
          {passage.id} · {passage.wordCount}단어
          {passage.questionType && ` · ${passage.questionType}`}
          {passage.difficultyScore !== null && ` · 난도 ${passage.difficultyScore.toFixed(1)}`}
        </span>
      </div>

      {passage.issues.length > 0 && (
        <ul className="mt-3 space-y-1">
          {passage.issues.map((it, i) => (
            <li
              key={i}
              className={`rounded-lg px-3 py-2 text-sm ${
                it.level === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"
              }`}
            >
              {it.message}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-bold">지문 원문</summary>
        <p className="mt-2 rounded-xl border-l-4 border-[var(--color-brand)] bg-slate-50 p-3
                      text-sm leading-relaxed whitespace-pre-wrap">
          {passage.body}
        </p>
      </details>

      <label className="mt-3 block">
        <span className="text-sm font-bold">주제 (한국어)</span>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-sm font-bold">
          핵심 명제 ({propList.length}개) — 한 줄에 하나. 학생 답안이 이걸 담았는지로 채점합니다
        </span>
        <textarea
          value={props}
          onChange={(e) => setProps(e.target.value)}
          rows={Math.max(4, propList.length + 1)}
          className="mt-1 w-full rounded-xl border border-[var(--color-line)] p-3 text-sm leading-relaxed"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-sm font-bold">
          모범 답안 ({modelList.length}개) — 한 줄에 하나
        </span>
        <textarea
          value={models}
          onChange={(e) => setModels(e.target.value)}
          rows={Math.max(3, modelList.length + 1)}
          className="mt-1 w-full rounded-xl border border-[var(--color-line)] p-3 text-sm leading-relaxed"
        />
        <span className="mt-1 block text-xs text-[var(--color-muted)]">
          {modelList.map((m) => `${wordCount(m)}단어`).join(" · ")}
          {longModels.length > 0 && (
            <span className="text-[var(--color-warn)]"> · 30단어 초과 답안이 있습니다</span>
          )}
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {passage.reviewStatus === "approved" ? (
          <>
            <button
              onClick={() => run("save", () => savePassage(payload))}
              disabled={busy !== null}
              className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-40"
            >
              수정 저장
            </button>
            <button
              onClick={() => run("unapprove", () => unapprovePassage(passage.id))}
              disabled={busy !== null}
              className="rounded-xl border border-[var(--color-line)] px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              승인 취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => run("approve", () => approvePassage(payload))}
              disabled={busy !== null || propList.length < 2 || modelList.length < 1}
              className="rounded-xl bg-[var(--color-good)] px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy === "approve" ? "승인 중..." : "승인"}
            </button>
            <button
              onClick={() => run("save", () => savePassage(payload))}
              disabled={busy !== null}
              className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-40"
            >
              저장만
            </button>
            <button
              onClick={() => run("reject", () => rejectPassage(passage.id))}
              disabled={busy !== null}
              className="rounded-xl border border-[var(--color-line)] px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              제외
            </button>
          </>
        )}
      </div>
    </section>
  )
}
