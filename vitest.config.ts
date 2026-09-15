import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // 这些测试不加载 Electron：只覆盖纯逻辑与可以直接在 Node 里跑的存储层。
    // 需要 Electron 的能力（safeStorage / BrowserService）通过
    // scripts/smoke-electron.mjs 与 scripts/poc/ 覆盖。
    globals: false
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
