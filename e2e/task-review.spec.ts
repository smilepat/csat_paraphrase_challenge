import { expect, test } from "@playwright/test"

// ============================================================
// 문항 검수 — 승인해야 학생에게 나간다는 것이 요점이다.
//
// `/admin/*` 은 proxy.ts 가 Basic 인증으로 막는다. playwright.config 의
// httpCredentials 로 통과한다(교실 검수와 같은 조건).
// ============================================================

test("검수 화면이 상태별로 갈라 보여준다", async ({ page }) => {
  await page.goto("/admin/tasks")
  await expect(page.getByRole("heading", { name: "문항 검수" })).toBeVisible()

  // global-setup 이 세 유형을 approved 로 심어 뒀다
  await page.getByRole("link", { name: /^approved/ }).click()
  await expect(page.locator("article")).toHaveCount(3)
})

test("검수자와 학생이 같은 문맥을 본다", async ({ page }) => {
  await page.goto("/admin/tasks?status=approved")
  // 골드 스텁은 문단을 둘 그린다(문맥 + 지문 전문). 학생이 보는 것은 **첫 번째**뿐이다.
  const cards = page.locator("article")
  const adminContexts: string[] = []
  for (let i = 0; i < (await cards.count()); i++) {
    adminContexts.push(await cards.nth(i).locator("p.font-serif").first().innerText())
  }
  expect(adminContexts.length).toBe(3)

  // 학생 화면에서도 같은 렌더러를 쓴다 — 검수자가 다른 것을 보면 검수가 무의미하다.
  // 길이만 보면 아무것도 확인하지 않는 셈이라, **같은 문자열인지**를 본다.
  await page.goto("/study")
  await page.getByRole("textbox").first().fill("E2E")
  await page.getByRole("textbox").nth(1).fill("검수확인")
  await page.getByRole("button", { name: "시작하기" }).click()
  await page.waitForURL(/\/study\/[A-Z0-9]+/i)
  await expect(page.getByRole("button", { name: "제출" })).toBeVisible({ timeout: 20_000 })

  const studyContext = (await page.locator("main p.font-serif").first().innerText()).trim()
  expect(adminContexts.map((t) => t.trim())).toContain(studyContext)
})

test("반려하면 raw 목록에서 빠지고 학생에게도 안 나간다", async ({ page }) => {
  await page.goto("/admin/tasks?status=approved")
  const before = await page.locator("article").count()

  await page.locator("article").first().getByRole("button", { name: "반려" }).click()
  await expect(page.locator("article")).toHaveCount(before - 1)

  await page.goto("/admin/tasks?status=rejected")
  await expect(page.locator("article")).toHaveCount(1)

  // 되돌려 놓는다 — 뒤 테스트가 문항을 필요로 한다
  await page.locator("article").first().getByRole("button", { name: "승인" }).click()
  await expect(page.locator("article")).toHaveCount(0)
})

test("유형 3 은 정답 범위가 색으로 보인다", async ({ page }) => {
  await page.goto("/admin/tasks?status=approved&type=3")
  const article = page.locator("article").first()
  await expect(article).toBeVisible()
  // 정답 범위는 배경색으로 표시된다. 학생 화면에는 넘기지 않는 정보다.
  await expect(article.locator("span.bg-\\[\\#dcfce7\\]")).toHaveCount(1)
  await expect(article.getByText("현재 정답 범위")).toBeVisible()
})

test("되받는 표현보다 뒤를 잡으면 저장을 거절한다", async ({ page }) => {
  await page.goto("/admin/tasks?status=approved&type=3")
  const article = page.locator("article").first()

  // 자극(밑줄) 안쪽을 선택한다 = 되받는 표현보다 앞이 아니다
  await page.evaluate(() => {
    const host = document.querySelector("article p.font-serif")
    const stim = host?.querySelector("span.underline")
    const node = stim?.firstChild
    if (!node?.textContent) throw new Error("자극 구간을 찾지 못했습니다")
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, Math.min(20, node.textContent.length))
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    host!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })

  await article.getByRole("button", { name: "범위 저장" }).click()
  await expect(article.getByText("되받는 표현보다 앞을 잡아야 합니다.")).toBeVisible()
})

test("아이디를 걸어 두면 아이디도 검사한다", async ({ browser }) => {
  // playwright.config 가 TEACHER_USERNAME=teacher 를 건다. 비밀번호가 맞아도
  // 아이디가 다르면 막혀야 한다 — 그것이 아이디를 거는 이유다.
  const wrong = await browser.newContext({
    httpCredentials: { username: "누구든", password: "e2e-teacher-pw" },
  })
  const p1 = await wrong.newPage()
  expect((await p1.goto("/admin/tasks"))?.status()).toBe(401)
  await wrong.close()

  const right = await browser.newContext({
    httpCredentials: { username: "teacher", password: "e2e-teacher-pw" },
  })
  const p2 = await right.newPage()
  expect((await p2.goto("/admin/tasks"))?.status()).toBe(200)
  await right.close()
})

test("비밀번호가 틀리면 막는다", async ({ browser }) => {
  const ctx = await browser.newContext({
    httpCredentials: { username: "teacher", password: "wrong" },
  })
  const page = await ctx.newPage()
  const res = await page.goto("/admin/tasks")
  expect(res?.status()).toBe(401)
  await ctx.close()
})

test("골드 스텁은 지문 전문을 함께 보여준다 — 없으면 검수가 불가능하다", async ({ page }) => {
  // 요약문 스텁은 "지문에서 대응하는 절을 찾으라"고 요구한다. 문맥(요약문 블록)만
  // 보여주면 지문이 화면에 없어 찾는 것이 **원리적으로 불가능**하다.
  // e2e 셋업은 골드를 심지 않으므로, 골드가 있을 때만 확인한다.
  await page.goto("/admin/tasks?status=raw")
  const gold = page.locator("article", { hasText: "요약문 골드" }).first()
  if ((await gold.count()) === 0) test.skip(true, "이 DB 에 골드 스텁이 없다")
  await expect(gold.getByText("절 하나를 끌어서")).toBeVisible()
  // 지문 전문은 요약문 블록보다 훨씬 길다
  const blocks = await gold.locator("p.font-serif").allInnerTexts()
  expect(blocks.length).toBe(2)
  expect(blocks[1].length).toBeGreaterThan(blocks[0].length)
})
