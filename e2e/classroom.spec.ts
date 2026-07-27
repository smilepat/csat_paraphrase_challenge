import { test, expect, type BrowserContext, type Page } from "@playwright/test"

// ============================================================
// 수업 전 구간 E2E — 검수·승인 → 방 생성 → 학생 2명 조인 → 제출 → 채점 → 결과
//
// 외부 API 는 쓰지 않는다(PARAPHRASE_FAKE_EMBED=1, PARAPHRASE_LLM=off).
// 여기서 보는 것은 "흐름이 끝까지 닫히는가"다.
// 채점 품질 검증은 npm run calibrate 가 따로 한다.
// ============================================================

const GOOD_ANSWER =
  "Quick help makes people faster, but they never learn to find their own way alone."

/** 학생 한 명 = 브라우저 컨텍스트 하나 (localStorage 분리) */
async function joinAs(context: BrowserContext, code: string, name: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`/join?code=${code}`)
  await page.getByPlaceholder("예: 김민수").fill(name)
  await page.getByRole("button", { name: "입장하기" }).click()
  await expect(page).toHaveURL(new RegExp(`/r/${code}`))
  return page
}

test.describe.configure({ mode: "serial" })

test("교사가 지문을 승인하고 방을 열면 학생이 참여해 채점까지 받는다", async ({ browser }) => {
  const teacher = await browser.newContext()
  const teacherPage = await teacher.newPage()

  // ---- 1. 검수·승인 ----
  await teacherPage.goto("/admin/passages?status=draft")
  const firstCard = teacherPage.getByTestId("passage-card").first()
  await expect(firstCard).toBeVisible()
  const passageId = (await firstCard.getAttribute("data-passage-id"))!
  // 승인 대상 지문의 원문을 확보해 둔다(복붙 가드 검증용)
  await firstCard.getByText("지문 원문").click()
  const passageBody = (await firstCard.locator("p.whitespace-pre-wrap").innerText()).trim()
  await firstCard.getByRole("button", { name: "승인" }).click()
  await expect(teacherPage.getByRole("link", { name: /승인됨 [1-9]/ })).toBeVisible()

  // ---- 2. 방 생성 ----
  await teacherPage.goto("/host")
  // 방금 승인한 지문을 명시적으로 고른다 — 기본 선택에 기대면 승인 지문이 늘었을 때 어긋난다
  await teacherPage.locator("select").selectOption(passageId)
  await teacherPage.getByRole("button", { name: "25단어" }).click()
  await teacherPage.getByRole("button", { name: "팀 대항 (BLUE / RED)" }).click()
  await teacherPage.getByPlaceholder("예: 3학년 2반 5교시").fill("E2E 테스트 수업")
  await teacherPage.getByRole("button", { name: "방 만들기" }).click()
  await expect(teacherPage).toHaveURL(/\/host\/[A-Z0-9]+/)

  const code = (await teacherPage.locator("div.text-5xl").innerText()).trim()
  expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)

  // ---- 3. 학생 2명 조인 ----
  const s1ctx = await browser.newContext()
  const s2ctx = await browser.newContext()
  const s1 = await joinAs(s1ctx, code, "민수")
  const s2 = await joinAs(s2ctx, code, "지영")

  await expect(s1.getByText("잠시만 기다리세요")).toBeVisible()
  await expect(teacherPage.getByText("참가자 2명")).toBeVisible({ timeout: 10_000 })

  // ---- 4. 라운드 시작 ----
  await teacherPage.getByRole("button", { name: "라운드 시작" }).click()
  await expect(teacherPage.locator("header").getByText("작성 중")).toBeVisible()

  // 학생 화면이 폴링으로 따라온다
  const answerBox = s1.getByPlaceholder("Write one or two short, easy sentences.")
  await expect(answerBox).toBeVisible({ timeout: 10_000 })

  // ---- 5. 제출: 정상 답안 ----
  await answerBox.fill(GOOD_ANSWER)
  await expect(s1.getByText(`${GOOD_ANSWER.split(" ").length}단어`)).toBeVisible()
  await s1.getByRole("button", { name: "제출하기" }).click()
  await expect(s1.getByText("제출 완료")).toBeVisible({ timeout: 15_000 })

  // ---- 6. 제출: 원문 복붙 (가드가 잡아야 한다) ----
  const copied = passageBody.split(/\s+/).slice(0, 25).join(" ")
  expect(copied.split(" ").length).toBeGreaterThan(12) // 가드 임계 넘는지 확인
  const box2 = s2.getByPlaceholder("Write one or two short, easy sentences.")
  await expect(box2).toBeVisible({ timeout: 10_000 })
  await box2.fill(copied)
  await s2.getByRole("button", { name: "제출하기" }).click()
  await expect(s2.getByText("제출 완료")).toBeVisible({ timeout: 15_000 })

  // ---- 7. 교사 화면에 2/2 제출이 보인다 ----
  await expect(teacherPage.locator("header").getByText("2/2")).toBeVisible({ timeout: 10_000 })

  // ---- 8. 마감하고 채점 ----
  await teacherPage.getByRole("button", { name: "마감하고 채점" }).click()
  await expect(teacherPage.locator("header").getByText("결과 공개")).toBeVisible({ timeout: 60_000 })

  // 복붙 제출이 확인 대상으로 올라와야 한다
  await expect(teacherPage.getByText(/확인이 필요한 제출/)).toBeVisible()
  await expect(teacherPage.getByText(/원문을 \d+단어 연속으로 옮겨 적었습니다/)).toBeVisible()

  // 베스트 답안 비교가 보인다
  await expect(teacherPage.getByText("베스트 답안 비교")).toBeVisible()

  // 핵심: 확인 전의 복붙 제출은 순위·베스트에 오르면 안 된다
  const best = teacherPage.locator("section", { hasText: "베스트 답안 비교" })
  await expect(best.getByText("지영")).toBeHidden()
  await expect(best.getByText("민수")).toBeVisible()
  // 명단에도 점수 대신 보류로 뜬다
  await expect(teacherPage.getByText("확인 대기").first()).toBeVisible()

  // ---- 9. 학생이 결과를 본다 ----
  await expect(s1.getByText("핵심 보존")).toBeVisible({ timeout: 10_000 })
  await expect(s1.getByText("총점")).toBeVisible()

  // 복붙한 학생은 점수 대신 확인 안내를 본다
  await expect(s2.getByText(/선생님이 확인 중입니다/)).toBeVisible({ timeout: 10_000 })
  await expect(s2.getByText("총점")).toBeHidden()

  // ---- 10. 교사가 복붙 제출을 기각 ----
  await teacherPage.getByRole("button", { name: "기각" }).first().click()
  // 처리된 제출은 확인 목록에서 사라진다
  await expect(teacherPage.getByText(/확인이 필요한 제출/)).toBeHidden({ timeout: 10_000 })
  // 기각했으므로 학생에게도 반영 안 됨이 표시된다
  await expect(s2.getByText(/점수에 반영되지 않았습니다/)).toBeVisible({ timeout: 10_000 })

  // ---- 11. 다음 라운드 → 라운드 번호 증가 ----
  await teacherPage.getByRole("button", { name: "다음 라운드" }).click()
  await expect(teacherPage.locator("header").getByText(/2라운드/)).toBeVisible({ timeout: 10_000 })
  await expect(s1.getByText("잠시만 기다리세요")).toBeVisible({ timeout: 10_000 })

  // ---- 12. 수업 종료 → 리포트 ----
  await teacherPage.getByRole("button", { name: "수업 종료" }).click()
  await teacherPage.goto(`/reports/${teacherPage.url().split("/host/")[1] ?? ""}`)
  await expect(teacherPage.getByText("학생별 요약")).toBeVisible({ timeout: 10_000 })

  await s1ctx.close()
  await s2ctx.close()
  await teacher.close()
})

