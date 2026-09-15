/**
 * Electron 启动冒烟测试。
 *
 * 用 Playwright 的 Electron 驱动启动打包后的应用，确认：
 *  1. Electron 能起、主进程 IPC 注册成功
 *  2. Vue Renderer 渲染出 Dashboard
 *  3. typed IPC 往返可用（appApi.app.version）
 *  4. preload 没有把 ipcRenderer 泄漏到 Renderer
 *
 * 用法：node scripts/smoke-electron.mjs
 */

import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`✓ ${message}`)
}

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production' }
})

try {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const title = await window.title()
  console.log(`  窗口标题: ${title}`)

  // 1. Vue 是否挂载
  const brand = await window.locator('.brand').textContent({ timeout: 10_000 })
  if (brand?.includes('智慧树')) pass(`Renderer 已渲染: ${brand.trim()}`)
  else fail(`Renderer 未渲染，.brand = ${JSON.stringify(brand)}`)

  // 2. 主进程 IPC 往返
  const info = await window.evaluate(() => window.appApi.app.version())
  if (info?.electron) pass(`typed IPC 往返正常 (electron ${info.electron}, chrome ${info.chrome})`)
  else fail(`typed IPC 返回异常: ${JSON.stringify(info)}`)

  // 3. Renderer 是否被正确隔离
  const leaked = await window.evaluate(() => ({
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    ipcRenderer: typeof globalThis.ipcRenderer
  }))
  if (leaked.require === 'undefined' && leaked.process === 'undefined' && leaked.ipcRenderer === 'undefined') {
    pass('Renderer 隔离正常：无 require / process / ipcRenderer')
  } else {
    fail(`Renderer 隔离被破坏: ${JSON.stringify(leaked)}`)
  }

  // 4. 两个页面都能导航
  await window.locator('.tab', { hasText: '设置' }).click()
  await window.locator('.group-title').first().waitFor({ timeout: 5_000 })
  const groupTitle = await window.locator('.group-title').first().textContent()
  pass(`路由切换正常，Settings 显示: ${groupTitle?.trim()}`)

  await window.locator('.tab', { hasText: '运行' }).click()
  await window.locator('.hero-value').waitFor({ timeout: 5_000 })
  const hero = await window.locator('.hero-value').textContent()
  pass(`Dashboard 主读数: ${hero?.trim()}`)
} catch (error) {
  fail(`冒烟测试异常: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await app.close()
}
