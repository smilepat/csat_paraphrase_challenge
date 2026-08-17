import { expect, test } from "@playwright/test"

// ============================================================
// 자습 흐름 — 입장 → 문항 → 제출 → 채점 → 다음.
//
// LLM 은 꺼져 있다(PARAPHRASE_LLM=off). 그래서 여기서 확인하는 것은
// **무료 단계와 화면**이다. 유료 판정이 없어도 채점이 멈추지 않아야 한다는 것이
// 설계였고, 이 테스트가 그걸 지킨다.
// ============================================================

const NAME = "연습이"

async function enter(page: import("@playwright/test").Page) {
  await page.goto("/study")
  await page.getByRole("textbox").first().fill("E2E")
  await page.getByRole("textbox").nth(1).fill(NAME)
  await page.getByRole("button", { name: "시작하기" }).click()
  await page.waitForURL(/\/study\/[A-Z0-9]+/i)
}


/**
 * 지금 나온 문항에 답한다. 유형에 따라 입력 방식이 다르다.
 *
 * `if (textarea)` 로 감싸면 유형 3 이 나왔을 때 검사 본문이 통째로 건너뛰어져
 * **통과했지만 아무것도 안 한** 상태가 된다. 어느 유형이 나오든 반드시 제출한다.
 */
async function answerCurrent(page: import("@playwright/test").Page) {
  // 문항이 그려지기 전에 textarea 를 세면 0 이 나와 유형 3 경로로 잘못 빠진다.
  // (실제로 그렇게 실패했다 — 로케이터 문제로 보이지만 경쟁 상태였다.)
  await expect(page.getByRole("button", { name: "제출" })).toBeVisible({ timeout: 20_000 })

  // 입력 방식이 셋이다: 빈칸 틀 · 자유 입력창 · 범위 끌기.
  // 하나만 알고 있으면 다른 유형이 나왔을 때 조용히 엉뚱한 길로 빠진다.
  const slots = page.locator('main input[type="text"], main input:not([type])')
  const textarea = page.locator("textarea")

  if (await slots.count()) {
    const n = await slots.count()
    for (let i = 0; i < n; i++) await slots.nth(i).fill("different wording")
  } else if (await textarea.count()) {
    await textarea.fill("Saying the very same idea with completely other vocabulary.")
  } else {
    // 유형 3 — 문맥 앞부분을 끌어서 선택한다.
    // firstChild 를 그냥 쓰면 안 된다: 강조가 문맥 맨 앞에 오면 첫 자식이 <mark> 요소라
    // 텍스트 오프셋을 못 잡는다. 텍스트 노드를 직접 찾는다.
    await page.evaluate(() => {
      const host = document.querySelector("main p.font-serif")
      if (!host) throw new Error("문맥 문단을 찾지 못했습니다")
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
      const node = walker.nextNode()
      if (!node?.textContent?.trim()) throw new Error("문맥에 텍스트가 없습니다")
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, Math.min(40, node.textContent.length))
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    })
    await expect(page.getByText(/표시한 범위/)).toBeVisible()
  }

  await page.getByRole("button", { name: "제출" }).click()
}

test("입장하면 문항이 나오고 3축이 보인다", async ({ page }) => {
  await enter(page)

  // 3축 프로필이 처음부터 보인다 — 총점이 아니라 축이 자습의 리포트다.
  // 축 이름은 출제된 문항 칩에도 나오므로 축 카드 영역으로 좁혀서 본다.
  const axes = page.locator("div.grid.grid-cols-3")
  await expect(axes.getByText("유형 1 · 다른 낱말로")).toBeVisible()
  await expect(axes.getByText("유형 2 · 이름↔문장")).toBeVisible()
  await expect(axes.getByText("유형 3 · 되받는 이름")).toBeVisible()

  // 아직 아무것도 안 했으니 세 축 모두 "아직 안 해봄"
  await expect(page.getByText("아직 안 해봄").first()).toBeVisible()

  // 문항이 하나 나온다
  await expect(page.getByText("제출")).toBeVisible()
})

test("지문 전문이 아니라 문맥만 내려온다", async ({ page }) => {
  await enter(page)

  // 저작권 설계의 핵심 — 서버가 문맥만 잘라 보내므로 페이지 어디에도 지문 전문이 없다.
  // 지문은 최소 500자인데 화면의 본문 블록은 그보다 훨씬 짧아야 한다.
  const context = await page.locator("main p.font-serif").first().innerText()
  expect(context.length).toBeGreaterThan(20)
  expect(context.length).toBeLessThan(500)
})

test("제출하면 점수와 피드백이 나오고 다음 문항으로 넘어간다", async ({ page }) => {
  await enter(page)
  await answerCurrent(page)

  // LLM 이 꺼져 있어도 채점이 멈추지 않는다 — 설계가 그랬고 이 검사가 그걸 지킨다
  await expect(page.getByRole("button", { name: "다음 문항" })).toBeVisible({ timeout: 20_000 })

  await page.getByRole("button", { name: "다음 문항" }).click()
  // 누적이 올라간다 = 시도가 실제로 기록됐다
  await expect(page.getByText(/누적 1회/)).toBeVisible()
})

