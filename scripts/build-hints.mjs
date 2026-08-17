#!/usr/bin/env node
// ============================================================
// 문항별 힌트 재료 생성.  npm run tasks:hints [-- --limit N] [-- --local] [-- --redo]
//
// 왜 미리 만드나: 힌트는 문항마다 고정이다. 요청할 때마다 LLM 을 부르면 같은
// 문항에 돈이 반복해서 들고, 느리고, **같은 문항에 다른 힌트**가 나온다.
// 마지막 것이 가장 나쁘다 — 자습에서 앱을 못 믿게 되는 종류의 결함이다
// (판정 캐시를 만든 이유와 같다, 004-verdict-cache.sql).
//
// 무엇을 만드나 (유형마다 쓰는 것이 다르다):
//   gloss   대상 표현의 한국어 뜻          — 전 유형
//   shape   첫 글자 + 낱말 수              — 유형 1 (인출 발판, 답이 아니다)
//   form    동사 → 명사형 / 명사 → 동사형  — 유형 2 (어형 지식)
//   example 가능한 답 하나                 — 유형 1·2 (마지막 칸)
//
// ⚠ example 은 **정답이 아니라 하나의 가능한 답**이다. 채점은 여전히 학생 답안을
//   본다. 이 칸까지 쓴 것은 시도 기록에 남으므로 "무도움 성적" 과 섞이지 않는다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv, callGemini, parseGeminiJson, logUsage } from "./_shared.mjs"
import { formAgreesWithExample } from "../lib/tasks/hint-material.ts"

loadEnv()
const args = process.argv.slice(2)
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity
const local = args.includes("--local")
const redo = args.includes("--redo")
const dry = args.includes("--dry")

const BATCH = 8

const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

// 유형 3 은 산출 과제가 아니라 범위를 끄는 과제다. 낱말을 만들 필요가 없으므로
// 뜻만 있으면 된다 — 그래도 "이 표현이 무슨 뜻인지" 는 필요하다.
const { rows } = await db.execute({
  sql: `SELECT t.id, t.type, t.direction, t.stimulus_text s, t.avoid_words, t.hints,
               substr(p.body, t.context_start + 1, t.context_end - t.context_start) ctx
        FROM pc_tasks t JOIN pc_passages p ON p.id = t.passage_id
        WHERE t.review_status='approved'
        ORDER BY t.id`,
  args: [],
})
/**
 * --repair : 이미 만들어 둔 힌트 중 **어형과 예시가 어긋난 것**만 다시 만든다.
 * 전체를 --redo 하면 멀쩡한 것까지 흔들리고 돈도 그만큼 든다.
 */
function needsRepair(row) {
  if (!row.hints) return false
  let h
  try {
    h = JSON.parse(String(row.hints))
  } catch {
    return true
  }
  if (!h.gloss) return true
  if (h.form && !formAgreesWithExample(h.form, h.example)) return true
  return false
}

const repair = args.includes("--repair")
const candidates = rows.filter((r) => (repair ? needsRepair(r) : redo || !r.hints))
const targets = candidates.slice(0, limit === Infinity ? undefined : limit)

console.log(`[hints] target=${url}`)
console.log(
  `  승인 문항 ${rows.length}건 · 힌트 없는 것 ${rows.filter((r) => !r.hints).length}건 · ` +
    `수리 대상 ${rows.filter(needsRepair).length}건 · 이번 ${targets.length}건${dry ? " (dry-run)" : ""}\n`,
)
// ⚠ --dry 도 LLM 을 부른다(생성한 뒤에 저장만 건너뛴다). 개수만 볼 때는 --count 를 쓴다.
if (args.includes("--count")) process.exit(0)
if (!targets.length) process.exit(0)

const SYSTEM = `You prepare hints for Korean high-school students practising English paraphrase.
They are EFL learners: they often understand the grammar task but cannot produce the English
because they do not know what the phrase means, or cannot retrieve an alternative word.
Your hints must lower that barrier without doing the task for them.`

function taskLine(r, i) {
  const kind =
    r.type === 1
      ? "TYPE 1 — the student must restate the TARGET PHRASE using different words, same meaning."
      : r.type === 2 && r.direction === "fold"
        ? "TYPE 2 FOLD — the student must turn the TARGET SENTENCE into a single noun phrase."
        : r.type === 2
          ? "TYPE 2 UNFOLD — the student must turn the TARGET NOUN PHRASE into a full clause."
          : "TYPE 3 — the student only marks a text range; no English production is required."
  return `### ITEM ${i + 1} (id: ${r.id})
${kind}
CONTEXT: ${String(r.ctx ?? "").replace(/\s+/g, " ").slice(0, 400)}
TARGET: «${String(r.s).replace(/\s+/g, " ")}»`
}