test("잘못된 코드는 안내 문구를 보여준다", async ({ page }) => {
  await page.goto("/join")
  await page.getByPlaceholder("ABC234").fill("ZZZZZZ")
  await page.getByPlaceholder("예: 김민수").fill("테스트")
  await page.getByRole("button", { name: "입장하기" }).click()
  await expect(page.locator('p[role="alert"]')).toContainText("그런 방이 없습니다")
})

test("권한 없는 브라우저는 교사 화면에 들어가지 못한다", async ({ browser }) => {
  const owner = await browser.newContext()
  const ownerPage = await owner.newPage()
  await ownerPage.goto("/host")
  await ownerPage.getByRole("button", { name: "방 만들기" }).click()
  await expect(ownerPage).toHaveURL(/\/host\/[A-Z0-9]+/)
  const url = ownerPage.url()

  const stranger = await browser.newContext()
  const strangerPage = await stranger.newPage()
  await strangerPage.goto(url)
  await expect(strangerPage.getByText("진행 권한이 없습니다")).toBeVisible()

  await owner.close()
  await stranger.close()
})

test("교사가 직접 넣은 지문이 저장되고, 생성 실패는 안내로 이어진다", async ({ page }) => {
  // 이 실행에는 API 키가 없다(config 에서 비움) → 명제 자동 생성은 실패해야 하고,
  // 그래도 지문은 저장돼야 한다. 저장까지 같이 날아가면 교사가 입력을 통째로 잃는다.
  const body = Array.from({ length: 12 }, (_, i) =>
    `Sentence number ${i + 1} explains one more idea about why regular sleep helps students remember what they studied during the day.`,
  ).join(" ")

  await page.goto("/admin/passages/new")
  await page.getByPlaceholder("예: Lesson 5 — Why We Sleep").fill("E2E 교사 지문")
  await page.getByPlaceholder("Paste the English passage here.").fill(body)
  await page.getByRole("button", { name: /저장하고 채점 기준 만들기/ }).click()

  await expect(page.getByText("지문을 저장했습니다")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/명제 자동 생성에 실패했습니다/)).toBeVisible()

  // 명제가 없으므로 '보강 전(raw)' 목록에 들어간다
  await page.goto("/admin/passages?status=raw")
  await expect(page.getByRole("link", { name: /보강 전 [1-9]/ })).toBeVisible()
})

