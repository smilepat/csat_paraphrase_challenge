#!/usr/bin/env node
// ============================================================
// M10 킬 기준 — 3축이 실제로 갈리는가.  npm run typed:simulate
//
// **무료다.** 유료 판정을 부르지 않고 각 축의 1단(무료)만 쓴다:
//   유형1 → 회피 검사(avoid_words 재사용률)
//   유형2 → 구조 검사(정형동사)
//   유형3 → 채점기 없음(M13) → 이 축은 비워 둔다
//
// ⚠ 이 시뮬레이션이 증명하는 것과 못 하는 것을 구분할 것.
//   증명하는 것: **측정 도구가 축의 차이를 보존하는가.** 서로 다르게 잘하는
//   학습자를 넣었을 때 축 점수가 실제로 갈라지는지, 아니면 채점·집계가
//   차이를 뭉개는지.
//   증명하지 못하는 것: 실제 학생의 축이 다른가. 답안을 내가 만들었으므로
//   그건 여기서 알 수 없다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"
import { scoreType2 } from "../lib/scoring/typed/type2.ts"
import { checkAvoidance, avoidanceScore } from "../lib/scoring/typed/type1.ts"
import { threeAxisProfile, axisSeparation, weakestAxis } from "../lib/learners/history.ts"

loadEnv()
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const tasks = (await db.execute(
  "SELECT id, type, direction, stimulus_text, target_form, avoid_words FROM pc_tasks WHERE type IN (1,2) ORDER BY id",
)).rows

const t1 = tasks.filter((t) => t.type === 1)
const t2 = tasks.filter((t) => t.type === 2)
console.log(`[simulate] 태스크 유형1 ${t1.length} · 유형2 ${t2.length} · 유형3 0(M13 미구현)\n`)

// ── 합성 학습자: 축마다 다른 실력을 준다 ────────────────────
// 이것이 핵심이다. 세 사람이 축별로 다르게 잘하는데도 점수가 같이 움직이면
// 축을 나눈 의미가 없다.
const PERSONAS = {
  "어휘강·구조약": { t1: 0.9, t2: 0.15 },
  "어휘약·구조강": { t1: 0.15, t2: 0.9 },
  "둘 다 중간": { t1: 0.5, t2: 0.5 },
}

/** 유형1 답안: 성공하면 금지어를 피해 쓰고, 실패하면 자극을 그대로 옮긴다. */
function answerT1(task, success) {
  if (!success) return task.stimulus_text
  const avoid = new Set(JSON.parse(task.avoid_words ?? "[]").map((w) => w.toLowerCase()))
  // 금지어를 지운 뼈대에 중립적인 말을 붙인다 — 회피율만 보는 단계다
  const kept = task.stimulus_text
    .split(/\s+/)
    .filter((w) => !avoid.has(w.toLowerCase().replace(/[^a-z]/g, "")))
    .slice(0, 12)
    .join(" ")
  return `${kept} in other terms entirely`
}

/** 유형2 답안: 성공하면 목표 구조로, 실패하면 자극을 그대로 옮긴다. */
function answerT2(task, success) {
  if (!success) return task.stimulus_text
  return task.target_form === "clause"
    ? `it can be described this way`
    : `the described situation`
}

// 결정론적 의사난수 — Math.random 을 쓰면 실행마다 결과가 달라져 비교가 안 된다
let seed = 20260815
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

const DAYS = 7
const PER_DAY = 4

const rows = []
for (const [name, skill] of Object.entries(PERSONAS)) {
  for (let d = 0; d < DAYS; d++) {
    const day = `2026-08-${String(10 + d).padStart(2, "0")}`
    for (let k = 0; k < PER_DAY; k++) {
      // 유형 1
      const a = t1[(d * PER_DAY + k) % t1.length]
      const ok1 = rnd() < skill.t1
      const ans1 = answerT1(a, ok1)
      const free1 = checkAvoidance({
        answer: ans1,
        stimulus: a.stimulus_text,
        avoidWords: JSON.parse(a.avoid_words ?? "[]"),
      })
      rows.push({
        persona: name, type: 1, day,
        score: free1.fail ? 0 : Math.round(avoidanceScore(free1.avoidance) * 100),
        errorName: free1.fail ? "원문 낱말을 아직 안 바꿈" : null,
      })

      // 유형 2
      const b = t2[(d * PER_DAY + k) % t2.length]
      const ok2 = rnd() < skill.t2
      const ans2 = answerT2(b, ok2)
      const s2 = scoreType2({
        answer: ans2,
        stimulus: b.stimulus_text,
        target: b.target_form,
      })
      rows.push({
        persona: name, type: 2, day,
        // 무료 단계만 쓴다: 확신 통과 100, 미룸 50, 확신 실패 0
        score: s2.structure === "pass" ? 100 : s2.structure === "unclear" ? 50 : 0,
        errorName: s2.structure === "fail" ? "구조를 바꾸지 않음" : null,
      })
    }
  }
}

// ── 결과 ────────────────────────────────────────────────────
console.log("페르소나          유형1   유형2   유형3   축 간 간격   가장 약한 축")
const seps = []
for (const name of Object.keys(PERSONAS)) {
  const mine = rows.filter((r) => r.persona === name)
  const profile = threeAxisProfile(mine)
  const sep = axisSeparation(profile)
  seps.push({ name, profile, sep })
  const f = (i) => (profile[i].mean === null ? "  -  " : profile[i].mean.toFixed(1).padStart(5))
  console.log(
    `${name.padEnd(16)} ${f(0)}   ${f(1)}   ${f(2)}   ${String(sep === null ? "판정불가" : sep.toFixed(1)).padStart(8)}     유형 ${weakestAxis(profile) ?? "-"}`,
  )
}

// 킬 기준 1: 한 학습자 안에서 축이 갈리는가
const within = seps.filter((s) => s.sep !== null && s.sep >= 20)
// 킬 기준 2: 프로필이 다른 학습자가 서로 구별되는가 (가장 약한 축이 갈려야 한다)
const weakest = seps.map((s) => weakestAxis(s.profile))
const distinct = new Set(weakest.filter(Boolean)).size

console.log(`\n축 간 간격 20점 이상인 학습자: ${within.length}/${seps.length}`)
console.log(`가장 약한 축이 서로 다른 페르소나: ${distinct}종`)
console.log("유형3: 채점기 없음(M13) — 이 축은 판정에서 제외했다. 0 으로 세면 거짓 통과한다.")

const pass = within.length >= 2 && distinct >= 2
console.log(`\n[simulate] ${pass ? "통과 — 측정 도구가 축의 차이를 보존한다" : "실패 — 축이 같이 움직인다"}`)
if (!pass) process.exit(1)