function buildPrompt(batch) {
  return `Write hint material for each item.

${batch.map(taskLine).join("\n\n")}

For EACH item return:
- "id": exactly as given
- "gloss": the TARGET's meaning in natural Korean, max 30 characters. This is what the
  student sees FIRST when stuck. It must say WHAT to express, never HOW to say it in
  English. Do not include any English word in the gloss.
- "example": ONE acceptable answer to the task, in English.
  · TYPE 1 → a different wording of the target phrase, same meaning, similar length
  · TYPE 2 FOLD → a noun phrase, usually "the …tion/…ity/…ment of …"
  · TYPE 2 UNFOLD → a full clause with a subject and a finite verb
  · TYPE 3 → return "" (nothing to produce)
  It must NOT reuse the target's content words.
- "form": TYPE 2 ONLY. The word-form step the student needs, as "base → derived".
  FOLD: the sentence's main verb or adjective and its noun form ("vary → variability").
  UNFOLD: the noun-phrase head and its verb/adjective form ("variability → vary").
  For other types return "".
  TWO HARD RULES:
  · The base (left side) must be a word that actually appears in the TARGET, so the
    student can find it. Do not name a word the passage does not use.
  · The derived form (right side) must be a REAL English word AND must appear in your
    "example" above. If your example does not use it, change one of the two so they
    agree. A student who is told "use X" and then shown an answer without X is worse
    off than one given no hint at all.
  If you cannot satisfy both, return "" for form.

Return ONLY a JSON array:
[{"id":"...","gloss":"...","example":"...","form":"..."}]`
}

/**
 * 유형 1 의 인출 발판. **LLM 에게 맡기지 않는다** — 첫 글자와 낱말 수는 example 에서
 * 기계적으로 나오는 것이고, 모델에게 물으면 example 과 어긋나는 답을 준다.
 */
function shapeOf(example) {
  const words = String(example).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ""
  const masked = words
    .map((w) => {
      const letters = w.replace(/[^A-Za-z]/g, "")
      if (letters.length < 2) return w
      return letters[0] + "_".repeat(letters.length - 1)
    })
    .join(" ")
  return `${masked}  (${words.length}낱말)`
}

const built = []
const dropped = { form: 0 }
let failed = 0
for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH)
  let parsed
  try {
    const raw = await callGemini(buildPrompt(batch), SYSTEM, { json: true, maxOutputTokens: 8192 })
    parsed = parseGeminiJson(raw)
  } catch (e) {
    failed += batch.length
    console.warn(`\n  ⚠ 배치 ${Math.floor(i / BATCH) + 1} 실패: ${String(e).slice(0, 100)}`)
    continue
  }
  if (!Array.isArray(parsed)) {
    failed += batch.length
    continue
  }
  for (const v of parsed) {
    const r = batch.find((b) => String(b.id) === String(v.id))
    if (!r) continue
    const gloss = String(v.gloss ?? "").trim().slice(0, 40)
    const example = String(v.example ?? "").trim()
    const form = String(v.form ?? "").trim()
    // 뜻이 없으면 사다리의 첫 칸이 비므로 쓸모가 없다
    if (!gloss) continue
    // 뜻에 영어가 섞이면 "무엇을 말할지" 가 아니라 답을 준 것이다
    if (/[A-Za-z]{3,}/.test(gloss)) continue

    // 어형(3칸)과 예시(4칸)가 어긋나면 **어형을 버린다.** 세 칸이 서로 맞는 편이
    // 네 칸이 모순되는 것보다 낫다. 이 검사가 지어낸 낱말도 같이 걸러낸다 —
    // "unmoved → unmovedness" 는 예시에 그런 낱말이 없으니 여기서 떨어진다.
    const keptForm = form && formAgreesWithExample(form, example) ? form : ""
    if (form && !keptForm) dropped.form++

    built.push({
      id: String(r.id),
      hints: {
        gloss,
        ...(r.type === 1 && example ? { shape: shapeOf(example) } : {}),
        ...(r.type === 2 && keptForm ? { form: keptForm } : {}),
        ...(r.type !== 3 && example ? { example } : {}),
      },
    })
  }
  process.stdout.write(`\r  진행 ${Math.min(i + BATCH, targets.length)}/${targets.length}건`)
}
console.log("")

console.log(
  `\n만든 것 ${built.length}건 · 실패 ${failed}건 · 버린 것 ${targets.length - built.length - failed}건` +
    ` · 어형·예시가 어긋나 어형만 버린 것 ${dropped.form}건`,
)

console.log("\n── 표본 5건 ──")
const step = Math.max(1, Math.floor(built.length / 5))
for (let i = 0; i < built.length && i < step * 5; i += step) {
  const b = built[i]
  const t = targets.find((r) => String(r.id) === b.id)
  console.log(`\n  [유형 ${t.type}${t.direction ? "/" + t.direction : ""}] «${String(t.s).replace(/\s+/g, " ").slice(0, 70)}»`)
  console.log(`    1칸 뜻   : ${b.hints.gloss}`)
  if (b.hints.shape) console.log(`    2칸 모양 : ${b.hints.shape}`)
  if (b.hints.form) console.log(`    2칸 어형 : ${b.hints.form}`)
  if (b.hints.example) console.log(`    3칸 예시 : ${b.hints.example}`)
}

if (dry) {
  console.log("\n(dry-run — 저장하지 않았습니다)")
  process.exit(0)
}

for (const b of built) {
  await db.execute({
    sql: "UPDATE pc_tasks SET hints=?, updated_at=datetime('now') WHERE id=?",
    args: [JSON.stringify(b.hints), b.id],
  })
}
await logUsage(db, "hints", Math.ceil(targets.length / BATCH), targets.length)

const done = await db.execute(
  "SELECT type, count(*) c, sum(CASE WHEN hints IS NOT NULL THEN 1 ELSE 0 END) h FROM pc_tasks WHERE review_status='approved' GROUP BY 1 ORDER BY 1",
)
console.log(`\n저장 ${built.length}건`)
console.log("힌트 보유:", done.rows.map((r) => `유형${r.type} ${r.h}/${r.c}`).join(" · "))
