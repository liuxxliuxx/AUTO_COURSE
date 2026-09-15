/**
 * PoC 实验 1：Playwright 能否通过 CDP 接管 Electron 已经开着的 BrowserWindow？
 *
 * 这是整个 v2 浏览器自动化方案的前提。
 * 如果这条路不通，就只能退回 webContents.executeJavaScript —— 那正是
 * docs/v2_handoff.md §4 明确要求避免的。
 *
 * 用法：node scripts/poc/01-cdp-connect.mjs
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronBin = require('electron')

const PORT = 9333
const FIXTURE = `file://${join(root, 'tests', 'fixtures', 'poc-smoke.html')}`

function log(step, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`CDP 端口 ${port} 在 ${timeoutMs}ms 内没有就绪`)
}

const userDataDir = mkdtempSync(join(tmpdir(), 'poc-cdp-'))

const child = spawn(
  electronBin,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    join(root, 'scripts', 'poc', 'electron-host.cjs'),
    FIXTURE
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)

child.stdout.on('data', (d) => process.stdout.write(`  [electron] ${d}`))
child.stderr.on('data', (d) => {
  const text = String(d)
  // Electron 在 macOS 上会刷一堆无关的警告
  if (!/^\s*$/.test(text) && !/Warning|cache|GPU|IMK/.test(text)) {
    process.stderr.write(`  [electron:err] ${text}`)
  }
})

let browser
let version

try {
  version = await waitForPort(PORT)
  log('CDP endpoint 可达', true, version.Browser ?? version['User-Agent'])

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)

  const contexts = browser.contexts()
  log('connectOverCDP 成功', contexts.length > 0, `contexts=${contexts.length}`)

  // 等 Electron 窗口作为 page target 出现
  let page = null
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && !page) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        if (p.url().startsWith('file://') && p.url().includes('poc-smoke')) {
          page = p
          break
        }
      }
      if (page) break
    }
    if (!page) await new Promise((r) => setTimeout(r, 250))
  }

  log('Electron BrowserWindow 作为 page target 暴露', !!page, page ? page.url() : '未找到')

  if (page) {
    await page.waitForLoadState('domcontentloaded')

    // ---- 逐个验证 Playwright API 在 Electron 页面上是否真正可用 ----
    const heading = await page.locator('#title').textContent()
    log('locator().textContent()', heading?.trim() === 'PoC 冒烟页', JSON.stringify(heading?.trim()))

    await page.locator('#name').fill('张三')
    const filled = await page.inputValue('#name')
    log('locator().fill()', filled === '张三', filled)

    await page.locator('#pick').click()
    const clicked = await page.locator('#pick').getAttribute('data-clicked')
    log('locator().click()', clicked === '1', `data-clicked=${clicked}`)

    // SPA 动态内容
    await page.locator('#spawn').click()
    await page.locator('#late').waitFor({ timeout: 5_000 })
    const late = await page.locator('#late').textContent()
    log('waitFor 动态插入的元素', late?.includes('延迟'), late?.trim())

    // iframe（对应 UPC CAS / 验证码 iframe 场景）
    const frameText = await page.frameLocator('#child').locator('#inner').textContent()
    log('frameLocator iframe 内定位', frameText?.trim() === 'iframe 内部', frameText?.trim())

    // 在同一 frame 内做输入
    await page.frameLocator('#child').locator('#inner-input').fill('hi')
    const innerVal = await page.frameLocator('#child').locator('#inner-input').inputValue()
    log('iframe 内 fill()', innerVal === 'hi', innerVal)

    // <video> 读取：视频播放状态检测的基础
    const videoInfo = await page.evaluate(() => {
      const v = document.querySelector('#v')
      return v ? { hasVideo: true, duration: v.duration, paused: v.paused, ended: v.ended } : null
    })
    log('读取 <video> 播放状态', videoInfo?.hasVideo === true, JSON.stringify(videoInfo))

    // cookie 读写：MediaRecorder / CDP 下载都需要
    await page.context().addCookies([{ name: 'poc', value: '1', url: 'file://' }]).catch(() => {})
    const cookies = await page.context().cookies()
    log('context().cookies() 可用', Array.isArray(cookies), `${cookies.length} 个`)

    // 事件：onNavigation（对应 §6 BrowserAutomation.onNavigation）
    let navFired = false
    page.on('framenavigated', () => (navFired = true))
    await page.evaluate(() => history.pushState({}, '', '#nav'))
    await new Promise((r) => setTimeout(r, 300))
    log('framenavigated 事件可订阅', navFired)

    // 截图能力（后续 UI 走查与失败取证都要用）
    const shot = join(root, 'tests', '.tmp', 'poc-cdp.png')
    await page.screenshot({ path: shot })
    writeFileSync(join(root, 'tests', '.tmp', 'poc-cdp-ok'), shot)
    log('screenshot() 可用', true, shot)
  }
} catch (error) {
  log('实验失败', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser?.close().catch(() => {})
  child.kill('SIGKILL')
}
