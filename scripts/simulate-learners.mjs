#!/usr/bin/env node
// ============================================================
// M10 킬 기준 — 3축이 실제로 갈리는가.  npm run typed:simulate
//
// **무료다.** 유료 판정을 부르지 않고 각 축의 1단(무료)만 쓴다:
//   유형1 → 회피 검사(avoid_words 재사용률)
//   유형2 → 구조 검사(정형동사)
//   유형3 → 범위 겹침(IoU). 원래 무료라 유료 판정을 부를 일이 없다.
//
// ⚠ 예전에는 유형 3 축을 비워 두고 "M13 미구현" 이라고 적어 두었다. 그런데
//   채점기(checkSpan/finalizeType3)는 진작에 있었고 학생 화면에도 배선돼 있었다.
//   그 상태로 킬 기준을 통과시켰으니 **3축이 갈린다는 근거가 사실은 2축 근거**였다.
//   주석이 코드보다 늦게 바뀌면 이렇게 측정 자체가 반쪽이 된다.
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
import { checkSpan, finalizeType3 } from "../lib/scoring/typed/type3.ts"
import { threeAxisProfile, axisSeparation, weakestAxis } from "../lib/learners/history.ts"

loadEnv()
const local = process.argv.includes("--local")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

const tasks = (await db.execute(
  `SELECT id, type, direction, stimulus_text, target_form, avoid_words,
          stimulus_start, answer_start, answer_end
   FROM pc_tasks WHERE type IN (1,2,3) AND review_status='approved' ORDER BY id`,
)).rows

const t1 = tasks.filter((t) => t.type === 1)
const t2 = tasks.filter((t) => t.type === 2)
// 유형 3 은 정답 범위가 있어야 채점된다. 없는 행이 섞이면 IoU 가 전부 0 이 되어
// "다들 못한다" 로 보이는데, 그건 학습자가 아니라 데이터의 문제다.
const t3 = tasks.filter(
  (t) => t.type === 3 && t.answer_start !== null && t.answer_end !== null && t.answer_end > t.answer_start,
)
console.log(`[simulate] 태스크 유형1 ${t1.length} · 유형2 ${t2.length} · 유형3 ${t3.length}\n`)
if (!t3.length) {
  console.error("유형 3 태스크가 없습니다 — 3축 시뮬레이션이 성립하지 않습니다.")
  process.exit(1)
}

// ── 합성 학습자: 축마다 다른 실력을 준다 ────────────────────
// 이것이 핵심이다. 세 사람이 축별로 다르게 잘하는데도 점수가 같이 움직이면
// 축을 나눈 의미가 없다.
const PERSONAS = {
  "어휘강·구조약": { t1: 0.9, t2: 0.15, t3: 0.6 },
  "어휘약·구조강": { t1: 0.15, t2: 0.9, t3: 0.6 },
  // 유형 3 만 약한 사람. 이 사람이 나오지 않으면 "가장 약한 축" 이 1·2 에서만
  // 갈리므로 세 번째 축을 넣은 효과를 확인할 수 없다.
  "범위 못 잡음": { t1: 0.75, t2: 0.75, t3: 0.1 },
  "셋 다 중간": { t1: 0.5, t2: 0.5, t3: 0.5 },
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

/**
 * 유형3 답안: 학생이 표시한 **범위**다. 성공하면 정답 범위에 가깝게,
 * 실패하면 실제로 학생이 하는 두 가지 잘못 중 하나를 낸다.
 *
 * 정답을 그대로 돌려주지 않는 이유: IoU 가 항상 1 이 되어 채점기가 경계를
 * 얼마나 관대하게 보는지 전혀 시험하지 못한다. 살짝 어긋난 범위를 준다.
 */
function answerT3(task, success, coin) {
  const gold = { start: Number(task.answer_start), end: Number(task.answer_end) }
  const len = gold.end - gold.start
  if (success) {
    // 시작을 len/8 만큼 밀어도 IoU 는 (L-s)/(L+s) ≈ 0.78 이라 hit(0.6) 안쪽이다
    const shift = Math.floor(len / 8)
    return { start: gold.start + shift, end: gold.end }
  }
  // 실패 ①: 범위를 너무 짧게 잡는다 → partial (IoU 0.5)
  if (coin < 0.5) return { start: gold.start, end: gold.start + Math.max(1, Math.floor(len / 2)) }
  // 실패 ②: 아예 다른 데를 가리킨다 → miss (IoU 0)
  //   앞쪽에 자리가 없으면 되받는 표현 **뒤**를 잡는다 = 방향을 거꾸로 안 것(invalid)
  if (gold.start >= 40) return { start: 0, end: 30 }
  return { start: Number(task.stimulus_start), end: Number(task.stimulus_start) + 30 }
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
        errorName: free1.fail ? "원문 단어를 아직 안 바꿈" : null,
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

      // 유형 3
      const c = t3[(d * PER_DAY + k) % t3.length]
      const ok3 = rnd() < skill.t3
      const span = answerT3(c, ok3, rnd())
      const free3 = checkSpan({
        answer: span,
        gold: { start: Number(c.answer_start), end: Number(c.answer_end) },
        stimulusStart: Number(c.stimulus_start),
      })
      // 이름 판정(유료)은 부르지 않는다 — 이 유형의 본체는 범위다
      const f3 = finalizeType3(free3, null)
      rows.push({ persona: name, type: 3, day, score: f3.score, errorName: f3.errorName })
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

// 킬 기준 3: **축마다** 사람을 구별하는가.
//
// 앞의 두 기준은 축 1·2 만으로도 만족된다. 그래서 유형 3 축이 통째로 비어 있던
// 시절에도 "통과" 가 떴고, 2축짜리 근거를 3축 근거로 착각했다. 축을 채운 뒤에도
// 같은 함정이 남는다 — 유형 3 이 **누구에게나 100점**이면 값은 있지만 아무것도
// 구별하지 않는다(그 변이를 넣어 보니 앞의 두 기준은 그대로 통과했다).
//
// 그러니 축별로 페르소나 간 평균이 실제로 벌어지는지를 따로 본다.
const AXIS_SPREAD_MIN = 20
const spreads = [0, 1, 2].map((i) => {
  const means = seps.map((s) => s.profile[i].mean).filter((m) => m !== null)
  if (means.length < 2) return { axis: i + 1, spread: null }
  return { axis: i + 1, spread: Math.max(...means) - Math.min(...means) }
})
console.log("\n축별 페르소나 간 점수 폭 (이 축이 사람을 구별하는가)")
for (const s of spreads) {
  const v = s.spread === null ? "값 없음" : `${s.spread.toFixed(1)}점`
  const ok = s.spread !== null && s.spread >= AXIS_SPREAD_MIN
  console.log(`  유형 ${s.axis}: ${v.padStart(8)}  ${ok ? "구별함" : "구별 못 함"}`)
}
const deadAxes = spreads.filter((s) => s.spread === null || s.spread < AXIS_SPREAD_MIN)

const pass = within.length >= 2 && distinct >= 2 && deadAxes.length === 0
if (deadAxes.length) {
  console.log(`\n⚠ 사람을 구별하지 못하는 축: ${deadAxes.map((s) => `유형${s.axis}`).join(", ")}`)
}
console.log(`\n[simulate] ${pass ? "통과 — 세 축이 모두 사람을 구별한다" : "실패 — 축이 같이 움직이거나 죽어 있다"}`)
if (!pass) process.exit(1)
