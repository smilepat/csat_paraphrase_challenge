// ============================================================
// lib/gemini.ts — Gemini 호출 + 임베딩
//
// 이식 원본: Korea_English_Solution/lib/gemini.ts
// 채점용으로 다음을 추가했다:
//   - LLM 킬 스위치 (PARAPHRASE_LLM=off → 임베딩+규칙만으로 동작 유지)
//   - 임베딩 배치 호출 (라운드당 30명을 1~2 요청으로)
//   - 일일 호출 상한 (과거 429 prepay 소진 사고 대비)
// ============================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

// gemini-2.0-flash 는 2026 중반 퇴역(404). 현행 안정 모델을 기본값으로 둔다.
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
const EMBED_MODEL = "text-embedding-004"
const BASE = "https://generativelanguage.googleapis.com/v1beta/models"

/** 판정 LLM 을 끈다. 임베딩과 규칙 채점은 계속 동작한다. */
export function isLlmEnabled(): boolean {
  return process.env.PARAPHRASE_LLM?.trim().toLowerCase() !== "off" && Boolean(GEMINI_API_KEY)
}

export function hasApiKey(): boolean {
  return Boolean(GEMINI_API_KEY)
}

// ---- 일일 호출 상한 (프로세스 메모리 기준의 최소 안전장치) ----
// 서버리스에서는 인스턴스별로 리셋되므로 완벽한 상한은 아니다. 폭주를 막는
// 1차 방어선이고, 정확한 집계는 pc_api_usage 테이블이 담당한다.
const DAILY_LIMIT = Number(process.env.GEMINI_DAILY_LIMIT || 2000)
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
  return usageDay === today() && usageCount >= DAILY_LIMIT
}

export function usageSnapshot(): { day: string; count: number; limit: number } {
  return { day: usageDay || today(), count: usageCount, limit: DAILY_LIMIT }
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

export async function callGemini(
  prompt: string,
  systemInstruction?: string,
  opts?: GeminiOpts,
): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.")
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
  const res = await fetch(`${BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
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
  return JSON.parse(s) as T
}

/** 단일 텍스트 임베딩. */
export async function embed(text: string): Promise<number[]> {
  const [v] = await embedBatch([text])
  return v
}

/**
 * 배치 임베딩. 학생 30명 답안을 요청 1~2회로 처리한다.
 * batchEmbedContents 는 요청당 100건 제한이 있어 청크로 나눈다.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.")
  if (texts.length === 0) return []
  if (isOverDailyLimit()) throw new Error("Gemini 일일 호출 상한에 도달했습니다.")

  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100)
    noteApiCall()
    const res = await fetch(`${BASE}/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: chunk.map((t) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: t.slice(0, 2000) }] },
        })),
      }),
      signal: AbortSignal.timeout(30000),
    })

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
