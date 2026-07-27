#!/usr/bin/env node
// 로컬 local.db 의 지문(명제·모범답안·검수상태·기준임베딩 포함)을 원격 Turso 로 옮긴다.
// 재생성이 아니라 복사이므로 Gemini 호출이 0회다.
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"

loadEnv()

const url = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 이 필요합니다 (.env.local)")
  process.exit(1)
}

const src = createClient({ url: "file:./local.db" })
const dst = createClient({ url, authToken })

const { rows } = await src.execute(`
  SELECT id, source, title, body, word_count, topic, question_type, difficulty_score,
         year, propositions, model_answers, ref_embedding, review_status, created_by
  FROM pc_passages ORDER BY id
`)
console.log(`[migrate] 로컬 지문 ${rows.length}개`)

let n = 0
for (const r of rows) {
  await dst.execute({
    sql: `INSERT INTO pc_passages
            (id, source, title, body, word_count, topic, question_type, difficulty_score,
             year, propositions, model_answers, ref_embedding, review_status, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, topic=excluded.topic,
            propositions=excluded.propositions, model_answers=excluded.model_answers,
            ref_embedding=excluded.ref_embedding, review_status=excluded.review_status,
            updated_at=datetime('now')`,
    args: [r.id, r.source, r.title, r.body, r.word_count, r.topic, r.question_type,
           r.difficulty_score, r.year, r.propositions, r.model_answers, r.ref_embedding,
           r.review_status, r.created_by],
  })
  n++
}

const chk = await dst.execute(
  "SELECT review_status, COUNT(*) c, SUM(propositions IS NOT NULL) p FROM pc_passages GROUP BY review_status",
)
console.log(`[migrate] 이관 ${n}개`)
console.log("[migrate] 원격 상태:", chk.rows.map((x) => `${x.review_status} ${x.c}개(명제보유 ${x.p})`).join(" | "))
