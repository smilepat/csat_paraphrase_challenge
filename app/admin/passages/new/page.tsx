"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { createCustomPassage } from "@/app/actions/custom-passage"
import { wordCount } from "@/lib/scoring/text"

export default function NewPassagePage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [topic, setTopic] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ propositions: string[]; modelAnswers: string[] } | null>(null)

  const words = wordCount(body)
  const lengthOk = words >= 60 && words <= 250

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await createCustomPassage({ title, body, topic })
      if (!res.ok) {
        setError(res.error ?? "저장하지 못했습니다.")
        return
      }
      if (res.error) setError(res.error)
      setResult({ propositions: res.propositions ?? [], modelAnswers: res.modelAnswers ?? [] })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <main className="mx-auto max-w-[760px] px-5 py-10">
        <h1 className="text-2xl font-bold">지문을 저장했습니다</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          아래 채점 기준을 검수 화면에서 확인·수정한 뒤 승인하면 수업에 쓸 수 있습니다.
        </p>
        {error && (
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>
        )}

        <section className="card mt-5 p-5">
          <h2 className="font-bold">핵심 명제 ({result.propositions.length}개)</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {result.propositions.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
          <h2 className="mt-4 font-bold">모범 답안 ({result.modelAnswers.length}개)</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {result.modelAnswers.map((m, i) => (
              <li key={i}>· {m} <span className="text-[var(--color-muted)]">({wordCount(m)}단어)</span></li>
            ))}
          </ul>
        </section>

        <div className="mt-5 flex gap-2">
          <Link
            href="/admin/passages?status=draft"
            className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 font-bold text-white"
          >
            검수하러 가기
          </Link>
          <button
            onClick={() => {
              setResult(null); setTitle(""); setBody(""); setTopic(""); setError(null)
              router.refresh()
            }}
            className="rounded-xl bg-slate-200 px-5 py-2.5 font-bold text-slate-700"
          >
            지문 하나 더 넣기
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[760px] px-5 py-10">
      <h1 className="text-2xl font-bold">지문 직접 넣기</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        교과서·부교재 지문을 넣으면 채점 기준(핵심 명제·모범 답안)을 자동으로 만들어 줍니다.
        검수 후 승인해야 수업에 노출됩니다.
      </p>
      <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        넣으시는 지문의 이용 권한은 선생님이 확인해 주세요. 이 앱은 저작권을 대신 판단하지 않습니다.
      </p>

      <form onSubmit={onSubmit} className="card mt-5 space-y-4 p-6">
        <label className="block">
          <span className="text-sm font-bold">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: Lesson 5 — Why We Sleep"
            maxLength={80}
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold">영어 지문</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="Paste the English passage here."
            className="mt-1 w-full rounded-xl border-2 border-[var(--color-line)] p-4 leading-relaxed
                       focus:border-[var(--color-brand)] focus:outline-none"
          />
          <span
            className={`mt-1 block text-xs ${
              body && !lengthOk ? "font-bold text-[var(--color-warn)]" : "text-[var(--color-muted)]"
            }`}
          >
            {words}단어 · 60~250단어 (100~150단어가 이 활동에 가장 잘 맞습니다)
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-bold">주제 (선택 — 비우면 자동 생성)</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={20}
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2.5"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !title.trim() || !lengthOk}
          className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-3 font-bold text-white
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "채점 기준 만드는 중... (10초쯤 걸립니다)" : "저장하고 채점 기준 만들기"}
        </button>
      </form>
    </main>
  )
}
