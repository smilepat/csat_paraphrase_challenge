#!/usr/bin/env node
// ============================================================
// 40번 요약문 골드 스텁 채우기.  npm run tasks:gold [-- --apply] [-- --local]
//
// 스텁은 "지문에서 요약문에 대응하는 절을 찾아 자극을 옮기고 정답 쌍을 적어라"를
// 사람에게 요구한다. 빈칸 (A)/(B) 가 곧 정답이라 자동 추출이 불가능하기 때문이다.
// 여기 있는 표는 **사람이 지문을 읽고 정한 것**이며, 스크립트는 그 판단을
// 지문 좌표로 옮기는 일만 한다.
//
// 기본은 미리보기다. --apply 를 줘야 DB 를 고친다.
// ============================================================
import { createClient } from "@libsql/client"
import { loadEnv } from "./_shared.mjs"
import { sentences } from "../lib/tasks/segment.ts"

loadEnv()
const local = process.argv.includes("--local")
const apply = process.argv.includes("--apply")
const url = (!local && process.env.TURSO_DATABASE_URL?.trim()) || "file:./local.db"
const authToken = local ? null : process.env.TURSO_AUTH_TOKEN?.replace(/[^A-Za-z0-9._-]/g, "")
const db = authToken ? createClient({ url, authToken }) : createClient({ url })

/**
 * needle  — 지문에서 찾을 조각(문장으로 자동 확장된다)
 * form    — 학생이 만들 목표 구조. 대개 명사구로 접기(fold)지만,
 *           2020 처럼 지문이 이미 명사구인 해는 반대로 문장으로 펴기(unfold)다.
 * gold    — 정답 쌍(절 → 이름). 검수자가 보는 근거이자 M9 판정의 참고가 된다.
 */
const PAIRS = {
  "CSAT_2015_40#t2-04": {
    needle: "People vary a great deal both in the intensity",
    dir: "fold", form: "noun_phrase",
    gold: "People vary a great deal both in the intensity of their response to art and in the form which that response takes → the degrees and forms of people's actual responses",
  },
  "CSAT_EVEN_2025_40#t2-04": {
    needle: "synthetic ingredients can be made in a",
    dir: "fold", form: "noun_phrase",
    gold: "synthetic ingredients can be made in a precisely controlled fashion → the controllability of the production process",
  },
  "CSAT_EVEN_2025_40#t2-01": {
    needle: "natural ingredients\noften vary appreciably",
    dir: "fold", form: "noun_phrase",
    gold: "natural ingredients often vary appreciably in their composition and properties → the variability of natural food ingredients",
  },
  "CSAT_EVEN_2024_40#t2-03": {
    needle: "Knowledge\ngained earlier certainly will not have disappeared",
    dir: "fold", form: "noun_phrase",
    gold: "Knowledge gained earlier … will have become simplified by condensing into formulas → the previously gained knowledge retained in simplified forms",
  },
  "CSAT_EVEN_2023_40#t2-02": {
    needle: "schools may\nfail to provide the tools",
    dir: "fold", form: "noun_phrase",
    gold: "schools may fail to provide the tools to do good work, and workplaces may not truly value the aspiration for quality → factors that limit its full development",
  },
  "CSAT_EVEN_2022_40#t2-04": {
    needle: "scientific explanation consists in the unification",
    dir: "fold", form: "noun_phrase",
    gold: "scientific explanation consists in the unification of broad bodies of phenomena under a minimal number of generalizations → the least number of principles covering all observations",
  },
  "CSAT_EVEN_2021_40#t2-03": {
    needle: "The conception of political power as a",
    dir: "unfold", form: "clause",
    gold: "The conception of political power as a coercive force … is not a universal → ideas of political power are not uniform across cultures",
  },
  "CSAT_EVEN_2020_40#t2-02": {
    needle: "the form of which reflects the strength",
    dir: "unfold", form: "clause",
    gold: "the strength of the social bond between the individuals → how much they are socially tied",
  },
  "CSAT_EVEN_2019_40#t2-03": {
    needle: "human\nbehavioral preference for current consumption",
    dir: "unfold", form: "clause",
    gold: "human behavioral preference for current consumption/return → people tend to favor more immediate outputs",
  },
  "CSAT_EVEN_2017_40#t2-04": {
    needle: "variations in\nresidents’ feelings",
    dir: "fold", form: "noun_phrase",
    gold: "residents' feelings … are related to the type of tourism, the extent to which residents feel the natural environment needs to be protected, and the distance residents live from the tourist attractions → factors such as the type of tourism, opinions on the degree of protection, and their distance from an attraction",
  },
  "CSAT_EVEN_2016_40#t2-03": {
    needle: "There can be broad, influential factors",
    dir: "fold", form: "noun_phrase",
    gold: "broad, influential factors, sometimes of an economic nature, that hold down the performance of everyone being judged → contextual factors affecting the individual's performance",
  },
  "CSAT_B_2014_40#t2-03": {
    needle: "he might foster the rather undesirable impression",
    dir: "fold", form: "noun_phrase",
    gold: "he might foster the rather undesirable impression of being an irresponsible consumer → save face",
  },
}

