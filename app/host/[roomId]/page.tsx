import { notFound, redirect } from "next/navigation"
import { isHost } from "@/app/actions/host"
import { hostView, listApprovedPassages } from "@/app/actions/teacher-view"
import HostDashboard from "./dashboard"

export const dynamic = "force-dynamic"

export default async function HostRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params

  if (!(await isHost(roomId))) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-16 text-center">
        <h1 className="text-xl font-bold">진행 권한이 없습니다</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          이 방은 다른 브라우저에서 만들어졌습니다. 방을 만든 기기에서 열어주세요.
        </p>
        <a href="/host" className="mt-6 inline-block rounded-xl bg-[var(--color-brand)] px-5 py-2.5 font-bold text-white">
          새 방 만들기
        </a>
      </main>
    )
  }

  const view = await hostView(roomId)
  if (!view) notFound()
  if (view.room.state === "closed") redirect(`/reports/${roomId}`)

  const passages = await listApprovedPassages()
  return <HostDashboard initial={view} passages={passages} />
}
