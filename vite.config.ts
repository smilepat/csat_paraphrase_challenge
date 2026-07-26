import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// vitest 와 vite-node(scripts/calibrate.mjs, scripts/live-check.mjs)가 함께 읽는다.
// vite-node CLI 는 vitest.config.ts 를 보지 않으므로 설정을 여기 한 곳에 둔다.
export default defineConfig({
  resolve: {
    // tsconfig 의 "@/*" 별칭
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
})
