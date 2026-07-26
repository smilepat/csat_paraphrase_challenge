import Link from "next/link"

export default function Home() {
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold sm:text-4xl">100-Word Paraphrase Challenge</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          수능형 지문을 가장 짧고 쉬운 영어로 바꾸는 교실 활동
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/host"
          className="card block p-6 transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-lg font-bold text-[var(--color-brand)]">교사로 시작</div>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            지문과 목표 단어 수를 고르고 방을 엽니다. 6자리 코드가 발급됩니다.
          </p>
        </Link>

        <Link
          href="/join"
          className="card block p-6 transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="text-lg font-bold text-[var(--color-good)]">학생으로 참여</div>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            선생님이 알려준 6자리 코드를 입력하세요.
          </p>
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link href="/admin/passages" className="font-bold text-[var(--color-brand)]">
          지문 검수·승인
        </Link>
        <Link href="/admin/passages/new" className="font-bold text-[var(--color-brand)]">
          지문 직접 넣기
        </Link>
      </div>

      <div className="card mt-6 p-6">
        <h2 className="font-bold">기기 없이 진행하기</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          학생 기기를 쓸 수 없는 교실에서는 교사 화면 하나로 진행하는 오프라인 버전을 쓸 수
          있습니다. 인터넷·로그인 없이 동작하며 기록은 남지 않습니다.
        </p>
        <a
          href="/standalone.html"
          className="mt-3 inline-block rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-800"
        >
          오프라인 팀 대항판 열기
        </a>
      </div>
    </main>
  )
}
