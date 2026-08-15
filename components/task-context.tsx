"use client"

// ============================================================
// 태스크의 문맥을 그린다. 학생 화면과 검수 화면이 **같은 것을 본다.**
//
// 검수자가 학생과 다른 화면을 보면 "학생에게 어떻게 보일까"를 상상해야 하고,
// 그 상상은 틀린다. 한 컴포넌트를 두 곳에서 쓰는 이유다.
//
// 강조는 두 종류다:
//   자극(stimulus) — 학생이 조작할 대상. 밑줄.
//   정답 범위(gold) — 유형 3 에서 되받는 이름이 가리키는 앞부분. 배경.
// 검수 화면에서만 정답 범위를 보여준다(학생에게 보이면 답을 주는 것이다).
// ============================================================

import { useCallback, useRef } from "react"

export type Span = { start: number; end: number }

/** 겹칠 수 있는 구간들을 겹치지 않는 조각으로 자른다. */
function segments(len: number, marks: { span: Span; kind: string }[]) {
  const bounds = new Set<number>([0, len])
  for (const m of marks) {
    bounds.add(Math.max(0, Math.min(len, m.span.start)))
    bounds.add(Math.max(0, Math.min(len, m.span.end)))
  }
  const points = [...bounds].sort((a, b) => a - b)
  const out: { start: number; end: number; kinds: string[] }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!
    const end = points[i + 1]!
    if (end <= start) continue
    out.push({
      start,
      end,
      kinds: marks.filter((m) => m.span.start <= start && m.span.end >= end).map((m) => m.kind),
    })
  }
  return out
}

export function TaskContext({
  context,
  stimulus,
  gold,
  selection,
  onSelect,
}: {
  context: string
  /** 자극 구간(문맥 기준) */
  stimulus: Span
  /** 정답 범위(문맥 기준). 검수 화면에서만 넘긴다 */
  gold?: Span | null
  /** 사용자가 끌어서 표시한 구간 */
  selection?: Span | null
  onSelect?: (s: Span) => void
}) {
  const ref = useRef<HTMLParagraphElement>(null)

  const handleUp = useCallback(() => {
    if (!onSelect || !ref.current) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !ref.current.contains(sel.anchorNode)) return
    const range = sel.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(ref.current)
    pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length
    onSelect({ start, end: start + sel.toString().length })
  }, [onSelect])

  const marks = [
    { span: stimulus, kind: "stimulus" },
    ...(gold ? [{ span: gold, kind: "gold" }] : []),
    ...(selection ? [{ span: selection, kind: "selection" }] : []),
  ]

  return (
    <p
      ref={ref}
      onMouseUp={handleUp}
      onTouchEnd={handleUp}
      className="whitespace-pre-wrap font-serif text-[1.05rem] leading-[1.8] text-[var(--color-ink)]"
    >
      {segments(context.length, marks).map((seg, i) => {
        const text = context.slice(seg.start, seg.end)
        if (seg.kinds.length === 0) return <span key={i}>{text}</span>
        const isStim = seg.kinds.includes("stimulus")
        const isGold = seg.kinds.includes("gold")
        const isSel = seg.kinds.includes("selection")
        return (
          <span
            key={i}
            className={[
              isStim && "font-semibold underline decoration-[var(--color-brand)] decoration-2 underline-offset-4",
              isGold && "bg-[#dcfce7]",
              isSel && "bg-[#fef08a]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {text}
          </span>
        )
      })}
    </p>
  )
}
