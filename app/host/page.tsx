import { listApprovedPassages } from "@/app/actions/teacher-view"
import CreateRoomForm from "./create-form"

export const dynamic = "force-dynamic"

export default async function HostPage() {
  const passages = await listApprovedPassages()

  if (passages.length === 0) {
    return (
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="text-2xl font-bold">수업 시작</h1>
        <div className="card mt-6 p-6">
          <p className="font-bold">아직 승인된 지문이 없습니다.</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            채점 기준(핵심 명제·모범 답안)이 검수를 통과한 지문만 수업에 쓸 수 있습니다.
            검수 화면에서 확인·승인해 주세요.
          </p>
          <a
            href="/admin/passages"
            className="mt-4 inline-block rounded-xl bg-[var(--color-brand)] px-4 py-2 font-bold text-white"
          >
            지문 검수하러 가기
          </a>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <h1 className="text-2xl font-bold">수업 시작</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        지문과 목표 단어 수를 고르면 6자리 참여 코드가 발급됩니다.
      </p>
      <CreateRoomForm passages={passages} />
    </main>
  )
}
