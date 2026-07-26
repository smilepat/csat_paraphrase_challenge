// E2E DB 를 매 실행마다 새로 만든다.
// 이전 실행이 남긴 승인 지문·방이 있으면 "승인한 지문"과 "방이 고른 지문"이
// 어긋나 테스트가 엉뚱한 이유로 실패한다(실제로 그렇게 한 번 실패했다).
import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { createClient } from "@libsql/client"

const E2E_URL = "file:./e2e.db"

export default async function globalSetup() {
  for (const f of ["e2e.db", "e2e.db-journal", "e2e.db-wal", "e2e.db-shm"]) {
    if (existsSync(f)) rmSync(f)
  }

  const env = { ...process.env, TURSO_DATABASE_URL: E2E_URL, TURSO_AUTH_TOKEN: "" }
  execFileSync("node", ["scripts/run-schema.mjs"], { env, stdio: "pipe" })
  execFileSync("node", ["scripts/import-passages.mjs"], { env, stdio: "pipe" })

  // 보강 결과(명제·모범답안)를 개발 DB 에서 복사한다. API 를 다시 부르지 않기 위해서다.
  // 개발 DB 가 없으면 최소 픽스처를 직접 넣는다(신규 클론·CI 대비).
  const dst = createClient({ url: E2E_URL })
  let copied = 0
  if (existsSync("local.db")) {
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

  if (copied === 0) {
    await dst.execute({
      sql: `UPDATE pc_passages SET propositions=?, model_answers=?, review_status='draft'
            WHERE id = (SELECT id FROM pc_passages ORDER BY id LIMIT 1)`,
      args: [
        JSON.stringify([
          "Fast guidance improves short-term results for learners.",
          "Learners who always depend on help fail to build independence.",
          "Struggling and correcting mistakes builds stronger understanding.",
        ]),
        JSON.stringify([
          "Fast help works at first, but struggle teaches students to think alone.",
          "Guidance speeds results, yet mistakes build real independent thinking.",
        ]),
      ],
    })
  }

  const c = await dst.execute("SELECT review_status, COUNT(*) n FROM pc_passages GROUP BY review_status")
  console.log("[e2e-setup]", c.rows.map((x) => `${x.review_status} ${x.n}`).join(", "))
}
