// ============================================================
// 채점 서비스 — 채점 순수함수와 DB/API 를 잇는 층
//
// 두 경로가 있다:
//   scoreOne   제출 즉시. 임베딩 + 규칙만 (빠르고 싸다)
//   judgeRound 라운드 종료 시 배치. LLM 이 명제 커버리지·모순을 확정하고
//              한국어 피드백을 붙인다. 이때 점수가 확정된다.
// ============================================================

import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import { embedBatch, isLlmEnabled } from "@/lib/gemini"
import { scoreSubmission, type ScoreResult } from "./index"
import { normalizeForCompare, sentences } from "./text"
import { judgeBatch, type Verdict } from "./verdict"
import freqJson from "@/data/freq-rank.json"

const freq = freqJson as Record<string, number>

export interface PassageForScoring {
  id: string
  body: string
  propositions: string[]
  modelAnswers: string[]
  refEmbedding: { propositions: number[][]; models: number[][] } | null
}

export function cacheKey(passageId: string, answer: string, withLlm: boolean): string {
  return createHash("sha256")
    .update(`${passageId}\n${withLlm ? "llm" : "emb"}\n${normalizeForCompare(answer)}`)
    .digest("hex")
}

export async function readCache(key: string): Promise<{ scores: ScoreResult; verdict?: Verdict } | null> {
  const { rows } = await db.execute({
    sql: "SELECT payload FROM pc_score_cache WHERE key = ?",
    args: [key],
  })
  if (!rows.length) return null
  await db.execute({ sql: "UPDATE pc_score_cache SET hits = hits + 1 WHERE key = ?", args: [key] })
  try {
    return JSON.parse(String(rows[0].payload))
  } catch {
    return null
  }
}

export async function writeCache(
  key: string,
  passageId: string,
  payload: { scores: ScoreResult; verdict?: Verdict },
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO pc_score_cache (key, passage_id, payload) VALUES (?, ?, ?)
          ON CONFLICT(key) DO NOTHING`,
    args: [key, passageId, JSON.stringify(payload)],
  })
}

async function noteUsage(kind: string, calls: number, items: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  await db.execute({
    sql: `INSERT INTO pc_api_usage (day, kind, calls, items) VALUES (?, ?, ?, ?)
          ON CONFLICT(day, kind) DO UPDATE SET calls = calls + excluded.calls,
                                               items = items + excluded.items`,
    args: [day, kind, calls, items],
  })
}

/** 지문의 기준 임베딩. 승인 시 저장해 두지만 없으면 즉석에서 만든다. */
export async function referenceVectors(
  p: PassageForScoring,
): Promise<{ propositions: number[][]; models: number[][] }> {
  if (p.refEmbedding?.propositions?.length) return p.refEmbedding

  const all = await embedBatch([...p.propositions, ...p.modelAnswers])
  const refs = {
    propositions: all.slice(0, p.propositions.length),
    models: all.slice(p.propositions.length),
  }
  await db.execute({
    sql: "UPDATE pc_passages SET ref_embedding = ? WHERE id = ?",
    args: [JSON.stringify(refs), p.id],
  })
  await noteUsage("embed", 1, p.propositions.length + p.modelAnswers.length)
  return refs
}

export interface ScoreOneInput {
  passage: PassageForScoring
  answer: string
  targetWords: number
  peers: Array<{ nickname: string; text: string }>
}

/**
 * 제출 즉시 채점. LLM 은 부르지 않는다 — 30명이 동시에 내는 순간
 * 30번의 판정 호출이 나가면 비용도 지연도 감당이 안 된다.
 */
export async function scoreOne(input: ScoreOneInput): Promise<ScoreResult> {
  const { passage, answer } = input
  const key = cacheKey(passage.id, answer, false)
  const cached = await readCache(key)
  if (cached) return cached.scores

  const refs = await referenceVectors(passage)
  const parts = [answer, ...sentences(answer)]
  const vectors = await embedBatch(parts)
  await noteUsage("embed", 1, parts.length)

  const scores = scoreSubmission({
    answer,
    passageBody: passage.body,
    targetWords: input.targetWords,
    freq,
    answerVectors: vectors,
    propositionVectors: refs.propositions,
    modelVectors: refs.models,
    modelAnswers: passage.modelAnswers,
    peers: input.peers,
    propositions: passage.propositions,
  })

  await writeCache(key, passage.id, { scores })
  return scores
}

export interface RoundSubmission {
  id: string
  nickname: string
  text: string
}

/**
 * 라운드 종료 배치 판정. 제출물 전체를 1~2콜로 처리한다.
 * LLM 이 꺼져 있거나 실패하면 즉시 채점 결과를 그대로 확정한다(채점이 멈추면 안 된다).
 */
export async function judgeRound(
  passage: PassageForScoring,
  targetWords: number,
  submissions: RoundSubmission[],
): Promise<Map<string, { scores: ScoreResult; verdict?: Verdict }>> {
  const out = new Map<string, { scores: ScoreResult; verdict?: Verdict }>()
  if (!submissions.length) return out

  // 캐시 조회 먼저 — 같은 답안을 다시 판정해 과금하지 않는다.
  const pending: RoundSubmission[] = []
  for (const s of submissions) {
    const cached = await readCache(cacheKey(passage.id, s.text, true))
    if (cached) out.set(s.id, cached)
    else pending.push(s)
  }
  if (!pending.length) return out

  const refs = await referenceVectors(passage)

  // 임베딩: 모든 답안과 문장을 한 번에
  const textIndex = new Map<string, number>()
  const flat: string[] = []
  for (const s of pending) {
    for (const t of [s.text, ...sentences(s.text)]) {
      if (!textIndex.has(t)) {
        textIndex.set(t, flat.length)
        flat.push(t)
      }
    }
  }
  const vectors = await embedBatch(flat)
  await noteUsage("embed", Math.ceil(flat.length / 100), flat.length)

  // LLM 판정: 10명씩
  const verdicts = new Map<string, Verdict>()
  if (isLlmEnabled()) {
    let calls = 0
    for (let i = 0; i < pending.length; i += 10) {
      const chunk = pending.slice(i, i + 10)
      const got = await judgeBatch(
        passage.propositions,
        chunk.map((s) => ({ id: s.id, answer: s.text })),
      )
      calls++
      for (const [id, v] of got) verdicts.set(id, v)
    }
    await noteUsage("verdict", calls, pending.length)
  }

  for (const s of pending) {
    const v = verdicts.get(s.id)
    const scores = scoreSubmission({
      answer: s.text,
      passageBody: passage.body,
      targetWords,
      freq,
      answerVectors: [s.text, ...sentences(s.text)]
        .map((t) => vectors[textIndex.get(t)!])
        .filter(Boolean),
      propositionVectors: refs.propositions,
      modelVectors: refs.models,
      modelAnswers: passage.modelAnswers,
      peers: pending.filter((o) => o.id !== s.id).map((o) => ({ nickname: o.nickname, text: o.text })),
      propositions: passage.propositions,
      contradictedIndices: v?.contradicted,
      coveredIndices: v?.covered,
    })
    const payload = { scores, verdict: v }
    out.set(s.id, payload)
    // LLM 이 실제로 판정한 경우에만 llm 키로 캐시한다.
    if (v) await writeCache(cacheKey(passage.id, s.text, true), passage.id, payload)
  }

  return out
}
