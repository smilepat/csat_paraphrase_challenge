// ============================================================
// lib/db.ts — Turso/libSQL 클라이언트 (env-gated graceful fallback)
//
// 이식 원본: Korea_English_Solution/lib/turso.ts
//
// 모듈 로드 시점에 throw 하지 않는다. env 가 없으면 빌드·테스트·로컬 개발이
// 전부 막히기 때문. 대신:
//   1. TURSO_DATABASE_URL + TOKEN 있음 → 원격 Turso
//   2. file: URL 만 있음               → 로컬 SQLite 파일
//   3. 아무것도 없음 + 비운영           → file:./local.db 로 폴백 (경고 1회)
//   4. 아무것도 없음 + 운영             → 쿼리 시점에 명확한 에러 (로드 시점 아님)
// ============================================================

import { createClient, type Client } from "@libsql/client"

const LOCAL_FALLBACK_URL = "file:./local.db"

function readEnv() {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  // 토큰에 줄바꿈·따옴표가 섞여 들어오는 사고가 잦아 방어적으로 정리한다
  const authToken = process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
  return { url, authToken }
}

/** env 미설정 상태로 운영에서 쿼리가 실행되면 그때 실패시키는 클라이언트. */
function createUnconfiguredClient(): Client {
  const fail = () => {
    throw new Error(
      "Turso 가 설정되지 않았습니다. TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 을 확인하세요.",
    )
  }
  return new Proxy({} as Client, { get: fail, apply: fail })
}

let warned = false

function createDbClient(): Client {
  const { url, authToken } = readEnv()

  if (url && authToken) return createClient({ url, authToken })
  if (url?.startsWith("file:")) return createClient({ url })

  if (process.env.NODE_ENV === "production") return createUnconfiguredClient()

  if (!warned) {
    warned = true
    console.warn(
      `[db] TURSO_DATABASE_URL/TOKEN 미설정 → ${LOCAL_FALLBACK_URL} 로 폴백합니다. ` +
        "스키마 적용: npm run db:schema",
    )
  }
  return createClient({ url: LOCAL_FALLBACK_URL })
}

// HMR 로 인한 클라이언트 중복 생성을 막는다
const globalForDb = globalThis as unknown as { __pcDb?: Client }

export const db: Client = globalForDb.__pcDb ?? createDbClient()

if (process.env.NODE_ENV !== "production") globalForDb.__pcDb = db
