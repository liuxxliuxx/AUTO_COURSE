/**
 * 截图工具：把 Dashboard / Settings 各拍一张，用于人工走查界面。
 *
 * 用法：node scripts/screenshot.mjs [输出目录] [宽] [高]
 */

import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(process.argv[2] ?? join(root, 'tests', '.tmp', 'shots'))
const width = Number(process.argv[3] ?? 1180)
const height = Number(process.argv[4] ?? 780)

mkdirSync(outDir, { recursive: true })

const app = await electron.launch({ args: [root], cwd: root })

try {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // 窗口尺寸由 BrowserWindow 决定；Playwright 的 setViewportSize 对 Electron
  // 窗口不生效（会静默失败并让后续可见性判定失准），这里直接用窗口自身尺寸。
  console.log(`viewport ${width}x${height}`)

  const shots = [
    { name: 'dashboard', tab: '运行', anchor: '.hero-value' },
    { name: 'settings-account', tab: '设置', anchor: '.group-title' },
    { name: 'settings-brush', tab: '设置', anchor: '.group-title', click: '刷课' },
    { name: 'settings-schedule', tab: '设置', anchor: '.group-title', click: '自动调度' }
  ]

  for (const shot of shots) {
    console.log(`→ ${shot.name}`)
    await window.locator('.tab', { hasText: shot.tab }).click()
    if (shot.click) {
      await window.locator('.nav-item', { hasText: shot.click }).click()
    }
    // v-show 切换后其余分组仍留在 DOM 里，必须等「可见的」那一个
    await window.locator(`${shot.anchor}:visible`).first().waitFor({ timeout: 5_000 })
    await window.waitForTimeout(150)
    const file = join(outDir, `${shot.name}.png`)
    await window.screenshot({ path: file })
    console.log(`saved ${file}`)
  }
} finally {
  await app.close()
}
