import { defineConfig, devices } from "@playwright/test"

const PORT = 3123
const BASE = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // 한 DB 를 공유하므로 직렬로 돈다
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E 는 외부 API 를 쓰지 않는다. 가짜 임베딩 + 판정 LLM off.
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PARAPHRASE_FAKE_EMBED: "1",
      PARAPHRASE_LLM: "off",
      TURSO_DATABASE_URL: "file:./e2e.db",
      NODE_ENV: "production",
    },
  },
})
