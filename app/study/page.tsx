"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { deviceToken } from "@/lib/identity"
import { enterStudy } from "@/app/actions/study"

export default function StudyEntry() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [nickname, setNickname] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await enterStudy(code, nickname, deviceToken())
      if (!res.ok || !res.learnerId) {
        setError(res.error ?? "입장하지 못했습니다.")
        return
      }
      window.localStorage.setItem("pc_study_learner", res.learnerId)
      router.push(`/study/${res.learnerId}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-[420px] px-5 py-12">
      <h1 className="text-2xl font-bold">혼자 연습하기</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        하루 5분. 같은 말을 다르게 하는 연습을 합니다.
      </p>

      <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
        <label className="block">
          <span className="text-sm font-semibold">초대 코드</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="선생님께 받은 코드"
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2"
            autoCapitalize="characters"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold">이름</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={12}
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-[var(--color-team-red)]">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "여는 중…" : "시작하기"}
        </button>
      </form>

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        같은 기기에서 다시 오면 이어서 합니다.
      </p>
    </main>
  )
}
