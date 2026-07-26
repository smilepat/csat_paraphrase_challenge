#!/usr/bin/env node
// ============================================================
// 지문 보강 — 핵심 명제 + 모범 답안 생성 (review_status: raw → draft)
//
// 이 데이터가 채점의 기준선이다. 부정확하면 채점 전체가 흔들리므로
// 생성 결과는 draft 로만 두고, /admin/passages 검수에서 승인해야 게임에 노출된다.
//
// 사용:
//   node scripts/enrich-passages.mjs            전체 raw 지문
//   node scripts/enrich-passages.mjs --limit 3  샘플만 (먼저 이걸로 품질 확인)
//   node scripts/enrich-passages.mjs --redo     draft 도 다시 생성
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv, callGemini, parseGeminiJson, logUsage } from "./_shared.mjs"

loadEnv()

const args = process.argv.slice(2)
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity
const redo = args.includes("--redo")
const BATCH = 5 // 한 요청에 지문 5개. 더 늘리면 JSON 이 길어져 잘림 위험이 커진다.

const url = process.env.TURSO_DATABASE_URL?.trim() || "file:./local.db"
const authToken = process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const statuses = redo ? ["raw", "draft"] : ["raw"]
const { rows } = await db.execute({
  sql: `SELECT id, body, question_type FROM pc_passages
        WHERE review_status IN (${statuses.map(() => "?").join(",")})
        ORDER BY id`,
  args: statuses,
})
const targets = rows.slice(0, limit === Infinity ? undefined : limit)
console.log(`[enrich] 대상 ${targets.length}개 (전체 raw/draft ${rows.length}개)`)
if (targets.length === 0) process.exit(0)

const SYSTEM = `You prepare scoring keys for a Korean EFL classroom paraphrase game.
Students read a CSAT reading passage and rewrite it in the shortest, easiest English possible.
Your output becomes the answer key that an automatic scorer compares student writing against.
Be precise and literal about what the passage actually claims. Never add outside knowledge.`

function buildPrompt(batch) {
  const items = batch
    .map((p, i) => `### PASSAGE ${i + 1} (id: ${p.id})\n${p.body}`)
    .join("\n\n")

  return `For each passage below, produce a scoring key.

${items}

For EACH passage return:
- "id": the passage id exactly as given
- "title": a short English title, max 8 words
- "topicKo": the topic in Korean, max 12 characters
- "propositions": 3-5 core claims, ordered by importance. Each must be ONE standalone
  English sentence of 8-16 words that states a claim the passage actually makes.
  Together they must cover the passage's whole argument. Write them in plain, simple
  English (not the passage's original wording) — they are compared against student
  paraphrases by meaning, so paraphrase them yourself.
- "modelAnswers": 3 different correct student answers. Each is 1-2 sentences,
  MAX 25 words total, using easy vocabulary a Korean middle-school student knows.
  They must differ in wording and structure from each other, not just word order.

Return ONLY a JSON array, one object per passage, in the same order:
[{"id":"...","title":"...","topicKo":"...","propositions":["..."],"modelAnswers":["..."]}]`
}

const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0)

/** 생성 결과가 채점 기준으로 쓸 만한지 확인한다. 실패하면 그 지문은 건너뛴다. */
function validate(item, passage) {
  const problems = []
  if (!item || item.id !== passage.id) problems.push("id 불일치")
  const props = item?.propositions
  if (!Array.isArray(props) || props.length < 3 || props.length > 5) {
    problems.push(`명제 개수 ${props?.length ?? 0}`)
  } else if (props.some((p) => typeof p !== "string" || wordCount(p) < 5)) {
    problems.push("명제가 너무 짧음")
  }
  const models = item?.modelAnswers
  if (!Array.isArray(models) || models.length < 2) {
    problems.push(`모범답안 개수 ${models?.length ?? 0}`)
  } else if (models.some((m) => wordCount(m) > 30)) {
    problems.push(`모범답안 30단어 초과(${models.map(wordCount).join("/")})`)
  }
  return problems
}

let ok = 0
const failures = []

for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH)
  const label = `${i + 1}-${i + batch.length}/${targets.length}`
  let parsed
  try {
    const raw = await callGemini(buildPrompt(batch), SYSTEM, { json: true, maxOutputTokens: 8192 })
    parsed = parseGeminiJson(raw)
  } catch (e) {
    console.error(`[enrich] ${label} 요청 실패: ${e.message}`)
    failures.push(...batch.map((p) => ({ id: p.id, why: `요청 실패: ${e.message}` })))
    continue
  }

  const byId = new Map((Array.isArray(parsed) ? parsed : []).map((o) => [o?.id, o]))
  for (const p of batch) {
    const item = byId.get(p.id)
    const problems = validate(item, p)
    if (problems.length) {
      failures.push({ id: p.id, why: problems.join(", ") })
      continue
    }
    await db.execute({
      sql: `UPDATE pc_passages
            SET title=?, topic=COALESCE(?, topic), propositions=?, model_answers=?,
                review_status='draft', updated_at=datetime('now')
            WHERE id=?`,
      args: [
        String(item.title).slice(0, 100),
        item.topicKo ? String(item.topicKo).slice(0, 40) : null,
        JSON.stringify(item.propositions),
        JSON.stringify(item.modelAnswers),
        p.id,
      ],
    })
    ok++
  }
  console.log(`[enrich] ${label} 완료 (누적 성공 ${ok})`)
}

await logUsage(db, "enrich", Math.ceil(targets.length / BATCH), targets.length)

console.log(`\n[enrich] 성공 ${ok} / 실패 ${failures.length}`)
for (const f of failures.slice(0, 20)) console.log(`  ${f.id} — ${f.why}`)
if (failures.length > 20) console.log(`  ... 외 ${failures.length - 20}건`)
console.log("\n다음: /admin/passages 에서 검수·승인 (승인된 지문만 게임에 노출)")