test("채점 뒤에는 점수와 상관없이 모범답안을 준다", async ({ page }) => {
  await enter(page)
  // ⚠ 문항은 비동기로 온다. 기다리지 않고 읽으면 빈 화면을 보고 엉뚱하게 갈라진다.
  await expect(page.getByRole("button", { name: "제출" })).toBeVisible({ timeout: 20_000 })

  // 일부러 **원문을 그대로** 낸다. 무료 단계에서 떨어져 유료 판정을 부르지 않는,
  // 예전이라면 아무 예시도 못 받던 경우다 — 가장 도움이 필요한 자리다.
  const prompt = (await page.locator("main").innerText()).replace(/\s+/g, " ")
  test.skip(prompt.includes("범위를 끌어서"), "유형 3 은 산출 과제가 아니라 모범답안이 없다")

  // 학생의 기본 경로 그대로 간다 — 유형 1 은 자유 입력이 아니라 **빈칸 틀**이다.
  const slots = page.locator('main input[type="text"], main input:not([type])')
  const box = page.locator("main textarea")
  if (await slots.count()) {
    const n = await slots.count()
    for (let i = 0; i < n; i++) await slots.nth(i).fill("copied straight from the passage")
  } else {
    await expect(box).toBeVisible()
    await box.fill("the same words copied straight from the passage")
  }
  await page.getByRole("button", { name: "제출" }).click()

  await expect(page.getByText("모범답안")).toBeVisible({ timeout: 20_000 })
  // 모범답안 옆에는 **정답이 하나가 아니라는 말**이 함께 있어야 한다.
  // 이것이 없으면 학생은 자기 답이 틀렸다고 읽는다.
  await expect(page.getByText(/정답은 하나가 아닙니다/)).toBeVisible()
})

test("빈 답으로는 제출할 수 없다", async ({ page }) => {
  await enter(page)
  // 유형에 상관없이, 아직 아무것도 하지 않았으면 제출은 막혀 있다
  await expect(page.getByRole("button", { name: "제출" })).toBeDisabled()
})

test("같은 기기로 다시 오면 이력이 이어진다", async ({ page }) => {
  await enter(page)
  const first = page.url()

  await answerCurrent(page)
  await expect(page.getByRole("button", { name: "다음 문항" })).toBeVisible({ timeout: 20_000 })

  // 다시 입장 — 새 학습자를 만들면 이력이 끊긴다
  await page.goto("/study")
  await page.getByRole("textbox").first().fill("E2E")
  await page.getByRole("textbox").nth(1).fill("다른이름")
  await page.getByRole("button", { name: "시작하기" }).click()
  await page.waitForURL(/\/study\/[A-Z0-9]+/i)
  expect(page.url()).toBe(first)
  await expect(page.getByText(/누적 [1-9]/)).toBeVisible()
})

test("힌트는 한 칸씩 열린다 — 답은 마지막에만 나온다", async ({ page }) => {
  await enter(page)
  await expect(page.getByRole("button", { name: "제출" })).toBeVisible({ timeout: 20_000 })

  // 힌트는 **요청해야** 나온다. 문항과 함께 보이면 산출을 시도하기 전에 읽는다.
  await expect(page.getByText(/도움 \d+\//)).toHaveCount(0)

  await page.getByRole("button", { name: /막혔어요/ }).click()
  const first = page.getByText(/도움 1\//)
  await expect(first).toBeVisible()

  // 첫 칸은 한국어 뜻이다. 여기서 영어 답이 나오면 사다리가 무너진 것이다.
  const opened = page.locator("main div.border-dashed")
  await expect(opened).toHaveCount(1)
  await expect(opened.first()).toContainText("뜻")

  // 총 칸 수를 읽어 끝까지 연다
  const total = Number((await first.innerText()).match(/도움 1\/(\d+)/)![1])
  expect(total, "픽스처에 힌트 재료가 없으면 이 검사는 아무것도 안 본다").toBeGreaterThan(1)

  for (let n = 1; n < total; n++) {
    await page.getByRole("button", { name: /더 도와주세요/ }).click()
    await expect(opened).toHaveCount(n + 1)
  }

  // 다 열면 버튼이 사라진다
  await expect(page.getByRole("button", { name: /막혔어요|더 도와주세요/ })).toHaveCount(0)

  // 앞 칸들은 답을 담지 않고, 마지막 칸에서만 예시 답이 나온다
  await expect(opened.last()).toContainText("예시 답")
})

test("백지 대신 빈칸이 든 틀을 준다", async ({ page }) => {
  await enter(page)
  await expect(page.getByRole("button", { name: "제출" })).toBeVisible({ timeout: 20_000 })

  const textarea = page.locator("textarea")
  if ((await textarea.count()) > 0) {
    // 틀이 있는 유형이면 자유 입력창 대신 칸이 나온다
    test.skip(true, "이 문항은 틀이 없는 유형이다")
  }
  const slots = page.locator('main input[type="text"], main input:not([type])')
  if ((await slots.count()) === 0) test.skip(true, "범위 끌기 문항이라 채울 칸이 없다")

  // 칸을 다 채우기 전에는 제출할 수 없다
  await expect(page.getByRole("button", { name: "제출" })).toBeDisabled()

  const n = await slots.count()
  for (let i = 0; i < n; i++) await slots.nth(i).fill("something")
  await expect(page.getByRole("button", { name: "제출" })).toBeEnabled()

  // 틀 없이 쓰겠다고 하면 자유 입력으로 바뀐다
  await page.getByRole("button", { name: /틀 없이 직접/ }).click()
  await expect(page.locator("textarea")).toBeVisible()
})
