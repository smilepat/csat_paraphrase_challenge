import StudyClient from "./study-client"

export const dynamic = "force-dynamic"

export default async function StudyPage({ params }: { params: Promise<{ learnerId: string }> }) {
  const { learnerId } = await params
  return <StudyClient learnerId={learnerId} />
}
