#!/usr/bin/env node
// ============================================================
// CSAT 기출 지문 → pc_passages 적재
//
// 원천: csat-reasoning-bridge-builder/public/passages.json (565개)
// 사용: node scripts/import-passages.mjs [경로]
//       PASSAGES_JSON=... npm run db:import
//
// 저작권: 적재 대상은 기출 원문이다. 이 DB 와 앱은 비공개 전제로 운영한다.
// ============================================================
import { readFileSync } from "node:fs"
import { createClient } from "@libsql/client"

const DEFAULT_SRC = "C:/tmp/csat-reasoning-bridge-builder/public/passages.json"
const src = process.argv[2] || process.env.PASSAGES_JSON || DEFAULT_SRC

// 패러프레이즈(한 편의 논지를 압축)에 적합한 유형만 받는다.
// 제외 사유가 유형마다 다르므로 명시해 둔다 — 나중에 되돌릴 때 근거가 된다.
const KEEP_TYPES = new Set([
  "빈칸 추론",   // 논지가 한 줄로 압축되는 전형적 설명문
  "요지",
  "주제",
  "제목 추론",
  "주장",
  "함축 의미",
])
const DROP_REASON = {
  "도표": "수치·표 의존이라 요약이 성립하지 않음",
  "실용문·안내문": "안내문은 논지가 없음",
  "심경·분위기": "서사 감정 묘사라 명제 추출이 부적합",
  "내용 일치": "병렬 사실 나열이라 한 문장 압축이 왜곡을 부름",
  "어법": "문법 문항용 지문",
  "어휘(문맥)": "어휘 문항용 지문",
  "어휘 선택": "어휘 문항용 지문",
  "글의 순서": "지문이 조각으로 분리돼 있음",
  "문장 삽입": "지문이 조각으로 분리돼 있음",
  "무관한 문장": "의도적으로 이질 문장이 섞여 있음",
  "장문 독해": "200단어 초과로 활동 시간에 맞지 않음",
  "지칭 추론": "대명사 추적용 서사",
}

const MIN_WORDS = 100
const MAX_WORDS = 200

const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0)

const raw = JSON.parse(readFileSync(src, "utf8"))
const all = Array.isArray(raw) ? raw : raw.passages || Object.values(raw)[0]
console.log(`[import] 원천 ${all.length}개 ← ${src}`)

const stats = { total: all.length, kept: 0, byDropType: {}, tooShort: 0, tooLong: 0, dup: 0 }
const seen = new Set()
const rows = []

for (const p of all) {
  const type = p.questionTypeKo || p.questionType || "미상"
  if (!KEEP_TYPES.has(type)) {
    stats.byDropType[type] = (stats.byDropType[type] || 0) + 1
    continue
  }
  const body = (p.passage || "").replace(/\r\n/g, "\n").trim()
  const wc = wordCount(body)
  if (wc < MIN_WORDS) {
    stats.tooShort++
    continue
  }
  if (wc > MAX_WORDS) {
    stats.tooLong++
    continue
  }
  // 같은 지문이 여러 문항으로 중복 수록된 경우가 있다.
  const key = body.slice(0, 120).toLowerCase()
  if (seen.has(key)) {
    stats.dup++
    continue
  }
  seen.add(key)

  rows.push({
    id: p.id,
    source: "csat",
    // 원천에 제목이 없다. 첫 문장 앞부분을 임시 제목으로 쓰고 M1 검수에서 다듬는다.
    title: body.split(/(?<=[.!?])\s/)[0].slice(0, 70),
    body,
    word_count: wc,
    topic: p.topic ?? null,
    question_type: type,
    difficulty_score: typeof p.difficultyScore === "number" ? p.difficultyScore : null,
    year: p.year ?? null,
  })
}
stats.kept = rows.length

const url = process.env.TURSO_DATABASE_URL?.trim() || "file:./local.db"
const authToken = process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const client = authToken ? createClient({ url, authToken }) : createClient({ url })

let inserted = 0
for (const r of rows) {
  const res = await client.execute({
    // 이미 적재된 지문의 검수 결과(propositions 등)를 덮어쓰지 않는다.
    sql: `INSERT INTO pc_passages
            (id, source, title, body, word_count, topic, question_type, difficulty_score, year, review_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw')
          ON CONFLICT(id) DO NOTHING`,
    args: [
      r.id, r.source, r.title, r.body, r.word_count,
      r.topic, r.question_type, r.difficulty_score, r.year,
    ],
  })
  inserted += res.rowsAffected
}

const total = await client.execute("SELECT COUNT(*) AS n FROM pc_passages")
const byType = await client.execute(
  "SELECT question_type, COUNT(*) AS n FROM pc_passages GROUP BY question_type ORDER BY n DESC",
)

console.log("\n[import] 제외 내역")
for (const [type, n] of Object.entries(stats.byDropType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${type} — ${DROP_REASON[type] || "적합 유형 아님"}`)
}
console.log(`  ${String(stats.tooShort).padStart(4)}  ${MIN_WORDS}단어 미만`)
console.log(`  ${String(stats.tooLong).padStart(4)}  ${MAX_WORDS}단어 초과`)
console.log(`  ${String(stats.dup).padStart(4)}  중복 지문`)

console.log(`\n[import] 적합 판정 ${stats.kept} / 신규 적재 ${inserted} / DB 총계 ${total.rows[0].n}`)
console.log("[import] 유형별:", byType.rows.map((r) => `${r.question_type} ${r.n}`).join(", "))
console.log("\n다음: npm run db:enrich  (핵심 명제·모범답안 생성)")
