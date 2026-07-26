// ============================================================
// lib/gemini.ts — Gemini 호출 + 임베딩
//
// 이식 원본: Korea_English_Solution/lib/gemini.ts
// 채점용으로 다음을 추가했다:
//   - LLM 킬 스위치 (PARAPHRASE_LLM=off → 임베딩+규칙만으로 동작 유지)
//   - 임베딩 배치 호출 (라운드당 30명을 1~2 요청으로)
//   - 일일 호출 상한 (과거 429 prepay 소진 사고 대비)
// ============================================================

// env 는 전부 지연 조회한다. 모듈 로드 시점에 읽으면 서버리스 콜드스타트나
// 스크립트의 .env.local 로딩보다 먼저 평가돼 빈 값이 굳어버린다.
const apiKey = () => process.env.GEMINI_API_KEY

// gemini-2.0-flash 는 2026 중반 퇴역(404). 현행 안정 모델을 기본값으로 둔다.
const GEMINI_MODEL = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
// text-embedding-004 는 퇴역(404). 2026-07 기준 사용 가능한 임베딩 모델은
// gemini-embedding-001 / -2 / -2-preview 세 가지다.
// -2 를 쓰는 이유: 의미 역전 문장과 올바른 패러프레이즈의 분리력이 001 보다 훨씬 낫다
//   (001: 0.804 vs 0.812 — 사실상 구별 못 함 / -2: 0.840 vs 0.915).
// 768 차원은 3072 와 성능 차이가 거의 없으면서 저장량이 1/4 이다(MRL 절단).
const EMBED_MODEL = () => process.env.GEMINI_EMBED_MODEL?.trim() || "gemini-embedding-2"
export const EMBED_DIM = () => Number(process.env.GEMINI_EMBED_DIM || 768)
const BASE = "https://generativelanguage.googleapis.com/v1beta/models"

/** 판정 LLM 을 끈다. 임베딩과 규칙 채점은 계속 동작한다. */
export function isLlmEnabled(): boolean {
  return process.env.PARAPHRASE_LLM?.trim().toLowerCase() !== "off" && Boolean(apiKey())
}

export function hasApiKey(): boolean {
  return Boolean(apiKey())
}

// ---- 일일 호출 상한 (프로세스 메모리 기준의 최소 안전장치) ----
// 서버리스에서는 인스턴스별로 리셋되므로 완벽한 상한은 아니다. 폭주를 막는
// 1차 방어선이고, 정확한 집계는 pc_api_usage 테이블이 담당한다.
const dailyLimit = () => Number(process.env.GEMINI_DAILY_LIMIT || 2000)
let usageDay = ""
let usageCount = 0

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function noteApiCall(n = 1): void {
  const d = today()
  if (d !== usageDay) {
    usageDay = d
    usageCount = 0
  }
  usageCount += n
}

export function isOverDailyLimit(): boolean {
  return usageDay === today() && usageCount >= dailyLimit()
}

export function usageSnapshot(): { day: string; count: number; limit: number } {
  return { day: usageDay || today(), count: usageCount, limit: dailyLimit() }
}

export interface GeminiOpts {
  /** true 면 responseMimeType=application/json 으로 순수 JSON 을 강제한다.
   *  gemini-2.5-flash 는 지시만으로는 한국어 서두를 붙이는 경우가 있다. */
  json?: boolean
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 재시도. 네트워크 끊김과 429/5xx 만 다시 시도한다.
 * 400/404 는 요청 자체의 문제라 재시도해도 같으므로 즉시 던진다.
 * (수업 중 한 번의 ECONNRESET 으로 라운드 채점이 통째로 실패하면 안 된다)
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = String((e as Error)?.message ?? e)
      const retriable =
        /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|terminated|aborted/i.test(msg) ||
        /(429|500|502|503|504)/.test(msg)
      if (!retriable || i === attempts - 1) throw e
      await sleep(1000 * 2 ** i)
    }
  }
  throw lastErr
}

export async function callGemini(
  prompt: string,
  systemInstruction?: string,
  opts?: GeminiOpts,
): Promise<string> {
  return withRetry(() => callGeminiOnce(prompt, systemInstruction, opts))
}

