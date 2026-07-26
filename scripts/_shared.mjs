// 스크립트 공용 유틸. lib/gemini.ts 는 TS 라 노드 스크립트에서 바로 못 쓰므로
// 같은 계약의 얇은 사본을 둔다. 두 곳이 갈라지지 않게 모델명·엔드포인트는
// 여기서도 env 를 먼저 읽는다.
import { readFileSync, existsSync } from "node:fs"

/** .env.local → .env 순으로 읽어 process.env 에 채운다(이미 있는 값은 유지). */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const [, k, v] = m
      if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, "")
    }
  }
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const model = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
// lib/gemini.ts 와 같은 근거로 gemini-embedding-2 / 768차원을 쓴다.
const EMBED_MODEL = () => process.env.GEMINI_EMBED_MODEL?.trim() || "gemini-embedding-2"
const EMBED_DIM = () => Number(process.env.GEMINI_EMBED_DIM || 768)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 재시도. 네트워크 끊김(ECONNRESET)과 429/5xx 만 다시 시도한다.
 * 400/404 같은 요청 자체의 문제는 재시도해도 같으므로 즉시 던진다.
 */
async function withRetry(fn, { attempts = 4, label = "" } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = String(e?.message ?? e)
      const retriable =
        /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|terminated/i.test(msg) ||
        /\b(429|500|502|503|504)\b/.test(msg)
      if (!retriable || i === attempts - 1) throw e
      const wait = 1500 * 2 ** i
      console.warn(`[retry${label ? " " + label : ""}] ${msg.slice(0, 80)} → ${wait}ms 후 재시도`)
      await sleep(wait)
    }
  }
  throw lastErr
}

export async function callGemini(prompt, systemInstruction, opts = {}) {
  return withRetry(() => callGeminiOnce(prompt, systemInstruction, opts), { label: "gemini" })
}

async function callGeminiOnce(prompt, systemInstruction, opts = {}) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("GEMINI_API_KEY 미설정")

  const generationConfig = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
  }
  if (opts.json) generationConfig.responseMimeType = "application/json"

  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig }
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] }

  const res = await fetch(`${BASE}/${model()}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason
    throw new Error(`빈 응답${reason ? ` (finishReason=${reason})` : ""}`)
  }
  return text
}

export function parseGeminiJson(raw) {
  let s = raw.replace(/```json\r?\n?/g, "").replace(/```\r?\n?/g, "").trim()
  const a = s.indexOf("["), o = s.indexOf("{")
  const start = a === -1 ? o : o === -1 ? a : Math.min(a, o)
  if (start > 0) {
    const close = s[start] === "[" ? "]" : "}"
    const end = s.lastIndexOf(close)
    if (end > start) s = s.slice(start, end + 1)
  }
  try {
    return JSON.parse(s)
  } catch (e) {
    // 응답이 잘린 경우(maxOutputTokens 초과 등) 온전한 최상위 객체만 건져낸다.
    // 전부 버리는 것보다 낫고, 호출부는 개수 부족을 스스로 확인한다.
    const salvaged = salvageObjects(s)
    if (salvaged.length) {
      console.warn(`[json] 응답이 잘려 ${salvaged.length}개 객체만 복구했습니다`)
      return salvaged
    }
    throw e
  }
}

/** 문자열 안의 괄호를 무시하며 균형 잡힌 최상위 {...} 들만 추출한다. */
function salvageObjects(s) {
  const out = []
  let depth = 0, startIdx = -1, inStr = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === "{") { if (depth === 0) startIdx = i; depth++ }
    else if (c === "}") {
      depth--
      if (depth === 0 && startIdx >= 0) {
        try { out.push(JSON.parse(s.slice(startIdx, i + 1))) } catch {}
        startIdx = -1
      }
    }
  }
  return out
}

/** 배치 임베딩. 요청당 100건 제한. */
export async function embedBatch(texts) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("GEMINI_API_KEY 미설정")
  if (texts.length === 0) return []

  const out = []
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100)
    const res = await withRetry(() => fetch(`${BASE}/${EMBED_MODEL()}:batchEmbedContents?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: chunk.map((t) => ({
          model: `models/${EMBED_MODEL()}`,
          content: { parts: [{ text: String(t).slice(0, 2000) }] },
          outputDimensionality: EMBED_DIM(),
        })),
      }),
      signal: AbortSignal.timeout(60000),
    }), { label: "embed" })
    if (!res.ok) throw new Error(`Embedding ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    for (const e of data.embeddings ?? []) out.push(e.values ?? [])
  }
  if (out.length !== texts.length) {
    throw new Error(`임베딩 개수 불일치: 요청 ${texts.length}, 응답 ${out.length}`)
  }
  return out
}

/** API 사용량 누적 기록. */
export async function logUsage(db, kind, calls, items) {
  const day = new Date().toISOString().slice(0, 10)
  await db.execute({
    sql: `INSERT INTO pc_api_usage (day, kind, calls, items) VALUES (?, ?, ?, ?)
          ON CONFLICT(day, kind) DO UPDATE SET calls = calls + excluded.calls,
                                               items = items + excluded.items`,
    args: [day, kind, calls, items],
  })
}
