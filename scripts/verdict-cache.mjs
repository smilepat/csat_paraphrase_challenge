#!/usr/bin/env node
// ============================================================
// 판정 캐시 점검·정리.  npm run typed:cache [-- --purge]
//
// 프롬프트를 고치면 옛 지문의 항목이 남는다. 남아 있어도 **틀린 판정이 나가지는
// 않는다** — 키에 지문이 들어 있어 애초에 안 맞는다. 다만 쌓이기만 하므로 가끔 치운다.
// ============================================================
import { loadEnv } from "./_shared.mjs"
import { verdictCacheStats, purgeStaleVerdicts } from "../lib/scoring/typed/cache.ts"
import { PROMPT_FINGERPRINT as FP1 } from "../lib/scoring/typed/verdict1.ts"
import { PROMPT_FINGERPRINT as FP2 } from "../lib/scoring/typed/verdict2.ts"

loadEnv()

console.log(`현재 프롬프트 지문 — type1 ${FP1} · type2 ${FP2}\n`)
const stats = await verdictCacheStats()
if (stats.length === 0) {
  console.log("캐시가 비어 있습니다.")
} else {
  console.log("종류    지문        건수   적중   현재 프롬프트")
  for (const s of stats) {
    console.log(
      `${s.kind.padEnd(7)} ${s.fingerprint.padEnd(11)} ${String(s.n).padStart(5)} ${String(s.hits).padStart(6)}   ${s.current ? "예" : "아니오(옛것)"}`,
    )
  }
  const stale = stats.filter((s) => !s.current).reduce((a, s) => a + s.n, 0)
  console.log(`\n옛 지문 항목: ${stale}건`)
}

if (process.argv.includes("--purge")) {
  const n = await purgeStaleVerdicts()
  console.log(`정리했습니다: ${n}건 삭제`)
}
