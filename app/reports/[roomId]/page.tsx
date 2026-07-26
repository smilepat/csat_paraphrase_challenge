import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { isHost } from "@/app/actions/host"
import type { ScoreResult } from "@/lib/scoring"

export const dynamic = "force-dynamic"

interface Row {
  round: number
  nickname: string
  team: string | null
  text: string
  words: number
  scores: ScoreResult | null
  teacherOk: number | null
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export default async function ReportPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params
  if (!(await isHost(roomId))) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-16 text-center">
        <h1 className="text-xl font-bold">이 결과를 볼 권한이 없습니다</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">방을 만든 브라우저에서 열어주세요.</p>
      </main>
    )
  }

  const roomRes = await db.execute({
    sql: "SELECT code, title, target_words, round_no, mode FROM pc_rooms WHERE id = ?",
    args: [roomId],
  })
  if (!roomRes.rows.length) notFound()
  const room = roomRes.rows[0]

  const { rows: raw } = await db.execute({
    sql: `SELECT s.round_no, p.nickname, p.team, s.text, s.word_count, s.scores, s.teacher_ok
          FROM pc_submissions s JOIN pc_players p ON p.id = s.player_id
          WHERE s.room_id = ?
          ORDER BY s.round_no, p.nickname`,
    args: [roomId],
  })

  const rows: Row[] = raw.map((r) => ({
    round: Number(r.round_no),
    nickname: String(r.nickname),
    team: r.team ? String(r.team) : null,
    text: String(r.text),
    words: Number(r.word_count),
    scores: parseJson<ScoreResult | null>(r.scores, null),
    teacherOk: r.teacher_ok !== null ? Number(r.teacher_ok) : null,
  }))

  // 학생별 집계 — 기각된 제출은 제외한다.
  const byStudent = new Map<string, { n: number; total: number; meaning: number; words: number }>()
  for (const r of rows) {
    if (!r.scores || r.teacherOk === 0) continue
    const cur = byStudent.get(r.nickname) ?? { n: 0, total: 0, meaning: 0, words: 0 }
    cur.n++
    cur.total += r.scores.total + r.scores.bonus
    cur.meaning += r.scores.meaning
    cur.words += r.words
    byStudent.set(r.nickname, cur)
  }
  const summary = [...byStudent.entries()]
    .map(([nickname, s]) => ({
      nickname, rounds: s.n,
      avgTotal: s.total / s.n, avgMeaning: s.meaning / s.n, avgWords: s.words / s.n,
    }))
    .sort((a, b) => b.avgTotal - a.avgTotal)

  const csv = [
    ["round", "nickname", "team", "words", "meaning", "brevity", "ease", "bonus", "total", "teacher_ok", "text"],
    ...rows.map((r) => [
      r.round, r.nickname, r.team ?? "", r.words,
      r.scores?.meaning ?? "", r.scores?.brevity ?? "", r.scores?.ease ?? "",
      r.scores?.bonus ?? "", r.scores ? r.scores.total + r.scores.bonus : "",
      r.teacherOk === null ? "" : r.teacherOk, `"${r.text.replace(/"/g, '""')}"`,
    ].join(",")),
  ].join("\n")

  return (
    <main className="mx-auto max-w-[1000px] px-5 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{String(room.title ?? "수업 결과")}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            코드 {String(room.code)} · {Number(room.round_no)}라운드 진행 · 목표 {Number(room.target_words)}단어
            · 제출 {rows.length}건
          </p>
        </div>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + csv)}`}
          download={`paraphrase-${String(room.code)}.csv`}
          className="rounded-xl bg-[var(--color-brand)] px-4 py-2 text-sm font-bold text-white"
        >
          CSV 내려받기
        </a>
      </header>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">학생별 요약</h2>
        {summary.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">채점된 제출이 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[var(--color-muted)]">
                <tr>
                  <th className="py-1.5 pr-3">이름</th>
                  <th className="py-1.5 pr-3 text-right">참여 라운드</th>
                  <th className="py-1.5 pr-3 text-right">평균 총점</th>
                  <th className="py-1.5 pr-3 text-right">평균 핵심 보존</th>
                  <th className="py-1.5 text-right">평균 단어 수</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.nickname} className="border-t border-[var(--color-line)]">
                    <td className="py-1.5 pr-3">{s.nickname}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.rounds}</td>
                    <td className="py-1.5 pr-3 text-right font-bold tabular-nums">{s.avgTotal.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.avgMeaning.toFixed(1)} / 50</td>
                    <td className="py-1.5 text-right tabular-nums">{s.avgWords.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-4 p-5">
        <h2 className="font-bold">제출 전체</h2>
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <article key={i} className="rounded-xl border border-[var(--color-line)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <strong>
                  {r.round}R · {r.nickname}
                  {r.teacherOk === 0 && <span className="ml-2 text-[var(--color-team-red)]">기각</span>}
                </strong>
                <span className="text-[var(--color-muted)]">
                  {r.words}단어
                  {r.scores && ` · 총 ${(r.scores.total + r.scores.bonus).toFixed(1)}점`}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed">{r.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
