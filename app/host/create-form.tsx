"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { TARGET_WORD_OPTIONS } from "@/lib/rooms"
import { createRoom } from "@/app/actions/host"
import type { PassageOption } from "@/app/actions/teacher-view"

export default function CreateRoomForm({ passages }: { passages: PassageOption[] }) {
  const router = useRouter()
  const [passageId, setPassageId] = useState(passages[0]?.id ?? "")
  const [targetWords, setTargetWords] = useState<number>(25)
  const [mode, setMode] = useState<"individual" | "team">("team")
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = passages.find((p) => p.id === passageId)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { id } = await createRoom({ passageId, targetWords, mode, title: title.trim() || undefined })
      router.push(`/host/${id}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="card mt-6 space-y-5 p-6">
      <label className="block">
        <span className="text-sm font-bold">지문 ({passages.length}개 승인됨)</span>
        <select
          value={passageId}
          onChange={(e) => setPassageId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2.5"
        >
          {passages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.difficultyScore ? `[난도 ${p.difficultyScore.toFixed(1)}] ` : ""}
              {p.title} — {p.wordCount}단어
              {p.questionType ? ` · ${p.questionType}` : ""}
            </option>
          ))}
        </select>
        {selected?.topic && (
          <span className="mt-1 block text-xs text-[var(--color-muted)]">주제: {selected.topic}</span>
        )}
      </label>

      <fieldset>
        <legend className="text-sm font-bold">목표 단어 수</legend>
        <div className="mt-2 flex gap-2">
          {TARGET_WORD_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTargetWords(n)}
              className={`flex-1 rounded-xl border px-3 py-2.5 font-bold ${
                targetWords === n
                  ? "border-[var(--color-brand)] bg-[var(--color-soft)] text-[var(--color-brand)]"
                  : "border-[var(--color-line)] bg-white"
              }`}
            >
              {n}단어
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-bold">진행 방식</legend>
        <div className="mt-2 flex gap-2">
          {([
            ["team", "팀 대항 (BLUE / RED)"],
            ["individual", "개인전"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold ${
                mode === v
                  ? "border-[var(--color-brand)] bg-[var(--color-soft)] text-[var(--color-brand)]"
                  : "border-[var(--color-line)] bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm font-bold">수업 이름 (선택)</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 3학년 2반 5교시"
          maxLength={40}
          className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy || !passageId}
        className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-3 font-bold text-white
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "만드는 중..." : "방 만들기"}
      </button>
      <p className="text-xs text-[var(--color-muted)]">
        진행 권한은 이 브라우저의 쿠키에 저장됩니다. 다른 기기에서는 이 방을 진행할 수 없습니다.
      </p>
    </form>
  )
}