test("너무 짧은 지문은 저장 버튼이 잠긴다", async ({ page }) => {
  await page.goto("/admin/passages/new")
  await page.getByPlaceholder("예: Lesson 5 — Why We Sleep").fill("짧은 지문")
  await page.getByPlaceholder("Paste the English passage here.").fill("This passage is far too short.")
  await expect(page.getByText(/^6단어 ·/)).toBeVisible()
  await expect(page.getByRole("button", { name: /저장하고 채점 기준 만들기/ })).toBeDisabled()
})

test("검수 화면이 자동 점검 결과와 일괄 승인을 보여준다", async ({ page }) => {
  await page.goto("/admin/passages?status=draft")
  await expect(page.getByText(/자동 점검 —/)).toBeVisible()
  await expect(page.getByRole("button", { name: /지적 없는 \d+개 한꺼번에 승인/ })).toBeVisible()
  // 지적 없는 지문에는 배지가 붙는다
  await expect(page.getByText("지적 없음").first()).toBeVisible()
})

test("교사 경로는 인증 없이 열리지 않는다", async () => {
  // Playwright 의 request 컨텍스트는 config 의 httpCredentials 를 물려받아
  // 인증이 자동으로 붙는다(그래서 처음에 200 이 떴다). 순수 fetch 로 확인한다.
  const base = "http://127.0.0.1:3123"

  for (const path of ["/admin/passages", "/admin/passages/new", "/host"]) {
    const res = await fetch(`${base}${path}`, { redirect: "manual" })
    expect(res.status, `${path} 는 인증 없이 열리면 안 된다`).toBe(401)
  }

  // 비밀번호가 맞으면 통과한다
  const ok = await fetch(`${base}/admin/passages`, {
    headers: { authorization: `Basic ${Buffer.from("teacher:e2e-teacher-pw").toString("base64")}` },
  })
  expect(ok.status).toBe(200)

  // 틀린 비밀번호는 막힌다
  const bad = await fetch(`${base}/admin/passages`, {
    headers: { authorization: `Basic ${Buffer.from("teacher:wrong").toString("base64")}` },
  })
  expect(bad.status).toBe(401)

  // 학생 경로는 열려 있어야 한다 — 막으면 수업이 안 된다
  expect((await fetch(`${base}/join`)).status).toBe(200)
  expect((await fetch(`${base}/`)).status).toBe(200)
})
