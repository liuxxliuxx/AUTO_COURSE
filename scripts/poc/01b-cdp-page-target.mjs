/**
 * PoC 实验 1b：改用 page target 的 websocket 端点连接。
 *
 * 实验 1 表明 connectOverCDP 打 Electron 的 **browser** 端点会在
 * websocket 连上之后卡死握手（Electron 不支持 Playwright 依赖的
 * 浏览器级 Target.setAutoAttach 语义）。
 *
 * 这里换成 /json/list 里的页面级 webSocketDebuggerUrl。
 *
 * 用法：node scripts/poc/01b-cdp-page-target.mjs
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronBin = require('electron')

const PORT = 9334
const FIXTURE = `file://${join(root, 'tests', 'fixtures', 'poc-smoke.html')}`

function log(step, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function listTargets(port, matcher, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (res.ok) {
        const targets = await res.json()
        const hit = targets.find(matcher)
        if (hit) return { targets, hit }
      }
    } catch {
      /* 端口还没起 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return { targets: [], hit: null }
}

const userDataDir = mkdtempSync(join(tmpdir(), 'poc-page-'))
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
  const t = String(d)
  if (t.trim() && !/Warning|cache|GPU|IMK/.test(t) && !/DevTools listening/.test(t)) {
    process.stderr.write(`  [electron:err] ${t}`)
  }
})

let browser
try {
  // 注意：Electron 的 /json/list 里 url/title 恒为空字符串，
  // 不能按 URL 匹配，只能按 type==='page' 取。多窗口时需要用
  // Target.getTargetInfo 再核对一次（见 02 实验）。
  const { targets, hit } = await listTargets(PORT, (t) => t.type === 'page')
  console.log(`  targets: ${targets.map((t) => `${t.type}:${t.url.slice(0, 48)}`).join(' | ') || '(空)'}`)
  log('找到页面级 target', !!hit)
  if (!hit) throw new Error('没有可用的 page target')

  browser = await chromium.connectOverCDP(hit.webSocketDebuggerUrl, { timeout: 20_000 })
  log('connectOverCDP(page endpoint) 成功', true)

  const contexts = browser.contexts()
  const pages = contexts.flatMap((c) => c.pages())
  log('拿到 page 对象', pages.length > 0, `pages=${pages.length}`)

  const page = pages[0]
  if (page) {
    await page.waitForLoadState('domcontentloaded')
    log('页面 URL', true, page.url())

    const heading = await page.locator('#title').textContent()
    log('locator().textContent()', heading?.trim() === 'PoC 冒烟页', JSON.stringify(heading?.trim()))

    await page.locator('#name').fill('张三')
    log('locator().fill()', (await page.inputValue('#name')) === '张三')

    await page.locator('#pick').click()
    log('locator().click()', (await page.locator('#pick').getAttribute('data-clicked')) === '1')

    await page.locator('#spawn').click()
    await page.locator('#late').waitFor({ timeout: 5_000 })
    log('waitFor 动态元素', true, (await page.locator('#late').textContent())?.trim())

    const frameText = await page.frameLocator('#child').locator('#inner').textContent()
    log('frameLocator iframe 定位', frameText?.trim() === 'iframe 内部', frameText?.trim())

    await page.frameLocator('#child').locator('#inner-input').fill('hi')
    log('iframe 内 fill()', (await page.frameLocator('#child').locator('#inner-input').inputValue()) === 'hi')

    const videoInfo = await page.evaluate(() => {
      const v = document.querySelector('#v')
      return { hasVideo: !!v, duration: v?.duration, paused: v?.paused, ended: v?.ended }
    })
    log('读取 <video> 状态', videoInfo.hasVideo, JSON.stringify(videoInfo))

    const cookies = await page.context().cookies()
    log('context().cookies()', Array.isArray(cookies), `${cookies.length} 个`)

    let navFired = false
    page.on('framenavigated', () => (navFired = true))
    await page.evaluate(() => history.pushState({}, '', '#nav'))
    await new Promise((r) => setTimeout(r, 300))
    log('framenavigated 事件', navFired)

    await page.screenshot({ path: join(root, 'tests', '.tmp', 'poc-page-target.png') })
    log('screenshot()', true)
  }
} catch (error) {
  log('实验失败', false, error instanceof Error ? error.message : String(error))
} finally {
  await browser?.close().catch(() => {})
  child.kill('SIGKILL')
}
