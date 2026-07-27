// 프로덕션 실제 라운드 1회 — 실 Gemini·실 Turso 로 끝까지 도는지 확인.
// 검사용으로 지문 1개를 승인하고, 끝나면 원래대로 draft 로 되돌린다.
import { chromium } from "@playwright/test"

const BASE = "https://csat-paraphrase-challenge.vercel.app"
const PW = process.env.TEACHER_PW || "mw1wgTuZ3Z6p"
const creds = { username: "teacher", password: PW }
const ANSWER = process.env.SMOKE_ANSWER || ""

const browser = await chromium.launch()
const teacher = await browser.newContext({ httpCredentials: creds })
const tp = await teacher.newPage()
const errs = []
tp.on("pageerror", (e) => errs.push("teacher: " + e.message))

// 1) 지문 1개 승인
await tp.goto(`${BASE}/admin/passages?status=draft`, { waitUntil: "networkidle" })
const card = tp.getByTestId("passage-card").first()
const passageId = await card.getAttribute("data-passage-id")
await card.getByText("지문 원문").click()
const body = (await card.locator("p.whitespace-pre-wrap").innerText()).trim()
await card.getByRole("button", { name: "승인" }).click()
await tp.waitForTimeout(2500)
console.log("승인한 지문:", passageId)

// 2) 방 생성
await tp.goto(`${BASE}/host`, { waitUntil: "networkidle" })
await tp.locator("select").selectOption(passageId)
await tp.getByRole("button", { name: "25단어" }).click()
await tp.getByPlaceholder("예: 3학년 2반 5교시").fill("프로덕션 점검")
await tp.getByRole("button", { name: "방 만들기" }).click()
await tp.waitForURL(/\/host\/[A-Z0-9]+/, { timeout: 30000 })
const roomUrl = tp.url()
const code = (await tp.locator("div.text-5xl").innerText()).trim()
console.log("방 코드:", code)

// 3) 학생 입장 (비밀번호 없는 컨텍스트 — 학생은 인증 없이 들어와야 한다)
const stu = await browser.newContext()
const sp = await stu.newPage()
sp.on("pageerror", (e) => errs.push("student: " + e.message))
await sp.goto(`${BASE}/join?code=${code}`, { waitUntil: "networkidle" })
await sp.getByPlaceholder("예: 김민수").fill("점검학생")
await sp.getByRole("button", { name: "입장하기" }).click()
await sp.waitForURL(new RegExp(`/r/${code}`), { timeout: 30000 })
console.log("학생 입장 OK (인증 없이)")

// 4) 라운드 시작 → 제출
await tp.getByRole("button", { name: "라운드 시작" }).click()
const box = sp.getByPlaceholder("Write one or two short, easy sentences.")
await box.waitFor({ timeout: 20000 })
await box.fill(ANSWER)
await sp.getByRole("button", { name: "제출하기" }).click()
await sp.getByText("제출 완료").waitFor({ timeout: 60000 })
console.log("제출 OK (실 임베딩 채점)")

// 5) 마감하고 채점 (실 Gemini 배치 판정)
await tp.getByRole("button", { name: "마감하고 채점" }).click()
await tp.locator("header").getByText("결과 공개").waitFor({ timeout: 120000 })

await sp.reload({ waitUntil: "networkidle" })
await sp.getByText("핵심 보존").waitFor({ timeout: 30000 })
const scores = (await sp.locator("body").innerText()).replace(/\s+/g, " ")
const m = scores.match(/핵심 보존\s*([\d.]+).*?짧게 쓰기\s*([\d.]+).*?쉬운 표현\s*([\d.]+).*?총점\s*([\d.]+)/)
console.log("학생이 본 점수:", m ? `의미 ${m[1]} / 간결 ${m[2]} / 쉬움 ${m[3]} / 총 ${m[4]}` : "(파싱 실패)")
const fb = scores.match(/피드백[^가-힣]*([가-힣][^·]{5,60})/)
if (fb) console.log("한국어 피드백:", fb[1].trim())

// 6) 정리 — 방 종료 + 지문 승인 되돌리기
await tp.getByRole("button", { name: "수업 종료" }).click()
await tp.waitForTimeout(1500)
await tp.goto(`${BASE}/admin/passages?status=approved`, { waitUntil: "networkidle" })
const approved = tp.locator(`[data-passage-id="${passageId}"]`)
if (await approved.count()) {
  await approved.getByRole("button", { name: "승인 취소" }).click()
  await tp.waitForTimeout(2000)
  console.log("정리: 지문 승인 취소 (검수 게이트 원상 복구)")
}

console.log("\n콘솔 오류:", errs.length ? errs : "없음")
console.log(errs.length ? "✗ 실패" : "✓ 프로덕션 실 라운드 통과")
await browser.close()
