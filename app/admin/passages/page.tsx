import { listPassages, statusCounts } from "@/app/actions/admin"
import ReviewList from "./review-list"

export const dynamic = "force-dynamic"

const TABS = [
  ["draft", "검수 대기"],
  ["approved", "승인됨"],
  ["raw", "보강 전"],
  ["rejected", "제외됨"],
] as const

export default async function AdminPassagesPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const { status = "draft" } = await searchParams
  const [passages, counts] = await Promise.all([listPassages(status), statusCounts()])

  return (
    <main className="mx-auto max-w-[900px] px-5 py-8">
      <h1 className="text-2xl font-bold">지문 검수</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        핵심 명제와 모범 답안이 채점 기준이 됩니다. 명제가 부정확하면 채점 전체가 흔들리므로,
        확인·수정한 뒤 승인한 지문만 수업에 노출됩니다.
      </p>

      <nav className="mt-5 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <a
            key={key}
            href={`/admin/passages?status=${key}`}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${
              status === key
                ? "bg-[var(--color-brand)] text-white"
                : "border border-[var(--color-line)] bg-white"
            }`}
          >
            {label} {counts[key] ?? 0}
          </a>
        ))}
      </nav>

      {passages.length === 0 ? (
        <p className="card mt-5 p-6 text-sm text-[var(--color-muted)]">
          이 상태의 지문이 없습니다.
          {status === "raw" && " (보강: npm run db:enrich)"}
        </p>
      ) : (
        <ReviewList passages={passages} />
      )}
    </main>
  )
}
