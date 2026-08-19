"use client";

// ============================================================
// 데모 화면 — 유형마다 한 문제씩, 한 번에 하나만 보여 준다.
//
// 학생 화면(study-client.tsx)과 같은 부품을 쓴다: TaskContext, 답안 틀,
// 힌트 사다리, 결과 패널. 다른 것은 이력·적응 출제가 없다는 것뿐이다.
// 부품을 새로 그리면 연수에서 본 화면과 학생이 만나는 화면이 갈라진다.
//
// ── 세미나용 배치 ────────────────────────────────────────────
// 이 화면은 대개 **빔프로젝터로 뒷자리까지** 보여야 한다. 그래서 학생용
// 한 칸짜리 배치를 그대로 쓰지 않는다:
//
//   ① 가로를 넓게 쓰고 화면이 넓으면 두 칸으로 나눈다.
//      왼쪽 = 읽을 것(지시문·지문) · 오른쪽 = 할 것(답안·힌트·채점).
//      한 칸으로 쌓으면 지문이 위로 밀려 나가 "무엇을 고치라는 것인지"가
//      화면에서 사라진다 — 발표 중에는 스크롤이 곧 흐름 끊김이다.
//   ② 글자 크기를 화면에서 바로 바꾼다. 강의실·프로젝터마다 필요한 크기가
//      다른데, 그때 개발자 도구를 여는 사람은 없다.
//
// 크기는 이 컴포넌트 뿌리의 font-size 하나로 정하고 아래는 전부 `em` 이다.
// 그래서 버튼 한 번에 지문·입력창·점수가 **같은 비율로** 커진다.
// ============================================================

import { useEffect, useState } from "react";
import { TaskContext } from "@/components/task-context";
import { Emphasis } from "@/components/emphasis";
import { answerToSubmit, fillScaffold } from "@/lib/tasks/scaffold";
import {
  demoHint,
  demoSubmit,
  type DemoResult,
  type DemoTask,
} from "@/app/actions/demo";
import type { HintStep } from "@/lib/tasks/hint";

const AXIS_NAME: Record<number, string> = {
  1: "다른 낱말로",
  2: "이름↔문장",
  3: "되받는 이름",
};

/**
 * 교사가 이미 아는 용어. 쉬운 말 이름(§27)은 그대로 두고 **아래에 병기**한다 —
 * 연수 참가자는 "명사화" 로 배웠는데 화면에 그 말이 없으면 같은 것인 줄 모른다.
 * 학생 화면에는 넣지 않는다. 학생에게 필요한 것은 용어가 아니라 할 일이다.
 */
const AXIS_TERM: Record<number, string> = {
  1: "어휘 대체",
  2: "명사화 ↔ 서술화",
  3: "지시 표현",
};

/** 화면에서 고르는 글자 크기. px 은 이 컴포넌트 안에서만 뿌리 크기로 쓰인다. */
const SIZES = [
  { key: "normal", label: "보통", px: 18 },
  { key: "large", label: "크게", px: 23 },
  { key: "huge", label: "아주 크게", px: 29 },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];
const SIZE_STORE = "pc_demo_font";

/** 유형마다 따로 들고 있는 풀이 상태. 탭을 옮겨도 쓰던 답이 사라지지 않는다. */
type Draft = {
  slots: string[];
  answer: string;
  freeWrite: boolean;
  span: { start: number; end: number } | null;
  steps: HintStep[];
  shown: number;
  result: DemoResult | null;
};

const emptyDraft: Draft = {
  slots: [],
  answer: "",
  freeWrite: false,
  span: null,
  steps: [],
  shown: 0,
  result: null,
};

const SLOT_PATTERN = /(\{\d+\})/;
const SLOT_INDEX = /^\{(\d+)\}$/;

