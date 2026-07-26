#!/usr/bin/env node
// 의미 축 진단 — 등급별 명제 유사도 분포를 그대로 본다.
// 임계값을 감으로 돌리기 전에, 신호가 실제로 존재하는지부터 확인한다.
import { readFileSync } from "node:fs"
import { loadEnv, embedBatch } from "./_shared.mjs"
import { cosine } from "../lib/scoring/meaning.ts"
import { sentences } from "../lib/scoring/text.ts"

loadEnv()
const set = JSON.parse(readFileSync("data/calibration/set.json", "utf8"))

const needed = new Set()
for (const p of set.passages) p.propositions.forEach((t) => needed.add(t))
for (const it of set.items) {
  needed.add(it.text)
  sentences(it.text).forEach((s) => needed.add(s))
}
const texts = [...needed]
const vectors = await embedBatch(texts)
const vecOf = new Map(texts.map((t, i) => [t, vectors[i]]))

const rows = []
for (const it of set.items.filter((i) => i.kind !== "verbatim")) {
  const p = set.passages.find((x) => x.id === it.passageId)
  const avs = [vecOf.get(it.text), ...sentences(it.text).map((s) => vecOf.get(s))].filter(Boolean)
  const sims = p.propositions.map((prop) => Math.max(...avs.map((v) => cosine(v, vecOf.get(prop)))))
  rows.push({ gold: it.gold, sims, min: Math.min(...sims), mean: sims.reduce((a, b) => a + b) / sims.length })
}

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) * p)]
}

console.log("등급별 명제 유사도 (문장별 max 적용 후)")
console.log("등급  n   평균sim   최소sim평균   sim분포 p10/p50/p90")
for (let g = 5; g >= 1; g--) {
  const r = rows.filter((x) => x.gold === g)
  if (!r.length) continue
  const all = r.flatMap((x) => x.sims)
  const avgMean = r.reduce((s, x) => s + x.mean, 0) / r.length
  const avgMin = r.reduce((s, x) => s + x.min, 0) / r.length
  console.log(
    `  ${g}  ${String(r.length).padStart(2)}   ${avgMean.toFixed(3)}      ${avgMin.toFixed(3)}` +
    `        ${q(all, 0.1).toFixed(3)} / ${q(all, 0.5).toFixed(3)} / ${q(all, 0.9).toFixed(3)}`,
  )
}

// 전체 답안 벡터만 쓸 때와 문장별 max 를 쓸 때의 차이
console.log("\n문장별 max 가 유사도를 얼마나 올리는가 (과대평가 여부)")
for (let g = 5; g >= 1; g--) {
  const items = set.items.filter((i) => i.gold === g && i.kind !== "verbatim")
  let whole = 0, withSent = 0, n = 0
  for (const it of items) {
    const p = set.passages.find((x) => x.id === it.passageId)
    const w = vecOf.get(it.text)
    const avs = [w, ...sentences(it.text).map((s) => vecOf.get(s))].filter(Boolean)
    for (const prop of p.propositions) {
      const pv = vecOf.get(prop)
      whole += cosine(w, pv)
      withSent += Math.max(...avs.map((v) => cosine(v, pv)))
      n++
    }
  }
  console.log(`  ${g}등급  전체벡터만 ${(whole / n).toFixed(3)}  →  문장별max ${(withSent / n).toFixed(3)}`)
}
