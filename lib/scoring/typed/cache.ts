// ============================================================
// 판정 캐시 — 같은 답안에는 **항상 같은 점수**가 나와야 한다.
//
// 실측: 의미 판정은 temperature 0 인데도 실행마다 흔들린다(§15). 캐시가 없으면
// 학생이 같은 답을 두 번 냈을 때 다른 점수를 받는다. 자습에서 그건 앱을 못 믿게
// 만드는 결함이고, 비용 절감은 그 다음 문제다.
//
// 키에 **프롬프트 지문**이 들어간다. 프롬프트를 고치면 캐시가 저절로 갈린다 —
// 손으로 버전을 올리는 방식이면 안 올리는 날이 오고, 그날부터 옛 판정이 계속 나온다.
// ============================================================

import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import { normalizeForCompare } from "../text"
import {
  judgeType1Batch, PROMPT_FINGERPRINT as FP1,
  type Type1Request, type Type1Verdict,
} from "./verdict1"
import {
  judgeType2Batch, PROMPT_FINGERPRINT as FP2,
  type Type2Request, type Type2Verdict,
} from "./verdict2"

export function verdictKey(taskId: string, kind: string, fingerprint: string, answer: string): string {
  return createHash("sha256")
    .update(`${taskId}\n${kind}\n${fingerprint}\n${normalizeForCompare(answer)}`)
    .digest("hex")
}

async function readMany(keys: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>()
  if (keys.length === 0) return out
  const marks = keys.map(() => "?").join(",")
  const { rows } = await db.execute({
    sql: `SELECT key, payload FROM pc_task_verdict_cache WHERE key IN (${marks})`,
    args: keys,
  })
  for (const r of rows) {
    try {
      out.set(String(r.key), JSON.parse(String(r.payload)))
    } catch {
      // 깨진 항목은 없는 것으로 친다 — 다시 판정하면 덮인다
    }
  }
  if (out.size) {
    const hitMarks = [...out.keys()].map(() => "?").join(",")
    await db.execute({
      sql: `UPDATE pc_task_verdict_cache SET hits = hits + 1 WHERE key IN (${hitMarks})`,
      args: [...out.keys()],
    })
  }
  return out
}

async function writeOne(
  key: string, taskId: string, kind: string, fingerprint: string, payload: unknown,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO pc_task_verdict_cache (key, task_id, kind, fingerprint, payload)
          VALUES (?,?,?,?,?) ON CONFLICT(key) DO NOTHING`,
    args: [key, taskId, kind, fingerprint, JSON.stringify(payload)],
  })
}

export type CacheStats = { hit: number; miss: number }

/**
 * 캐시를 거쳐 판정한다. 적중한 것은 API 로 보내지 않는다.
 *
 * 판정에 실패해 결과가 비면 **캐시에 넣지 않는다** — 실패를 캐싱하면
 * 일시적인 네트워크 오류가 영구적인 오답으로 굳는다.
 */
export async function judgeType1Cached(
  requests: Type1Request[],
): Promise<{ verdicts: Map<string, Type1Verdict>; stats: CacheStats }> {
  return judgeCached(requests, "type1", FP1, judgeType1Batch)
}

export async function judgeType2Cached(
  requests: Type2Request[],
): Promise<{ verdicts: Map<string, Type2Verdict>; stats: CacheStats }> {
  return judgeCached(requests, "type2", FP2, judgeType2Batch)
}

async function judgeCached<R extends { id: string; answer: string }, V>(
  requests: R[],
  kind: string,
  fingerprint: string,
  judge: (rs: R[]) => Promise<Map<string, V>>,
): Promise<{ verdicts: Map<string, V>; stats: CacheStats }> {
  const verdicts = new Map<string, V>()
  if (requests.length === 0) return { verdicts, stats: { hit: 0, miss: 0 } }

  const keyOf = new Map(requests.map((r) => [r.id, verdictKey(r.id, kind, fingerprint, r.answer)]))
  const cached = await readMany([...keyOf.values()])

  const misses: R[] = []
  for (const r of requests) {
    const hit = cached.get(keyOf.get(r.id)!)
    if (hit !== undefined) verdicts.set(r.id, hit as V)
    else misses.push(r)
  }

  if (misses.length) {
    const fresh = await judge(misses)
    for (const r of misses) {
      const v = fresh.get(r.id)
      if (v === undefined) continue // 판정 실패 — 캐싱하지 않는다
      verdicts.set(r.id, v)
      await writeOne(keyOf.get(r.id)!, r.id, kind, fingerprint, v)
    }
  }

  return { verdicts, stats: { hit: requests.length - misses.length, miss: misses.length } }
}

/** 운영 점검용. 지문별로 세면 프롬프트를 고친 뒤 옛 항목이 얼마나 남았는지 보인다. */
export async function verdictCacheStats(): Promise<
  { kind: string; fingerprint: string; n: number; hits: number; current: boolean }[]
> {
  const { rows } = await db.execute(
    `SELECT kind, fingerprint, COUNT(*) n, COALESCE(SUM(hits),0) hits
     FROM pc_task_verdict_cache GROUP BY kind, fingerprint ORDER BY kind, n DESC`,
  )
  const now: Record<string, string> = { type1: FP1, type2: FP2 }
  return rows.map((r) => ({
    kind: String(r.kind),
    fingerprint: String(r.fingerprint),
    n: Number(r.n),
    hits: Number(r.hits),
    current: now[String(r.kind)] === String(r.fingerprint),
  }))
}

/**
 * 현재 프롬프트 지문이 아닌 항목을 지운다.
 * 지우지 않아도 **틀린 판정이 나가지는 않는다**(키에 지문이 들어 있어 애초에 안 맞는다).
 * 다만 쌓이기만 하므로 가끔 치운다.
 */
export async function purgeStaleVerdicts(): Promise<number> {
  const res = await db.execute({
    sql: `DELETE FROM pc_task_verdict_cache
          WHERE (kind = 'type1' AND fingerprint <> ?)
             OR (kind = 'type2' AND fingerprint <> ?)
             OR kind NOT IN ('type1','type2')`,
    args: [FP1, FP2],
  })
  return res.rowsAffected
}
