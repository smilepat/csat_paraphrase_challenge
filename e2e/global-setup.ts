// E2E DB 를 매 실행마다 새로 만든다.
// 이전 실행이 남긴 승인 지문·방이 있으면 "승인한 지문"과 "방이 고른 지문"이
// 어긋나 테스트가 엉뚱한 이유로 실패한다(실제로 그렇게 한 번 실패했다).
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { createClient } from "@libsql/client"

const E2E_URL = "file:./e2e.db"

/** 그 DB 에 지문 테이블이 실제로 들어 있는가. 파일 유무와 다르다. */
async function hasPassages(url: string): Promise<boolean> {
  if (!existsSync(url.replace(/^file:\.?\/?/, ""))) return false
  try {
    const c = createClient({ url })
    const { rows } = await c.execute("SELECT count(*) n FROM pc_passages")
    return Number(rows[0]?.n ?? 0) > 0
  } catch {
    return false
  }
}

export default async function globalSetup() {
  for (const f of ["e2e.db", "e2e.db-journal", "e2e.db-wal", "e2e.db-shm"]) {
    if (existsSync(f)) rmSync(f)
  }

  const env = { ...process.env, TURSO_DATABASE_URL: E2E_URL, TURSO_AUTH_TOKEN: "" }
  execFileSync("node", ["scripts/run-schema.mjs"], { env, stdio: "pipe" })

  // 지문 원천은 이 PC 에만 있는 경로다(수능 원문이라 레포에 둘 수 없다).
  // ⚠ 그래서 CI 에서는 e2e 가 **여기서 죽어 한 번도 실행된 적이 없었다** —
  //   실패 로그를 보고서야 알았다. 원천이 없으면 직접 쓴 픽스처로 대체한다.
  //   픽스처 지문은 저작권과 무관한 자작이고, 형식만 원천과 맞춘다.
  const realSrc = process.env.PASSAGES_JSON || "C:/tmp/csat-reasoning-bridge-builder/public/passages.json"
  const src = existsSync(realSrc) ? realSrc : "e2e/fixtures/passages.json"
  if (src !== realSrc) console.log(`[e2e-setup] 지문 원천이 없어 픽스처를 씁니다 — ${src}`)
  execFileSync("node", ["scripts/import-passages.mjs", src], { env, stdio: "pipe" })

  // 보강 결과(명제·모범답안)를 개발 DB 에서 복사한다. API 를 다시 부르지 않기 위해서다.
  // 개발 DB 가 없으면 최소 픽스처를 직접 넣는다(신규 클론·CI 대비).
  const dst = createClient({ url: E2E_URL })
  let copied = 0
  // ⚠ 파일이 있는지로 판단하면 안 된다. 단위 테스트가 TURSO_DATABASE_URL 없이 돌면
  //   `file:./local.db` 로 폴백하면서 **테이블이 없는 빈 파일**을 만든다. CI 에서는
  //   그 빈 파일 때문에 여기서 "no such table: pc_passages" 로 죽었다.
  //   그러니 테이블이 실제로 있는지를 본다.
  if (await hasPassages("file:./local.db")) {
    const src = createClient({ url: "file:./local.db" })
    const { rows } = await src.execute(
      "SELECT id, title, topic, propositions, model_answers FROM pc_passages WHERE propositions IS NOT NULL",
    )
    for (const r of rows) {
      const res = await dst.execute({
        sql: `UPDATE pc_passages SET title=?, topic=?, propositions=?, model_answers=?,
                     review_status='draft' WHERE id=?`,
        args: [r.title, r.topic, r.propositions, r.model_answers, r.id],
      })
      copied += res.rowsAffected
    }
  }

  // 개발 DB 가 없으면(CI·신규 클론) 픽스처가 들고 있는 명제·모범 답안을 심는다.
  // ⚠ **세 편 전부** 심어야 한다. 예전에는 첫 한 편만 심었는데, 검수 화면 테스트보다
  //   앞선 테스트가 그 한 편을 승인해 버려 "검수 대기 0" 이 되고 화면이 비었다.
  //   지문이 수백 편인 이 PC 에서는 드러나지 않고 CI 에서만 터지는 종류의 결함이다.
  if (copied === 0) {
    const fixture = JSON.parse(readFileSync("e2e/fixtures/passages.json", "utf8"))
    for (const p of fixture.passages as Array<{
      id: string
      propositions: string[]
      modelAnswers: string[]
    }>) {
      const res = await dst.execute({
        sql: `UPDATE pc_passages SET propositions=?, model_answers=?, review_status='draft'
              WHERE id=?`,
        args: [JSON.stringify(p.propositions), JSON.stringify(p.modelAnswers), p.id],
      })
      copied += res.rowsAffected
    }
  }

  const c = await dst.execute("SELECT review_status, COUNT(*) n FROM pc_passages GROUP BY review_status")
  console.log("[e2e-setup]", c.rows.map((x) => `${x.review_status} ${x.n}`).join(", "))

  await seedStudyTasks(dst)
}

