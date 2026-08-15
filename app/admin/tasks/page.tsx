import Link from "next/link"
import { listTasks, taskCounts } from "@/app/actions/task-review"
import TaskReviewList from "./review-list"

export const dynamic = "force-dynamic"

const STATUSES = ["raw", "approved", "rejected", "all"] as const
const TYPES = [null, 1, 2, 3] as const

export default async function TaskReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>
}) {
  const sp = await searchParams
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : "raw"
  const type = sp.type && ["1", "2", "3"].includes(sp.type) ? Number(sp.type) : null

  const [tasks, counts] = await Promise.all([listTasks(status, type), taskCounts()])
  const total = (s: string) => counts.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0)

  const link = (next: { status?: string; type?: number | null }) => {
    const q = new URLSearchParams()
    q.set("status", next.status ?? status)
    const t = next.type === undefined ? type : next.type
    if (t) q.set("type", String(t))
    return `/admin/tasks?${q.toString()}`
  }

  return (
    <main className="mx-auto max-w-[760px] px-5 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">문항 검수</h1>
        <Link href="/admin/passages" className="text-sm text-[var(--color-brand)]">
          지문 검수 →
        </Link>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        승인된 문항만 학생에게 나갑니다. 전수 검수할 필요는 없습니다 — 자습은 간격 반복이라
        유형 2 수십 건이면 시작됩니다.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={link({ status: s })}
            className={`rounded-full border px-3 py-1 ${
              s === status
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                : "border-[var(--color-line)] bg-white"
            }`}
          >
            {s === "all" ? "전체" : s} {s !== "all" && <span className="tabular-nums">{total(s)}</span>}
          </Link>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {TYPES.map((t) => (
          <Link
            key={String(t)}
            href={link({ type: t })}
            className={`rounded-full border px-3 py-1 ${
              t === type
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                : "border-[var(--color-line)] bg-white"
            }`}
          >
            {t === null ? "모든 유형" : `유형 ${t}`}
          </Link>
        ))}
      </div>

      <TaskReviewList tasks={tasks} />
    </main>
  )
}
