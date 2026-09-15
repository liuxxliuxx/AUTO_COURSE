import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // tests/unit        纯逻辑 + 存储层（不加载 Electron，也不需要浏览器）
    // tests/integration 用真实 Playwright Chromium 打开 tests/fixtures 下的 DOM 夹具
    //
    // 需要 Electron 的能力（safeStorage / BrowserService / 启动流程）由
    // scripts/smoke-electron.mjs 与 scripts/poc/02-host-full-matrix.mjs 覆盖。
    //
    // 首次运行 integration 前需要下载一次 Chromium：
    //   npx playwright install chromium
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