async function callGeminiOnce(
  prompt: string,
  systemInstruction?: string,
  opts?: GeminiOpts,
): Promise<string> {
  if (!apiKey()) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.")
  if (isOverDailyLimit()) throw new Error("Gemini 일일 호출 상한에 도달했습니다.")

  const generationConfig: Record<string, unknown> = {
    temperature: opts?.temperature ?? 0.2,
    maxOutputTokens: opts?.maxOutputTokens ?? 4096,
  }
  if (opts?.json) generationConfig.responseMimeType = "application/json"

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  }
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] }

  noteApiCall()
  const res = await fetch(`${BASE}/${GEMINI_MODEL()}:generateContent?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 60000),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Gemini API 오류 (${res.status}): ${errorText.slice(0, 500)}`)
  }

  const data: GeminiResponse = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error("Gemini 응답이 비어있습니다.")
  return text
}

/**
 * 모델 응답에서 JSON 을 관대하게 추출·파싱한다.
 * 코드펜스와 앞뒤 서두 텍스트를 제거하고 첫 균형 블록을 파싱한다.
 */
export function parseGeminiJson<T = unknown>(raw: string): T {
  let s = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  const firstArr = s.indexOf("[")
  const firstObj = s.indexOf("{")
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstArr, firstObj)
  if (start > 0) {
    const openChar = s[start]
    const closeChar = openChar === "[" ? "]" : "}"
    const end = s.lastIndexOf(closeChar)
    if (end > start) s = s.slice(start, end + 1)
  }
  try {
    return JSON.parse(s) as T
  } catch (e) {
    // 응답이 잘리면(maxOutputTokens 초과 등) 온전한 최상위 객체만 건져낸다.
    // 수업 중 30명 판정이 통째로 날아가는 것보다 일부라도 살리는 편이 낫다.
    const salvaged = salvageObjects(s)
    if (salvaged.length) return salvaged as T
    throw e
  }
}

/** 문자열 안의 괄호를 무시하며 균형 잡힌 최상위 {...} 들만 추출한다. */
function salvageObjects(s: string): unknown[] {
  const out: unknown[] = []
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
        try { out.push(JSON.parse(s.slice(startIdx, i + 1))) } catch { /* 부분 객체는 버린다 */ }
        startIdx = -1
      }
    }
  }
  return out
}

/** 단일 텍스트 임베딩. */
export async function embed(text: string): Promise<number[]> {
  const [v] = await embedBatch([text])
  return v
}

/**
 * 테스트 전용 결정론적 가짜 임베딩 (PARAPHRASE_FAKE_EMBED=1).
 *
 * E2E 가 실제 API 를 때리면 느리고, 돈이 들고, 네트워크에 흔들린다.
 * 해시 기반 bag-of-words 벡터라 "같은 단어가 많으면 유사도가 높다"는 성질은
 * 유지되므로 흐름 검증에는 충분하다.
 * 점수의 절대값은 의미가 없다 — 채점 품질 검증은 npm run calibrate 가 한다.
 */
function fakeEmbedding(text: string, dim = 64): number[] {
  const v = new Array(dim).fill(0)
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 2166136261
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    v[Math.abs(h) % dim] += 1
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

function useFakeEmbeddings(): boolean {
  return process.env.PARAPHRASE_FAKE_EMBED === "1"
}

/**
 * 배치 임베딩. 학생 30명 답안을 요청 1~2회로 처리한다.
 * batchEmbedContents 는 요청당 100건 제한이 있어 청크로 나눈다.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  if (useFakeEmbeddings()) return texts.map((t) => fakeEmbedding(t))
  if (!apiKey()) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.")
  if (isOverDailyLimit()) throw new Error("Gemini 일일 호출 상한에 도달했습니다.")

  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100)
    noteApiCall()
    const res = await withRetry(() =>
      fetch(`${BASE}/${EMBED_MODEL()}:batchEmbedContents?key=${apiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: chunk.map((t) => ({
          model: `models/${EMBED_MODEL()}`,
          content: { parts: [{ text: t.slice(0, 2000) }] },
          outputDimensionality: EMBED_DIM(),
        })),
      }),
      signal: AbortSignal.timeout(30000),
    }))

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Embedding API 오류 (${res.status}): ${errorText.slice(0, 500)}`)
    }

    const data = await res.json()
    const embeddings: Array<{ values?: number[] }> = data.embeddings ?? []
    if (embeddings.length !== chunk.length) {
      throw new Error(`임베딩 개수 불일치: 요청 ${chunk.length}, 응답 ${embeddings.length}`)
    }
    for (const e of embeddings) out.push(e.values ?? [])
  }
  return out
}
