import { expect, test, type Page } from "@playwright/test"

// ============================================================
// 교사 연수용 데모 — 홈에서 로그인·승인·초대 코드 **없이** 열려야 한다.
//
// 이 흐름이 깨지면 연수 당일에 알게 되고, 그때는 고칠 시간이 없다.
// LLM 은 꺼져 있다(PARAPHRASE_LLM=off) — 유료 판정 없이도 화면이 끝까지
// 굴러가는지가 여기서 보는 것이다.
// ============================================================

/** 유형 3 — 문맥 앞부분을 끌어서 범위로 표시한다. */
async function dragFirstSentence(page: Page) {
  await page.evaluate(() => {
    const host = document.querySelector("main p.font-serif")
    if (!host) throw new Error("문맥 문단을 찾지 못했습니다")
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()
    if (!node?.textContent?.trim()) throw new Error("문맥에 텍스트가 없습니다")
    const text = node.textContent
    // 첫 문장 끝까지. 되받는 이름이 가리키는 범위가 거기다.
    const end = text.indexOf(".") >= 0 ? text.indexOf(".") + 1 : Math.min(60, text.length)
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })
  await expect(page.getByText(/표시한 범위/)).toBeVisible()
}

test("홈에서 아무 인증 없이 데모로 들어간다", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: /바꿔 말하기 세 유형/ }).click()
  await expect(page).toHaveURL(/\/demo/)
  await expect(page.getByRole("heading", { name: /바꿔 말하기 세 유형/ })).toBeVisible()
})

test("세 유형이 나란히 있고 화면에는 한 문제만 나온다", async ({ page }) => {
  await page.goto("/demo")

  for (const name of ["다른 낱말로", "이름↔문장", "되받는 이름"]) {
    await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible()
  }
  // 한 번에 하나 — 제출 버튼이 둘이면 두 문제가 같이 떠 있는 것이다
  await expect(page.getByRole("button", { name: "제출" })).toHaveCount(1)
})

test("지시문의 강조가 별표째 나오지 않는다", async ({ page }) => {
  await page.goto("/demo")
  // 지시문은 처음부터 `**…**` 로 강조를 적어 왔는데 화면이 그것을 글자로 뿌리고 있었다.
  // 학생 화면도 같은 결함이었다(components/emphasis.tsx 로 함께 고침).
  for (const name of ["다른 낱말로", "이름↔문장", "되받는 이름"]) {
    await page.getByRole("button", { name: new RegExp(name) }).click()
    const prompt = page.locator("main section p.font-semibold").first()
    await expect(prompt).not.toContainText("**")
    await expect(prompt.locator("b")).toHaveCount(1)
  }
})

test("유형 1 — 원문 그대로 내면 무료 단계에서 걸린다 (LLM 없이도 채점이 멈추지 않는다)", async ({
  page,
}) => {
  await page.goto("/demo")
  await page.getByRole("button", { name: /다른 낱말로/ }).click()

  const slot = page.locator('main input[type="text"], main input:not([type])').first()
  await expect(slot).toBeVisible()
  await slot.fill("remember far more") // 원문 그대로
  await page.getByRole("button", { name: "제출" }).click()

  await expect(page.getByText(/원문 단어/)).toBeVisible({ timeout: 20_000 })
  // 모범답안은 점수와 상관없이 나온다(§38) — 가장 도움이 필요한 쪽이 빈손으로 끝나면 안 된다
  await expect(page.getByText("모범답안")).toBeVisible()
})

test("유형 3 — 범위를 끌어 제출하면 점수가 나오고, 다시 풀 수 있다", async ({ page }) => {
  await page.goto("/demo")
  await page.getByRole("button", { name: /되받는 이름/ }).click()

  await dragFirstSentence(page)
  await page.getByRole("button", { name: "제출" }).click()

  const score = page.locator("span.tabular-nums").first()
  await expect(score).toBeVisible({ timeout: 20_000 })
  expect(Number(await score.innerText())).toBeGreaterThan(0)

  await page.getByRole("button", { name: "다시 풀기" }).click()
  await expect(page.getByRole("button", { name: "제출" })).toBeVisible()
})

test("데모 지문은 자작이라고 화면이 밝힌다 — 공개 페이지의 저작권 전제", async ({ page }) => {
  await page.goto("/demo")
  await expect(page.getByText(/이 데모를 위해 새로 쓴 것/)).toBeVisible()
  await expect(page.getByText(/기록되지 않습니다/)).toBeVisible()
})
