"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { isValidCode, normalizeCode } from "@/lib/codes"
import { deviceToken, saveSession } from "@/lib/identity"
import { joinRoom } from "@/app/actions/play"

function JoinForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [code, setCode] = useState(params.get("code") ?? "")
  const [nickname, setNickname] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const normalized = normalizeCode(code)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await joinRoom(normalized, nickname, deviceToken())
      if (!res.ok || !res.playerId) {
        setError(res.error ?? "입장하지 못했습니다.")
        return
      }
      saveSession({
        code: normalized,
        playerId: res.playerId,
        nickname: res.nickname!,
        deviceToken: deviceToken(),
      })
      router.push(`/r/${normalized}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-[420px] px-5 py-12">
      <h1 className="text-2xl font-bold">수업 참여</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        선생님 화면에 있는 6자리 코드를 입력하세요.
      </p>

      <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
        <label className="block">
          <span className="text-sm font-bold">참여 코드</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC234"
            autoCapitalize="characters"
            autoComplete="off"
            className="mt-1 w-full rounded-xl border-2 border-[var(--color-line)] px-4 py-3
                       text-center text-2xl font-bold tracking-[0.3em] uppercase
                       focus:border-[var(--color-brand)] focus:outline-none"
          />
          <span className="mt-1 block text-xs text-[var(--color-muted)]">
            숫자 0·1과 알파벳 I·L·O는 쓰지 않습니다
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-bold">이름</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 김민수"
            maxLength={12}
            className="mt-1 w-full rounded-xl border-2 border-[var(--color-line)] px-4 py-3
                       focus:border-[var(--color-brand)] focus:outline-none"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !isValidCode(normalized) || !nickname.trim()}
          className="w-full rounded-xl bg-[var(--color-brand)] px-4 py-3 font-bold text-white
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "입장 중..." : "입장하기"}
        </button>
      </form>
    </main>
  )
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  )
}
