import Link from "next/link"
import { demoTasks } from "@/app/actions/demo"
import DemoClient from "./demo-client"

// 서버에서 문항을 만들어 넘긴다. DB 를 타지 않으므로 검수 상태와 무관하게 항상 뜬다 —
// 연수는 다시 못 하는데 "낼 문항이 없습니다" 가 뜨면 그걸로 끝이다.
//
// 너비는 학생 화면(640px)이 아니라 **발표 화면** 기준이다. 빔프로젝터는 대개 가로가
// 남고 세로가 모자라므로, 가로를 넓게 쓰고 세로 스크롤을 줄이는 쪽이 잘 보인다.
export const metadata = { title: "유형 데모 — 세 가지 바꿔 말하기" }

export default async function DemoPage() {
  const tasks = await demoTasks()

  return (
    <main className="mx-auto w-full max-w-[1500px] px-[clamp(1rem,3vw,2.5rem)] py-[clamp(0.75rem,1.5vh,1.75rem)]">
      <header>
        <Link href="/" className="text-sm text-[var(--color-muted)] hover:underline">
          ← 처음으로
        </Link>
        <h1 className="mt-1 text-[clamp(1.35rem,2.4vw,2.1rem)] font-bold leading-tight">
          바꿔 말하기 세 유형 — 한 문제씩
        </h1>
        <p className="mt-1 max-w-[80ch] text-[clamp(0.85rem,1vw,1.05rem)] leading-snug text-[var(--color-muted)]">
          수능 지문에서 바꿔 말하기는 한 가지가 아니라 <b>세 가지</b>입니다. 각 유형이 무엇을
          요구하는지 한 문제씩 직접 풀어 보세요. 학생이 보는 화면·채점기와 같은 것입니다.
        </p>
      </header>

      <DemoClient tasks={tasks} />

      <footer className="mt-6 rounded-xl bg-[var(--color-soft)] p-4 text-sm leading-relaxed text-[var(--color-muted)]">
        여기 실린 영어 지문은 <b>이 데모를 위해 새로 쓴 것</b>입니다. 수능 기출 원문은 학생용
        문항에만 쓰이고 공개 화면에는 올리지 않습니다. 이 페이지의 답안은 <b>기록되지 않습니다</b> —
        점수도 남지 않고 학습 이력에도 들어가지 않습니다.
      </footer>
    </main>
  )
}