/**
 * 자습 태스크를 심는다.
 *
 * 채굴기를 돌리지 않는 이유: 채굴기에는 자기 테스트가 따로 있고, 여기서 확인할 것은
 * **학습 흐름**이다. 채굴 결과에 의존하면 채굴기가 바뀔 때마다 e2e 가 엉뚱하게 흔들린다.
 *
 * 오프셋은 손으로 적지 않고 지문에서 찾아 계산한다 — 손으로 적으면 반드시 어긋난다.
 * 운영 경로를 그대로 시험하려고 `approved` 로 넣는다(NODE_ENV=production 에서는
 * 승인된 것만 학생에게 나간다).
 */
async function seedStudyTasks(dst: ReturnType<typeof createClient>) {
  const { rows } = await dst.execute(
    "SELECT id, body FROM pc_passages ORDER BY id LIMIT 1",
  )
  if (!rows.length) return
  const passageId = String(rows[0].id)
  const body = String(rows[0].body)

  // 본문에서 실제로 존재하는 문장 하나를 골라 그 위에 세 유형을 얹는다
  const m = body.match(/[A-Z][^.!?]{60,200}[.!?]/)
  if (!m || m.index === undefined) {
    console.warn("[e2e-setup] 자습 태스크를 심을 문장을 못 찾았습니다")
    return
  }
  const sStart = m.index
  const sEnd = m.index + m[0].length
  const sentence = body.slice(sStart, sEnd)

  // 유형 3 은 앞에 받을 문장이 있어야 한다
  const prevEnd = sStart
  const prevStart = Math.max(0, body.lastIndexOf(".", Math.max(0, sStart - 2)) + 1)

  const words = sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []
  const avoid = [...new Set(words)].slice(0, 5)

  const tasks = [
    // 유형 1 — 문장을 다른 낱말로
    [`${passageId}#e2e-t1`, 1, null, sStart, sEnd, sStart, sEnd, sentence, null, null, null, JSON.stringify(avoid)],
    // 유형 2 — 문장을 이름으로 접기
    [`${passageId}#e2e-t2`, 2, "fold", sStart, sEnd, sStart, sEnd, sentence, "noun_phrase", null, null, null],
    // 유형 3 — 이 문장이 앞 문장을 받는다고 두고 범위를 표시
    [`${passageId}#e2e-t3`, 3, "span", prevStart, sEnd, sStart, sEnd, sentence, null, prevStart, prevEnd, null],
  ] as const

  for (const t of tasks) {
    await dst.execute({
      sql: `INSERT OR REPLACE INTO pc_tasks
              (id, passage_id, type, direction, context_start, context_end,
               stimulus_start, stimulus_end, stimulus_text, target_form,
               answer_start, answer_end, avoid_words, origin, review_status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'regex', 'approved')`,
      args: [t[0], passageId, t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11]],
    })
  }

  // 골드 스텁도 하나 심는다 — 지문 전문을 함께 보여주는 화면을 검사해야 한다.
  // 이게 없으면 그 테스트가 조용히 skip 되고, 기능이 깨져도 아무도 모른다.
  await dst.execute({
    sql: `INSERT OR REPLACE INTO pc_tasks
            (id, passage_id, type, direction, context_start, context_end,
             stimulus_start, stimulus_end, stimulus_text, target_form,
             gold, notes, origin, review_status)
          VALUES (?,?,2,'fold',?,?,?,?,?,'noun_phrase',?,?, 'gold', 'raw')`,
    args: [
      `${passageId}#e2e-gold`, passageId, sStart, sEnd, sStart, sEnd, sentence,
      JSON.stringify([{ text: sentence, note: "40번 요약문 원문" }]),
      "검수 필요: 지문에서 이 요약문에 대응하는 절을 찾아 stimulus 를 옮길 것",
    ],
  })
  console.log(`[e2e-setup] 자습 태스크 ${tasks.length}건 승인 + 골드 스텁 1건`)
}
