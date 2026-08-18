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

      {/* 데모가 맨 위에 있는 이유: 연수에서 처음 만나는 사람은 방을 열 것도, 코드도 없다.
          로그인·승인 없이 바로 만져 볼 수 있는 것이 하나는 있어야 한다. */}
      <Link
        href="/demo"
        className="card mb-4 block border-2 border-[var(--color-brand)] p-6 transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-[var(--color-brand)]">
            바꿔 말하기 세 유형 — 한 문제씩 풀어 보기
          </span>
          <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[11px] font-bold text-white">
            로그인 없이
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          ①같은 개념 다른 낱말 ②문장↔이름(명사화) ③앞을 되받는 이름. 학생이 보는 화면·채점기로
          유형마다 한 문제씩 직접 풀어 봅니다. 교사 연수용이라 기록은 남지 않습니다.
        </p>
      </Link>

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
