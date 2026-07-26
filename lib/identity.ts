// ============================================================
// lib/identity.ts — 학생 기기 식별 (클라이언트 전용, localStorage)
//
// 이식 원본: Korea_English_Solution/lib/student-identity.ts
//
// 여기 저장되는 것은 "이 브라우저가 이 방에서 누구였나"뿐이다.
// 신원 판정은 서버가 하고 그 결과만 캐싱한다.
// ============================================================

import { normalizeCode } from "./codes"

export interface PlayerSession {
  code: string
  playerId: string
  nickname: string
  deviceToken: string
}

const KEY = "pc_player_identity"
const DEVICE_KEY = "pc_device_token"

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

/** 기기 고유 토큰. 형제·공용 기기를 구분하진 못하지만 새로고침에는 견딘다. */
export function deviceToken(): string {
  if (!isBrowser()) return ""
  let t = window.localStorage.getItem(DEVICE_KEY)
  if (!t) {
    t = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_KEY, t)
  }
  return t
}

function readAll(): Record<string, PlayerSession> {
  if (!isBrowser()) return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const o = JSON.parse(raw)
    return o && typeof o === "object" ? o : {}
  } catch {
    return {}
  }
}

export function getSession(code: string): PlayerSession | null {
  const c = normalizeCode(code)
  const s = readAll()[c]
  return s?.playerId ? s : null
}

export function saveSession(s: PlayerSession): void {
  if (!isBrowser()) return
  const all = readAll()
  all[normalizeCode(s.code)] = s
  window.localStorage.setItem(KEY, JSON.stringify(all))
}

export function clearSession(code: string): void {
  if (!isBrowser()) return
  const all = readAll()
  delete all[normalizeCode(code)]
  window.localStorage.setItem(KEY, JSON.stringify(all))
}
