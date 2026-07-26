#!/usr/bin/env node
// ============================================================
// 어휘 빈도 순위표 생성 — data/freq-rank.json
//
// 원천: C:/tmp/vocab-context/designed_min_clean.csv
//       수능 코퍼스 기반 상위빈도 6,302 표제어. id 컬럼이 곧 빈도 순위(1=the).
//
// 이 순위가 "쉬운 표현" 채점의 근거다. 하드코딩한 어려운 단어 목록을 대체한다.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const SRC = process.argv[2] || "C:/tmp/vocab-context/designed_min_clean.csv"
const OUT = "data/freq-rank.json"

/** 따옴표를 고려한 최소 CSV 파서 (이 파일은 표제어만 필요해 2컬럼까지만 읽는다). */
function parseRow(line) {
  const out = []
  let cur = "", q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ",") { out.push(cur); cur = ""; if (out.length >= 2) return out }
    else cur += c
  }
  out.push(cur)
  return out
}

const text = readFileSync(SRC, "utf8").replace(/^\uFEFF/, "")
const lines = text.split(/\r?\n/).filter(Boolean)
const header = parseRow(lines[0])
if (header[0] !== "id" || header[1] !== "headword") {
  throw new Error(`예상과 다른 헤더: ${header.join(",")} (id,headword 이어야 함)`)
}

const rank = {}
let skipped = 0
for (const line of lines.slice(1)) {
  const [id, headword] = parseRow(line)
  const w = (headword || "").trim().toLowerCase()
  const r = Number(id)
  // 단일 낱말만 받는다. 구(phrase)는 토큰 단위 조회에 쓸 수 없다.
  if (!w || !Number.isFinite(r) || !/^[a-z][a-z'-]*$/.test(w)) { skipped++; continue }
  if (rank[w] === undefined || r < rank[w]) rank[w] = r
}

mkdirSync("data", { recursive: true })
writeFileSync(OUT, JSON.stringify(rank), "utf8")

const ranks = Object.values(rank)
console.log(`[freq] ${SRC}`)
console.log(`[freq] 표제어 ${ranks.length}개 적재 (제외 ${skipped}개: 구·비알파벳)`)
console.log(`[freq] 순위 범위 ${Math.min(...ranks)}~${Math.max(...ranks)}`)
console.log(`[freq] 표본: the=${rank.the} people=${rank.people} because=${rank.because} ` +
  `therefore=${rank.therefore} nevertheless=${rank.nevertheless ?? "미등재"}`)
console.log(`[freq] → ${OUT}`)