// ⚠ args 를 빼면 **원격에서만** 죽는다(`Object.entries(undefined)`).
// 파일 클라이언트는 봐주고 HTTP 클라이언트는 안 봐준다 — 로컬 성공이 원격 성공을
// 보장하지 않는다. 객체 형태로 부를 때는 args 를 항상 준다.
const { rows } = await db.execute({
  sql: `SELECT t.id, t.passage_id, p.body FROM pc_tasks t
        JOIN pc_passages p ON p.id = t.passage_id
        WHERE t.origin = 'gold' ORDER BY t.id`,
  args: [],
})

console.log(`[gold] target=${url} · 골드 스텁 ${rows.length}건${apply ? "" : " (미리보기 — --apply 로 반영)"}\n`)

let ok = 0
const missing = []
for (const r of rows) {
  const id = String(r.id)
  const spec = PAIRS[id]
  if (!spec) {
    missing.push(id)
    continue
  }
  const body = String(r.body)
  // 지문은 OCR 유래라 **문장 중간에 줄바꿈**이 있다. 조각을 그대로 indexOf 하면
  // 11건 중 4건이 안 잡힌다 — 공백 종류를 무시하고 찾는다.
  const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(spec.needle.split(/\s+/).map(escape).join("\\s+"))
  const at = body.search(pattern)
  if (at < 0) {
    console.error(`  ✗ ${id} — 지문에서 조각을 못 찾음: "${spec.needle.slice(0, 40)}"`)
    continue
  }
  const host = sentences(body).find((s) => at >= s.start && at < s.end)
  if (!host) {
    console.error(`  ✗ ${id} — 문장 경계를 못 찾음`)
    continue
  }

  console.log(`  ${id}  [${spec.dir}]`)
  console.log(`     자극 ← "${host.text.replace(/\s+/g, " ").slice(0, 96)}"`)
  console.log(`     정답 : ${spec.gold.replace(/\s+/g, " ").slice(0, 110)}`)

  if (apply) {
    await db.execute({
      sql: `UPDATE pc_tasks
            SET stimulus_start=?, stimulus_end=?, stimulus_text=?,
                context_start=?, context_end=?, direction=?, target_form=?,
                gold=?, review_status='approved', updated_at=datetime('now')
            WHERE id = ?`,
      args: [
        host.start, host.end, host.text, host.start, host.end,
        spec.dir, spec.form,
        JSON.stringify([{ text: spec.gold, note: "40번 요약문 정답 쌍(사람 확정)" }]),
        id,
      ],
    })
  }
  ok++
}

if (missing.length) console.error(`\n표에 없는 스텁: ${missing.join(", ")}`)
console.log(`\n${apply ? "반영" : "확인"} ${ok}/${rows.length}건`)
if (apply) {
  const s = await db.execute(
    "SELECT review_status, count(*) c FROM pc_tasks WHERE origin='gold' GROUP BY 1",
  )
  console.log("골드 현황:", s.rows.map((x) => `${x.review_status}=${x.c}`).join(" "))
}
