#!/usr/bin/env node
// ============================================================
// M8 — 지문에서 유형별 태스크 후보를 채굴해 pc_tasks 에 넣는다.
//
//   npm run tasks:mine            # 채굴 후 요약 출력
//   npm run tasks:mine -- --dry   # DB 를 건드리지 않고 개수만
//   npm run tasks:verify          # 오프셋 무결성 검사
//
// LLM 을 호출하지 않는다(비용 0). 결과는 전부 review_status='raw' 이며
// 사람이 승인해야 학생에게 나간다.
// ============================================================
import { readFileSync } from "node:fs"
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"
import { minePassage } from "../lib/tasks/mine.ts"
import { splitSummaryBlock } from "../lib/tasks/segment.ts"

loadEnv()

const dry = process.argv.includes("--dry")
// --local 은 .env.local 의 TURSO 설정을 무시하고 개발용 파일 DB 를 쓴다.
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const freq = JSON.parse(readFileSync("data/freq-rank.json", "utf8"))

const { rows } = await db.execute("SELECT id, body FROM pc_passages ORDER BY id")
console.log(`[mine] target=${url} · 지문 ${rows.length}편${dry ? " (dry-run)" : ""}`)

const drafts = []
for (const r of rows) drafts.push(...minePassage(r.id, r.body, freq))

// id 는 결정적으로 짓는다 — 같은 지문을 다시 채굴해도 같은 행이 갱신된다.
const seq = new Map()
for (const d of drafts) {
  const k = `${d.passageId}#t${d.type}`
  const n = (seq.get(k) ?? 0) + 1
  seq.set(k, n)
  d.id = `${k}-${String(n).padStart(2, "0")}`
}

// ── 요약 ────────────────────────────────────────────────────
const by = (fn) => drafts.reduce((m, d) => (m[fn(d)] = (m[fn(d)] ?? 0) + 1, m), {})
const passagesWith = (t) => new Set(drafts.filter((d) => d.type === t).map((d) => d.passageId)).size

console.log("\n유형별 후보")
for (const t of [1, 2, 3]) {
  const n = drafts.filter((d) => d.type === t).length
  console.log(`  유형 ${t}: ${String(n).padStart(4)}건 / ${String(passagesWith(t)).padStart(3)}편`)
}
console.log("  방향별:", JSON.stringify(by((d) => `${d.type}${d.direction ? ":" + d.direction : ""}`)))
console.log("  출처별:", JSON.stringify(by((d) => d.origin)))
const t3 = drafts.filter((d) => d.type === 3)
console.log(`  유형3 신뢰도: 지시사 ${t3.filter((d) => !d.notes).length}건 · 정관사(검수 우선) ${t3.filter((d) => d.notes).length}건`)

// ── 자체 점검: 오프셋이 본문과 일치하는가 ────────────────────
const bodies = new Map(rows.map((r) => [r.id, r.body]))
let mismatch = 0
for (const d of drafts) {
  if (bodies.get(d.passageId).slice(d.stimulusStart, d.stimulusEnd) !== d.stimulusText) mismatch++
}
console.log(`\n오프셋 불일치 ${mismatch}건`)
if (mismatch > 0) {
  console.error("[mine] 중단 — 오프셋이 어긋난 후보가 있습니다")
  process.exit(1)
}

if (dry) {
  const sample = drafts.filter((d) => d.type === 3).slice(0, 3)
  for (const d of sample) {
    const b = bodies.get(d.passageId)
    console.log(`\n[유형3 예시] ${d.id}`)
    console.log(`  되받는 이름: "${d.stimulusText}"`)
    console.log(`  받는 범위  : "${b.slice(d.answerStart, d.answerEnd).replace(/\n/g, " ").slice(0, 150)}"`)
  }
  process.exit(0)
}

// ── 적재 ────────────────────────────────────────────────────
// 이미 사람이 검수한 행(review_status != 'raw')은 덮어쓰지 않는다.
let inserted = 0
let skipped = 0
for (const d of drafts) {
  const cur = await db.execute({ sql: "SELECT review_status FROM pc_tasks WHERE id = ?", args: [d.id] })
  if (cur.rows.length && cur.rows[0].review_status !== "raw") {
    skipped++
    continue
  }
  await db.execute({
    sql: `INSERT INTO pc_tasks
            (id, passage_id, type, direction, context_start, context_end,
             stimulus_start, stimulus_end, stimulus_text, target_form,
             answer_start, answer_end, avoid_words, gold, origin, review_status, notes, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'raw',?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            direction=excluded.direction, context_start=excluded.context_start,
            context_end=excluded.context_end, stimulus_start=excluded.stimulus_start,
            stimulus_end=excluded.stimulus_end, stimulus_text=excluded.stimulus_text,
            target_form=excluded.target_form, answer_start=excluded.answer_start,
            answer_end=excluded.answer_end, avoid_words=excluded.avoid_words,
            origin=excluded.origin, notes=excluded.notes, updated_at=datetime('now')`,
    args: [
      d.id, d.passageId, d.type, d.direction, d.contextStart, d.contextEnd,
      d.stimulusStart, d.stimulusEnd, d.stimulusText, d.targetForm,
      d.answerStart, d.answerEnd,
      d.avoidWords ? JSON.stringify(d.avoidWords) : null,
      d.gold ? JSON.stringify(d.gold) : null,
      d.origin, d.notes,
    ],
  })
  inserted++
}

const total = await db.execute("SELECT type, review_status, count(*) n FROM pc_tasks GROUP BY 1,2 ORDER BY 1,2")
console.log(`\n적재 ${inserted}건 · 검수본 보존 ${skipped}건`)
console.log("DB 현황:", total.rows.map((r) => `유형${r.type}/${r.review_status}=${r.n}`).join(" "))

// 요약문 블록을 가진 지문은 유형 2 골드의 원천이다 — 검수 우선순위 안내
const golds = drafts.filter((d) => d.origin === "gold")
if (golds.length) {
  console.log(`\n검수 우선: 40번 요약문 유래 유형 2 후보 ${golds.length}건`)
  console.log("  " + [...new Set(golds.map((d) => d.passageId))].join(", "))
}
