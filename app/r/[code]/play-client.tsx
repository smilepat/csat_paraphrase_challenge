"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSession } from "@/lib/identity"
import { remainingMs, reviewState } from "@/lib/rooms"
import { wordCount } from "@/lib/scoring/text"
import { playerView, submitAnswer, type PlayerView } from "@/app/actions/play"

const POLL_MS = 3000

export default function PlayClient({ code }: { code: string }) {
  const router = useRouter()
  const [session] = useState(() => getSession(code))
  const [view, setView] = useState<PlayerView | null>(null)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // 부정행위 차단이 아니라 교사 화면에 표시할 신호로만 쓴다.
  const pasteCount = useRef(0)
  const editCount = useRef(0)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    if (!session) router.replace(`/join?code=${code}`)
  }, [session, code, router])

  const refresh = useCallback(async () => {
    if (!session) return
    try {
      const v = await playerView(code, session.playerId)
      setView(v)
      // 라운드가 바뀌면 입력창을 비운다
      setText((prev) => (v?.mySubmission ? v.mySubmission.text : prev))
    } catch {
      /* 폴링 실패는 조용히 넘긴다 — 다음 주기에 다시 시도한다 */
    }
  }, [code, session])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // 라운드가 바뀌면 입력·카운터 초기화
  const roundKey = `${view?.room.roundNo}-${view?.room.passageId}`
  const prevRound = useRef(roundKey)
  useEffect(() => {
    if (prevRound.current !== roundKey) {
      prevRound.current = roundKey
      if (!view?.mySubmission) {
        setText("")
        pasteCount.current = 0
        editCount.current = 0
        startedAt.current = null
      }
    }
  }, [roundKey, view?.mySubmission])

  if (!session) return null
  if (!view) {
    return <Shell><p className="text-[var(--color-muted)]">불러오는 중...</p></Shell>
  }

  const { room, passage, mySubmission } = view
  const words = wordCount(text)
  const left = remainingMs(room.writingEndsAt, now)
  const submitted = Boolean(mySubmission)

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      const res = await submitAnswer({
        code,
        playerId: session!.playerId,
        text,
        pasteCount: pasteCount.current,
        editCount: editCount.current,
        elapsedMs: startedAt.current ? Date.now() - startedAt.current : 0,
      })
      if (!res.ok) setError(res.error ?? "제출하지 못했습니다.")
      else if (res.error) setError(res.error) // 저장은 됐지만 채점 지연
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm text-[var(--color-muted)]">
            {session.nickname} · {room.roundNo}라운드
          </span>
          <h1 className="text-xl font-bold">{room.title ?? "Paraphrase Challenge"}</h1>
        </div>
        <div className="text-right text-sm text-[var(--color-muted)]">
          <div>{view.submittedCount}/{view.playerCount}명 제출</div>
          {left !== null && room.state === "writing" && (
            <div className={left < 30000 ? "font-bold text-[var(--color-team-red)]" : ""}>
              남은 시간 {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}
            </div>
          )}
        </div>
      </header>

      {room.state === "lobby" && (
        <Card>
          <h2 className="font-bold">잠시만 기다리세요</h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            선생님이 시작하면 지문이 나타납니다.
          </p>
        </Card>
      )}

      {(room.state === "writing" || room.state === "scoring") && passage && (
        <>
          <Card>
            <div className="mb-2 flex flex-wrap gap-2 text-sm text-[var(--color-muted)]">
              <span className="rounded-full bg-[var(--color-soft)] px-3 py-1">
                원문 {passage.wordCount}단어
              </span>
              {passage.topic && (
                <span className="rounded-full bg-[var(--color-soft)] px-3 py-1">{passage.topic}</span>
              )}
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
                목표 {room.targetWords}단어 이하
              </span>
            </div>
            <p className="rounded-xl border-l-[6px] border-[var(--color-brand)] bg-slate-50 p-4
                          text-[17px] leading-relaxed whitespace-pre-wrap">
              {passage.body}
            </p>
          </Card>

          <Card className="mt-4">
            {submitted ? (
              <>
                <h2 className="font-bold text-[var(--color-good)]">제출 완료</h2>
                <p className="mt-2 rounded-xl bg-slate-50 p-4 leading-relaxed">
                  {mySubmission!.text}
                </p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  {mySubmission!.words}단어 · 결과는 선생님이 공개하면 보입니다.
                </p>
              </>
            ) : (
              <>
                <h2 className="font-bold">가장 짧고 쉽게 바꿔 쓰기</h2>
                <textarea
                  value={text}
                  onChange={(e) => {
                    if (startedAt.current === null) startedAt.current = Date.now()
                    editCount.current += 1
                    setText(e.target.value)
                  }}
                  onPaste={() => { pasteCount.current += 1 }}
                  disabled={room.state !== "writing"}
                  placeholder="Write one or two short, easy sentences."
                  className="mt-2 min-h-[130px] w-full rounded-xl border-2 border-[var(--color-line)]
                             p-4 leading-relaxed focus:border-[var(--color-brand)] focus:outline-none
                             disabled:bg-slate-50"
                />
                <div className="mt-2 flex justify-between text-sm">
                  <span className={words > room.targetWords ? "font-bold text-[var(--color-warn)]" : "text-[var(--color-muted)]"}>
                    {words}단어
                  </span>
                  <span className="text-[var(--color-muted)]">목표 {room.targetWords}단어 이하</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-gradient-to-r from-green-500 via-yellow-400 to-red-500 transition-all"
                    style={{ width: `${Math.min(100, (words / room.targetWords) * 100)}%` }}
                  />
                </div>

                {error && (
                  <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  onClick={onSubmit}
                  disabled={busy || !text.trim() || room.state !== "writing"}
                  className="mt-4 w-full rounded-xl bg-[var(--color-brand)] px-4 py-3 font-bold text-white
                             disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "제출 중..." : "제출하기"}
                </button>
              </>
            )}
          </Card>
        </>
      )}

      {room.state === "review" && (
        <Card>
          <h2 className="font-bold">결과</h2>
          {!mySubmission ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">이번 라운드는 제출하지 않았습니다.</p>
          ) : !mySubmission.scores ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">채점 중입니다...</p>
          ) : mySubmission.teacherOk === 0 ? (
            <>
              <p className="mt-2 rounded-xl bg-slate-50 p-4 leading-relaxed">{mySubmission.text}</p>
              <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                이 답안은 점수에 반영되지 않았습니다. 선생님께 확인하세요.
              </p>
            </>
          ) : reviewState(mySubmission.scores, mySubmission.teacherOk) === "pending" ? (
            <>
              <p className="mt-2 rounded-xl bg-slate-50 p-4 leading-relaxed">{mySubmission.text}</p>
              <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                선생님이 확인 중입니다. 점수는 확인 뒤에 나옵니다.
              </p>
              <ul className="mt-2 space-y-2">
                {mySubmission.scores.flags.map((f, i) => (
                  <li key={i} className="text-sm text-[var(--color-muted)]">{f.message}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="mt-2 rounded-xl bg-slate-50 p-4 leading-relaxed">{mySubmission.text}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ScoreBox label="핵심 보존" value={mySubmission.scores.meaning} max={50} />
                <ScoreBox label="짧게 쓰기" value={mySubmission.scores.brevity} max={25} />
                <ScoreBox label="쉬운 표현" value={mySubmission.scores.ease} max={25} />
                <ScoreBox label="총점" value={mySubmission.scores.total} max={100} highlight />
              </div>

              {mySubmission.scores.flags.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {mySubmission.scores.flags.map((f, i) => (
                    <li key={i} className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {f.message}
                    </li>
                  ))}
                </ul>
              )}

              {room.revealFeedback && mySubmission.verdict?.koreanFeedback && (
                <div className="mt-4 rounded-xl bg-[var(--color-soft)] p-4">
                  <p className="text-sm leading-relaxed">{mySubmission.verdict.koreanFeedback}</p>
                  {mySubmission.verdict.suggestedShorter && (
                    <p className="mt-2 text-sm text-[var(--color-muted)]">
                      더 짧게: <em>{mySubmission.verdict.suggestedShorter}</em>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {room.state === "closed" && (
        <Card>
          <h2 className="font-bold">수업이 끝났습니다</h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">참여해 주셔서 고맙습니다.</p>
        </Card>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[760px] px-4 py-6">{children}</main>
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`card p-5 ${className}`}>{children}</section>
}

function ScoreBox({
  label, value, max, highlight = false,
}: { label: string; value: number; max: number; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 text-center ${
        highlight ? "border-[var(--color-brand)] bg-[var(--color-soft)]" : "border-[var(--color-line)] bg-slate-50"
      }`}
    >
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-[var(--color-muted)]">/ {max}</div>
    </div>
  )
}
