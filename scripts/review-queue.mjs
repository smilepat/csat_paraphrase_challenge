#!/usr/bin/env node
// ============================================================
// 검수 대기열 점검.  npm run tasks:queue
//
// 화면을 열지 않고 "무엇이 먼저 올라오는가"를 본다. 우선순위 정렬은
// **자르기 전에** 일어나야 하는데, 예전에 id 순으로 잘라 온 뒤 정렬하는 바람에
// 골드 스텁 11건 중 1건만 보였다. 그런 회귀를 여기서 잡는다.
// ============================================================
import { listTasks, taskCounts } from "../app/actions/task-review.ts"

const counts = await taskCounts()
console.log("현황:", counts.map((c) => `${c.status}/유형${c.type}=${c.n}`).join(" ") || "(비어 있음)")

const head = await listTasks("raw", null, 15)
console.log(`\n대기열 상위 ${head.length}건`)
for (const t of head) {
  console.log(`  p${t.priority} 유형${t.view.type} ${t.origin.padEnd(6)} ${t.view.id}`)
}

// 골드는 전부 맨 앞에 있어야 한다
const goldTotal = counts.filter((c) => c.status === "raw").length
  ? (await listTasks("raw", null, 500)).filter((t) => t.origin === "gold").length
  : 0
const goldInHead = head.filter((t) => t.origin === "gold").length
console.log(`\n골드 스텁: 전체 ${goldTotal}건 · 대기열 상위에 ${goldInHead}건`)
if (goldTotal > 0 && goldInHead < Math.min(goldTotal, head.length)) {
  console.error("[queue] 골드가 앞에 오지 않습니다 — 정렬이 자르기 뒤에 일어나고 있습니다")
  process.exit(1)
}
console.log("[queue] 이상 없음")
