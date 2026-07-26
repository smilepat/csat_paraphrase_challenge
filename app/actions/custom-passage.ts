"use server"

// ============================================================
// 교사 직접 문항 입력
//
// 원래 단일 HTML 에는 "교사용 문항 편집"이 있었지만 새로고침하면 사라졌다.
// 여기서는 DB 에 저장하고, 자동 생성한 명제·모범답안을 교사가 검수한 뒤
// 승인해야 수업에 쓰인다(CSAT 지문과 같은 경로).
//
// 저작권: 교사가 직접 넣는 지문의 권리 확인은 교사 몫이다. 화면에 명시한다.
// ============================================================

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { ulid } from "@/lib/codes"
import { callGemini, parseGeminiJson } from "@/lib/gemini"
import { wordCount } from "@/lib/scoring/text"

const MIN_WORDS = 60
const MAX_WORDS = 250

const SYSTEM = `You prepare scoring keys for a Korean EFL classroom paraphrase game.
Students rewrite a reading passage in the shortest, easiest English possible.
Your output becomes the answer key an automatic scorer compares student writing against.
Be precise and literal about what the passage actually claims. Never add outside knowledge.`

export interface CustomPassageResult {
  ok: boolean
  error?: string
  id?: string
  propositions?: string[]
  modelAnswers?: string[]
}

export async function createCustomPassage(input: {
  title: string
  body: string
  topic?: string
}): Promise<CustomPassageResult> {
  const title = input.title.trim()
  const body = input.body.trim().replace(/\r\n/g, "\n")
  const words = wordCount(body)

  if (!title) return { ok: false, error: "제목을 입력하세요." }
  if (words < MIN_WORDS) {
    return { ok: false, error: `지문이 ${words}단어입니다. ${MIN_WORDS}단어 이상이어야 요약 활동이 됩니다.` }
  }
  if (words > MAX_WORDS) {
    return { ok: false, error: `지문이 ${words}단어입니다. ${MAX_WORDS}단어 이하로 줄여주세요.` }
  }
  if (!/[a-zA-Z]/.test(body)) return { ok: false, error: "영어 지문을 입력하세요." }

  // 같은 지문을 두 번 넣는 사고를 막는다(앞 120자 기준).
  const dup = await db.execute({
    sql: "SELECT id FROM pc_passages WHERE substr(lower(body), 1, 120) = substr(lower(?), 1, 120)",
    args: [body],
  })
  if (dup.rows.length) {
    return { ok: false, error: `같은 지문이 이미 있습니다 (${String(dup.rows[0].id)}).` }
  }

  let propositions: string[] = []
  let modelAnswers: string[] = []
  try {
    const raw = await callGemini(
      `PASSAGE:
${body}

Produce a scoring key for this passage:
- "propositions": 3-5 core claims, ordered by importance. Each ONE standalone English
  sentence of 8-16 words stating a claim the passage actually makes. Together they must
  cover the whole argument. Write them in plain simple English, REWORDED — do not copy
  phrases from the passage, because student paraphrases are compared against them by meaning.
- "modelAnswers": 3 different correct student answers, each 1-2 sentences, MAX 25 words,
  using vocabulary a Korean middle-school student knows. They must differ from each other
  in wording and structure.
- "topicKo": the topic in Korean, max 12 characters.

Return ONLY {"propositions":[...],"modelAnswers":[...],"topicKo":"..."}`,
      SYSTEM,
      { json: true, maxOutputTokens: 4096 },
    )
    const parsed = parseGeminiJson<{
      propositions?: unknown
      modelAnswers?: unknown
      topicKo?: unknown
    }>(raw)
    propositions = Array.isArray(parsed.propositions) ? parsed.propositions.map(String) : []
    modelAnswers = Array.isArray(parsed.modelAnswers) ? parsed.modelAnswers.map(String) : []
    if (!input.topic && typeof parsed.topicKo === "string") input.topic = parsed.topicKo
  } catch (e) {
    // 생성이 실패해도 지문은 저장한다. 교사가 명제를 직접 써 넣으면 된다.
    console.error("[custom] 명제 생성 실패:", (e as Error).message)
  }

  const id = ulid()
  const enriched = propositions.length >= 2 && modelAnswers.length >= 1
  await db.execute({
    sql: `INSERT INTO pc_passages
            (id, source, title, body, word_count, topic, question_type, propositions,
             model_answers, review_status, created_by)
          VALUES (?, 'custom', ?, ?, ?, ?, '교사 입력', ?, ?, ?, 'teacher')`,
    args: [
      id, title, body, words, input.topic?.trim() || null,
      enriched ? JSON.stringify(propositions) : null,
      enriched ? JSON.stringify(modelAnswers) : null,
      enriched ? "draft" : "raw",
    ],
  })

  revalidatePath("/admin/passages")
  return {
    ok: true,
    id,
    propositions,
    modelAnswers,
    ...(enriched ? {} : { error: "명제 자동 생성에 실패했습니다. 검수 화면에서 직접 입력해 주세요." }),
  }
}
