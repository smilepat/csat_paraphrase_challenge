"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { remainingMs, type RoomState } from "@/lib/rooms"
import {
  reviewSubmission, setRevealFeedback, setRoomPassage, setRoomState,
} from "@/app/actions/host"
import { scoreRound } from "@/app/actions/play"
import { hostView, type HostRow, type HostView, type PassageOption } from "@/app/actions/teacher-view"

const POLL_MS = 2000

export default function HostDashboard({
  initial, passages,
}: { initial: HostView; passages: PassageOption[] }) {
  const [view, setView] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [writingSeconds, setWritingSeconds] = useState(300)
  const roomId = initial.room.id

  const refresh = useCallback(async () => {
    try {
      const v = await hostView(roomId)
      if (v) setView(v)
    } catch {
      /* 폴링 실패는 다음 주기에 회복된다 */
    }
  }, [roomId])

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const { room, passage, rows, teamScores } = view
  const submitted = rows.filter((r) => r.submissionId)
  const left = remainingMs(room.writingEndsAt, now)

  const ranked = useMemo(
    () =>
      [...submitted]
        .filter((r) => r.scores)
        .sort((a, b) => (b.scores!.total + b.scores!.bonus) - (a.scores!.total + a.scores!.bonus)),
    [submitted],
  )
  const flagged = submitted.filter((r) => r.scores?.needsReview && r.teacherOk === null)

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-5">
      <TopBar
        room={room}
        left={left}
        submitted={submitted.length}
        total={rows.length}
      />

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Controls
            room={room}
            busy={busy}
            writingSeconds={writingSeconds}
            setWritingSeconds={setWritingSeconds}
            passages={passages}
            onTransition={(to: RoomState) =>
              run(to, async () => {
                // scoring 으로 넘어갈 때 라운드 배치 판정을 돌린다.
                await setRoomState(roomId, to, to === "writing" ? { writingSeconds } : {})
                if (to === "scoring") {
                  await scoreRound(roomId)
                  await setRoomState(roomId, "review")
                }
              })
            }
            onPassage={(id: string) => run("passage", () => setRoomPassage(roomId, id))}
            onReveal={(v: boolean) => run("reveal", () => setRevealFeedback(roomId, v))}
          />

          {flagged.length > 0 && (
            <FlaggedPanel
              rows={flagged}
              busy={busy}
              onReview={(sid, ok) => run(sid, () => reviewSubmission(roomId, sid, ok))}
            />
          )}

          {room.state === "review" && ranked.length > 0 && passage && (
            <BestAnswers rows={ranked.slice(0, 3)} passage={passage} />
          )}

          <Roster rows={rows} state={room.state} />
        </div>

        <aside className="space-y-4">
          <JoinCard code={room.code} />
          {room.mode === "team" && <TeamScores scores={teamScores} />}
          {passage && <PassageCard passage={passage} targetWords={room.targetWords} />}
          <UsageCard usage={view.usageToday} />
        </aside>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------- 상단
function TopBar({
  room, left, submitted, total,
}: { room: HostView["room"]; left: number | null; submitted: number; total: number }) {
  const STATE_LABEL: Record<RoomState, string> = {
    lobby: "대기", writing: "작성 중", scoring: "채점 중", review: "결과 공개", closed: "종료",
  }
  return (
    <header className="card mb-4 flex flex-wrap items-center justify-between gap-4 p-4">
      <div>
        <div className="text-sm text-[var(--color-muted)]">
          {room.title ?? "Paraphrase Challenge"} · {room.roundNo}라운드 · 목표 {room.targetWords}단어
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold">{STATE_LABEL[room.state]}</span>
          {left !== null && room.state === "writing" && (
            <span className={`text-xl font-bold tabular-nums ${left < 30000 ? "text-[var(--color-team-red)]" : ""}`}>
              {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-3xl font-bold tabular-nums">
          {submitted}<span className="text-lg text-[var(--color-muted)]">/{total}</span>
        </div>
        <div className="text-sm text-[var(--color-muted)]">제출</div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------- 진행 제어
function Controls({
  room, busy, writingSeconds, setWritingSeconds, passages, onTransition, onPassage, onReveal,
}: {
  room: HostView["room"]
  busy: string | null
  writingSeconds: number
  setWritingSeconds: (n: number) => void
  passages: PassageOption[]
  onTransition: (to: RoomState) => void
  onPassage: (id: string) => void
  onReveal: (v: boolean) => void
}) {
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {room.state === "lobby" && (
          <>
            <label className="text-sm">
              제한 시간
              <select
                value={writingSeconds}
                onChange={(e) => setWritingSeconds(Number(e.target.value))}
                className="ml-2 rounded-lg border border-[var(--color-line)] px-2 py-1.5"
              >
                <option value={0}>없음</option>
                <option value={180}>3분</option>
                <option value={300}>5분</option>
                <option value={480}>8분</option>
              </select>
            </label>
            <button
              onClick={() => onTransition("writing")}
              disabled={busy !== null || !room.passageId}
              className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              라운드 시작
            </button>
          </>
        )}

        {room.state === "writing" && (
          <button
            onClick={() => onTransition("scoring")}
            disabled={busy !== null}
            className="rounded-xl bg-[var(--color-good)] px-5 py-2.5 font-bold text-white disabled:opacity-40"
          >
            {busy === "scoring" ? "채점 중..." : "마감하고 채점"}
          </button>
        )}

        {room.state === "review" && (
          <>
            <button
              onClick={() => onTransition("lobby")}
              disabled={busy !== null}
              className="rounded-xl bg-[var(--color-brand)] px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              다음 라운드
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={room.revealFeedback}
                onChange={(e) => onReveal(e.target.checked)}
                className="size-4"
              />
              학생에게 AI 피드백 공개
            </label>
          </>
        )}

        <div className="ml-auto">
          <button
            onClick={() => onTransition("closed")}
            disabled={busy !== null}
            className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-40"
          >
            수업 종료
          </button>
        </div>
      </div>

      {room.state === "lobby" && (
        <label className="mt-3 block text-sm">
          지문
          <select
            value={room.passageId ?? ""}
            onChange={(e) => onPassage(e.target.value)}
            disabled={busy !== null}
            className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2"
          >
            {passages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.difficultyScore ? `[난도 ${p.difficultyScore.toFixed(1)}] ` : ""}{p.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- 플래그
function FlaggedPanel({
  rows, busy, onReview,
}: { rows: HostRow[]; busy: string | null; onReview: (sid: string, ok: boolean) => void }) {
  return (
    <section className="card border-amber-300 bg-amber-50/40 p-4">
      <h2 className="font-bold text-amber-900">확인이 필요한 제출 {rows.length}건</h2>
      <p className="mt-1 text-sm text-amber-800">
        자동 채점이 판단을 보류했습니다. 인정 여부는 선생님이 정합니다.
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.submissionId} className="rounded-xl border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>{r.nickname}</strong>
              <span className="text-sm text-[var(--color-muted)]">
                {r.words}단어 · {r.scores?.total.toFixed(1)}점
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed">{r.text}</p>
            {r.scores?.flags.map((f, i) => (
              <p key={i} className="mt-2 text-sm text-amber-900">
                {f.message}
                {f.evidence && (
                  <em className="mt-0.5 block text-xs text-[var(--color-muted)]">
                    “{f.evidence.slice(0, 120)}”
                  </em>
                )}
              </p>
            ))}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onReview(r.submissionId!, true)}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--color-good)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              >
                인정
              </button>
              <button
                onClick={() => onReview(r.submissionId!, false)}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--color-team-red)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              >
                기각
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- 베스트 비교
function BestAnswers({
  rows, passage,
}: { rows: HostRow[]; passage: NonNullable<HostView["passage"]> }) {
  return (
    <section className="card p-4">
      <h2 className="font-bold">베스트 답안 비교</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        원문 {passage.wordCount}단어를 각자 몇 단어로 줄였는지 함께 봅니다.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {rows.map((r, i) => (
          <article key={r.submissionId} className="rounded-xl border border-[var(--color-line)] p-3">
            <div className="flex items-baseline justify-between">
              <strong>{i + 1}위 {r.nickname}</strong>
              <span className="text-lg font-bold">{(r.scores!.total + r.scores!.bonus).toFixed(1)}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed">{r.text}</p>
            <div className="mt-2 text-xs text-[var(--color-muted)]">
              {r.words}단어 · 핵심 {r.scores!.meaning} / 간결 {r.scores!.brevity} / 쉬움 {r.scores!.ease}
              {r.scores!.bonus > 0 && <span className="text-[var(--color-good)]"> · 초간결 +{r.scores!.bonus}</span>}
            </div>
          </article>
        ))}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-bold">핵심 명제 · 예시 답안 보기</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {passage.propositions.map((p, i) => <li key={i}>{p}</li>)}
        </ol>
        <ul className="mt-3 space-y-1 text-sm text-[var(--color-muted)]">
          {passage.modelAnswers.map((m, i) => <li key={i}>· {m}</li>)}
        </ul>
      </details>
    </section>
  )
}

// ---------------------------------------------------------------- 명단
function Roster({ rows, state }: { rows: HostRow[]; state: RoomState }) {
  const sorted = [...rows].sort((a, b) => {
    const at = a.scores ? a.scores.total + a.scores.bonus : -1
    const bt = b.scores ? b.scores.total + b.scores.bonus : -1
    return bt - at
  })
  return (
    <section className="card p-4">
      <h2 className="font-bold">참가자 {rows.length}명</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          아직 아무도 들어오지 않았습니다. 오른쪽 참여 코드를 칠판에 띄우세요.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--color-muted)]">
              <tr>
                <th className="py-1.5 pr-3">이름</th>
                <th className="py-1.5 pr-3">상태</th>
                <th className="py-1.5 pr-3 text-right">단어</th>
                <th className="py-1.5 pr-3 text-right">핵심</th>
                <th className="py-1.5 pr-3 text-right">간결</th>
                <th className="py-1.5 pr-3 text-right">쉬움</th>
                <th className="py-1.5 text-right">총점</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.playerId} className="border-t border-[var(--color-line)]">
                  <td className="py-1.5 pr-3">
                    {r.team && (
                      <span
                        className={`mr-1.5 inline-block size-2 rounded-full ${
                          r.team === "blue" ? "bg-[var(--color-brand)]" : "bg-[var(--color-team-red)]"
                        }`}
                      />
                    )}
                    {r.nickname}
                    {r.teacherOk === 0 && (
                      <span className="ml-1.5 text-xs text-[var(--color-team-red)]">기각</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {!r.submissionId ? (
                      <span className="text-[var(--color-muted)]">
                        {state === "writing" ? "작성 중" : "미제출"}
                      </span>
                    ) : r.scores ? (
                      <span className="text-[var(--color-good)]">채점됨</span>
                    ) : (
                      <span className="text-[var(--color-warn)]">제출됨</span>
                    )}
                    {r.pasteCount > 0 && (
                      <span title="붙여넣기 감지" className="ml-1.5 text-xs text-[var(--color-warn)]">
                        붙여넣기 {r.pasteCount}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.words ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.scores?.meaning ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.scores?.brevity ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.scores?.ease ?? "—"}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums">
                    {r.scores ? (r.scores.total + r.scores.bonus).toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- 사이드
function JoinCard({ code }: { code: string }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/join?code=${code}` : ""
  return (
    <section className="card p-5 text-center">
      <div className="text-sm text-[var(--color-muted)]">참여 코드</div>
      <div className="my-2 text-5xl font-bold tracking-[0.15em]">{code}</div>
      <div className="text-sm text-[var(--color-muted)]">
        학생은 <strong>/join</strong> 에서 이 코드를 입력합니다
      </div>
      {url && (
        <button
          onClick={() => navigator.clipboard?.writeText(url)}
          className="mt-3 w-full rounded-xl bg-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
        >
          참여 링크 복사
        </button>
      )}
    </section>
  )
}

function TeamScores({ scores }: { scores: { blue: number; red: number } }) {
  return (
    <section className="card p-4">
      <h2 className="font-bold">팀 점수 (누적)</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[var(--color-brand)] p-4 text-white">
          <div className="text-sm opacity-90">BLUE</div>
          <div className="text-3xl font-extrabold tabular-nums">{Math.round(scores.blue)}</div>
        </div>
        <div className="rounded-2xl bg-[var(--color-team-red)] p-4 text-white">
          <div className="text-sm opacity-90">RED</div>
          <div className="text-3xl font-extrabold tabular-nums">{Math.round(scores.red)}</div>
        </div>
      </div>
    </section>
  )
}

function PassageCard({
  passage, targetWords,
}: { passage: NonNullable<HostView["passage"]>; targetWords: number }) {
  return (
    <section className="card p-4">
      <h2 className="font-bold">{passage.title}</h2>
      <div className="mt-1 text-sm text-[var(--color-muted)]">
        원문 {passage.wordCount}단어 → 목표 {targetWords}단어
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-bold">지문 보기</summary>
        <p className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
          {passage.body}
        </p>
      </details>
    </section>
  )
}

function UsageCard({ usage }: { usage: HostView["usageToday"] }) {
  if (!usage.length) return null
  return (
    <section className="card p-4">
      <h2 className="text-sm font-bold">오늘 API 사용</h2>
      <ul className="mt-2 space-y-1 text-sm text-[var(--color-muted)]">
        {usage.map((u) => (
          <li key={u.kind} className="flex justify-between">
            <span>{u.kind === "embed" ? "임베딩" : u.kind === "verdict" ? "판정" : u.kind}</span>
            <span className="tabular-nums">{u.calls}콜 / {u.items}건</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