export default function DemoClient({ tasks }: { tasks: DemoTask[] }) {
  const [at, setAt] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 기본값을 "크게" 로 둔다 — 이 화면의 기본 용도가 발표다.
  const [size, setSize] = useState<SizeKey>("large");

  // 고른 크기는 기억해 둔다. 연수 중에 새로고침하거나 뒤로 갔다 와도
  // 다시 맞추지 않아도 되게.
  useEffect(() => {
    const saved = window.localStorage.getItem(SIZE_STORE);
    if (saved && SIZES.some((s) => s.key === saved)) setSize(saved as SizeKey);
  }, []);

  function chooseSize(key: SizeKey) {
    setSize(key);
    window.localStorage.setItem(SIZE_STORE, key);
  }

  const task = tasks[at];
  if (!task) return null;
  const view = task.view;
  const draft = drafts[view.id] ?? emptyDraft;
  const rootPx = SIZES.find((s) => s.key === size)?.px ?? 23;

  function patch(next: Partial<Draft>) {
    setDrafts((d) => ({
      ...d,
      [view.id]: { ...(d[view.id] ?? emptyDraft), ...next },
    }));
  }

  const isSpanTask = view.type === 3;
  const scaffold = !draft.freeWrite && !isSpanTask ? view.scaffold : null;
  const composed = scaffold
    ? fillScaffold(scaffold.frame, draft.slots)
    : draft.answer;
  const submitted = answerToSubmit(view.type, scaffold, draft.slots, composed);
  const canSubmit = isSpanTask
    ? draft.span !== null
    : scaffold
      ? scaffold.slots.every((_, i) => (draft.slots[i] ?? "").trim().length > 0)
      : draft.answer.trim().length > 0;

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      patch({
        result: await demoSubmit(view.id, submitted, draft.span ?? undefined),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontSize: `${rootPx}px` }} data-size={size}>
      {/* 유형 고르기 + 글자 크기. 발표 중에 손댈 것은 이 줄뿐이다. */}
      <div className="mt-[0.8em] flex flex-wrap items-center gap-[0.6em]">
        <nav className="flex min-w-[18em] flex-1 gap-[0.5em]">
          {tasks.map((t, i) => (
            <button
              key={t.view.id}
              onClick={() => setAt(i)}
              aria-current={i === at}
              className={`flex-1 rounded-xl border-2 px-[0.6em] py-[0.4em] text-center ${
                i === at
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white shadow-md"
                  : "border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-brand)]"
              }`}
            >
              <span className="block text-[0.8em] font-semibold opacity-80">
                유형 {t.view.type}
              </span>
              <span className="block text-[1.05em] font-bold">
                {AXIS_NAME[t.view.type]}
              </span>
              <span className="block text-[0.7em] opacity-70">
                {AXIS_TERM[t.view.type]}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-[0.4em]" aria-label="글자 크기">
          <span className="text-[0.75em] font-semibold text-[var(--color-muted)]">
            글자
          </span>
          {SIZES.map((s) => (
            <button
              key={s.key}
              onClick={() => chooseSize(s.key)}
              aria-pressed={size === s.key}
              className={`rounded-lg border-2 px-[0.6em] py-[0.4em] text-[0.8em] font-bold ${
                size === s.key
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                  : "border-[var(--color-line)] bg-white text-[var(--color-muted)] hover:border-[var(--color-brand)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 연수 진행자용 설명. 학생 화면에는 없는 칸이다. */}
      <p
        data-testid="demo-note"
        className="mt-[0.7em] rounded-xl border-l-[0.3em] border-[var(--color-brand)] bg-white px-[0.7em] py-[0.55em] text-[0.85em] leading-snug text-[var(--color-ink)]"
      >
        {task.teacherNote}
      </p>

      {error && (
        <p className="mt-[0.8em] rounded-xl bg-[#fef2f2] p-[0.8em] text-[0.95em] text-[var(--color-team-red)]">
          {error}
        </p>
      )}

      {/* 넓은 화면에서는 읽을 것(왼쪽)과 할 것(오른쪽)을 나란히 둔다.
          좁으면 자동으로 한 칸으로 쌓인다. */}
      <div className="mt-[0.7em] grid items-start gap-[0.7em] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* ── 읽을 것 ── */}
        <section className="card p-[0.9em]">
          <p data-testid="demo-prompt" className="text-[1.05em] font-semibold">
            <Emphasis text={view.prompt} />
          </p>

          <div className="mt-[0.8em] rounded-xl bg-[var(--color-soft)] p-[0.9em] text-[1.2em]">
            <TaskContext
              context={view.context}
              stimulus={view.highlight}
              selection={draft.span}
              onSelect={
                isSpanTask && !draft.result
                  ? (s) => patch({ span: s })
                  : undefined
              }
            />
          </div>

          {view.type === 1 && view.avoidWords.length > 0 && (
            <p className="mt-[0.7em] text-[0.9em] text-[var(--color-muted)]">
              다르게 표현할 낱말:{" "}
              <span className="font-bold text-[var(--color-ink)]">
                {view.avoidWords.join(" · ")}
              </span>
            </p>
          )}
        </section>

        {/* ── 할 것 ── */}
        <section className="card space-y-[0.7em] p-[0.9em]">
          {isSpanTask ? (
            <div className="space-y-[0.5em]">
              <p className="text-[0.9em] text-[var(--color-muted)]">
                왼쪽 지문에서{" "}
                <b className="text-[var(--color-ink)]">되받는 대상</b>을
                드래그해 선택한 뒤 제출하세요.
              </p>
              {/* 고른 범위를 여기에 크게 보여 준다. 발표에서는 "무엇을 골랐는가" 가
                  채점 결과만큼 중요하고, 왼쪽 지문 아래에 작게 적으면 뒷자리에서 안 보인다. */}
              <div className="rounded-xl bg-[var(--color-soft)] p-[0.7em]">
                <p className="text-[0.75em] font-bold tracking-wide text-[var(--color-muted)]">
                  선택한 부분
                </p>
                {draft.span ? (
                  <p className="mt-[0.2em] font-serif text-[1.05em] leading-relaxed">
                    “{view.context.slice(draft.span.start, draft.span.end)}”
                  </p>
                ) : (
                  <p className="mt-[0.2em] text-[0.95em] text-[var(--color-muted)]">
                    아직 선택하지 않았습니다. 왼쪽 지문에서 드래그해 보세요.
                  </p>
                )}
              </div>
            </div>
          ) : scaffold ? (
            <div className="space-y-[0.7em]">
              {/* 틀을 그대로 보여 준다 — 어디에 무엇이 들어가는지가 먼저 보여야 한다.
                  유형 1 은 틀이 곧 왼쪽 문장이라 이름을 붙이지 않으면 지문의 반복으로 읽힌다. */}
              <p className="text-[0.75em] font-bold tracking-wide text-[var(--color-muted)]">
                이 형식에 맞춰 채우기
              </p>
              <p className="rounded-xl bg-[var(--color-soft)] p-[0.7em] font-serif text-[1.15em] leading-relaxed">
                {scaffold.frame.split(SLOT_PATTERN).map((part, i) => {
                  const m = part.match(SLOT_INDEX);
                  if (!m) return <span key={i}>{part}</span>;
                  const idx = Number(m[1]);
                  return (
                    <span
                      key={i}
                      className="mx-[0.1em] inline-block min-w-[4em] border-b-2 border-[var(--color-brand)] px-[0.2em] text-center font-semibold text-[var(--color-brand)]"
                    >
                      {draft.slots[idx]?.trim() || `(${idx + 1})`}
                    </span>
                  );
                })}
              </p>

              {scaffold.slots.map((slot, i) => (
                <label key={i} className="block">
                  <span className="text-[0.85em] font-semibold text-[var(--color-muted)]">
                    ({i + 1}) {slot.hint}
                  </span>
                  <input
                    value={draft.slots[i] ?? ""}
                    onChange={(e) => {
                      const next = [...draft.slots];
                      next[i] = e.target.value;
                      patch({ slots: next });
                    }}
                    disabled={!!draft.result}
                    className="mt-[0.3em] w-full rounded-xl border-2 border-[var(--color-line)] p-[0.5em] font-serif text-[1.05em] focus:border-[var(--color-brand)] focus:outline-none disabled:bg-slate-50"
                  />
                </label>
              ))}

              {!draft.result && (
                <button
                  onClick={() => patch({ answer: composed, freeWrite: true })}
                  className="text-[0.8em] text-[var(--color-muted)] underline"
                >
                  빈칸 없이 직접 쓰기
                </button>
              )}
            </div>
          ) : (
            <textarea
              value={draft.answer}
              onChange={(e) => patch({ answer: e.target.value })}
              rows={3}
              disabled={!!draft.result}
              placeholder="여기에 영어로 답을 쓰세요"
              className="w-full rounded-xl border-2 border-[var(--color-line)] p-[0.6em] font-serif text-[1.05em] focus:border-[var(--color-brand)] focus:outline-none disabled:bg-slate-50"
            />
          )}

          {draft.steps.slice(0, draft.shown).map((s) => (
            <div
              key={s.level}
              className="rounded-xl border-2 border-dashed border-[var(--color-brand)] bg-white p-[0.7em]"
            >
              <p className="text-[0.8em] font-bold text-[var(--color-brand)]">
                힌트 {s.level}/{draft.steps.length} · {s.label}
              </p>
              <p className="mt-[0.3em] whitespace-pre-line text-[0.95em] leading-relaxed">
                <Emphasis text={s.body} />
              </p>
            </div>
          ))}

          {!draft.result ? (
            <div className="space-y-[0.5em]">
              <button
                onClick={onSubmit}
                disabled={busy || !canSubmit}
                className="w-full rounded-xl bg-[var(--color-brand)] px-[0.8em] py-[0.7em] text-[1.05em] font-bold text-white disabled:opacity-40"
              >
                {busy ? "채점 중…" : "제출"}
              </button>
              {draft.shown < (draft.steps.length || 1) && (
                <button
                  onClick={async () => {
                    // 첫 요청에서만 서버를 부른다. 그 뒤로는 받아 둔 칸을 하나씩 연다.
                    const list = draft.steps.length
                      ? draft.steps
                      : await demoHint(view.id);
                    patch({
                      steps: list,
                      shown: Math.min(draft.shown + 1, list.length),
                    });
                  }}
                  className="w-full rounded-xl border-2 border-[var(--color-line)] px-[0.8em] py-[0.55em] text-[0.9em] font-semibold text-[var(--color-muted)]"
                >
                  {draft.shown === 0
                    ? "잘 모르겠어요 · 힌트 보기"
                    : `힌트 더 보기 (${draft.shown}/${draft.steps.length})`}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-[0.7em]">
              <div
                data-testid="demo-result"
                className={`rounded-xl p-[0.9em] ${
                  draft.result.score >= 70
                    ? "bg-[#f0fdf4]"
                    : draft.result.score > 0
                      ? "bg-[#fffbeb]"
                      : "bg-[#fef2f2]"
                }`}
              >
                <div className="flex items-baseline gap-[0.4em]">
                  <span
                    data-testid="demo-score"
                    className="text-[2.4em] font-bold leading-none tabular-nums"
                  >
                    {draft.result.score}
                  </span>
                  {draft.result.errorName && (
                    <span className="rounded-full bg-white px-[0.6em] py-[0.2em] text-[0.8em] font-bold">
                      {draft.result.errorName}
                    </span>
                  )}
                </div>
                <p className="mt-[0.5em] text-[1em] leading-relaxed">
                  <Emphasis text={draft.result.message} />
                </p>
                {draft.result.suggested && (
                  <p className="mt-[0.4em] font-serif text-[0.95em] text-[var(--color-muted)]">
                    이렇게 고쳐 쓸 수 있습니다: {draft.result.suggested}
                  </p>
                )}
                {/* 모범답안은 점수와 상관없이 나온다 — 학생 화면과 같은 규칙이다(§38) */}
                {draft.result.model && (
                  <div className="mt-[0.7em] rounded-lg bg-white p-[0.6em]">
                    <p className="text-[0.8em] font-bold text-[var(--color-brand)]">
                      모범답안
                    </p>
                    <p className="mt-[0.2em] font-serif text-[1.05em]">
                      {draft.result.model}
                    </p>
                    <p className="mt-[0.3em] text-[0.8em] text-[var(--color-muted)]">
                      정답은 하나가 아닙니다. 내가 쓴 답과 무엇이 다른지 비교해
                      보세요.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-[0.5em]">
                <button
                  onClick={() =>
                    setDrafts((d) => ({ ...d, [view.id]: emptyDraft }))
                  }
                  className="rounded-xl border-2 border-[var(--color-line)] px-[0.8em] py-[0.6em] text-[0.95em] font-bold"
                >
                  다시 풀기
                </button>
                <button
                  onClick={() =>
                    setAt((i) => Math.min(i + 1, tasks.length - 1))
                  }
                  disabled={at >= tasks.length - 1}
                  className="rounded-xl bg-[var(--color-brand)] px-[0.8em] py-[0.6em] text-[0.95em] font-bold text-white disabled:opacity-40"
                >
                  다음 유형
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
