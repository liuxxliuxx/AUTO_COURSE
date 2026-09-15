/**
 * 真实站点验证码误报回归。
 *
 * 背景：用户在切换课程时看到「出现验证码，请完成验证」，
 * 但浏览器里根本没有验证码 —— 目标站点长期在 DOM 里挂着一个休眠的
 * 验证码容器（v1 注释里叫 #captchaYidun），只看 bounding rect 的实现会误报。
 *
 * 这个脚本把**真实的 CaptchaService** 跑到**真实站点**上，
 * 直接回答两个问题：
 *   1. 没有任何验证码的页面上，会不会误报？（这是 bug 的形态）
 *   2. 真的弹出验证码时，还检不检得出来？（确认没修成漏报）
 *
 * 用 vite-node 运行（需要 import TS）：
 *   npx vite-node scripts/poc/03-real-captcha.mts
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { CaptchaService } from '../../src/main/automation/captcha'
import { BrowserSession } from '../../src/main/automation/browser-session'
import type { Logger } from '../../src/main/services/logger'

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  exception: () => {}
}

const results: Array<{ name: string; ok: boolean; detail: string }> = []
const record = (name: string, ok: boolean, detail = ''): void => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 目标站点会在加载后再做一次跳转，evaluate 撞上导航就会炸；重试即可 */
async function settle(page: Page): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await page.waitForTimeout(1500)
    try {
      await page.evaluate(() => document.readyState)
      return
    } catch {
      /* 还在跳，再来一次 */
    }
  }
}

async function evaluateSafe<T>(page: Page, fn: () => T, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await page.evaluate(fn)
    } catch (error) {
      lastError = error
      await page.waitForTimeout(1200)
    }
  }
  throw lastError
}

/** 把页面上所有候选元素的"可见性判据"打印出来，便于定位误报来源 */
async function auditCandidates(page: Page): Promise<string[]> {
  return evaluateSafe(page, () => {
    const KEYWORDS = ['captcha', 'yidun', 'turing', 'cstaticdun', 'necaptcha', 'verify']
    const POPUPS = [
      '.yidun_popup',
      '.yidun_modal',
      '.yidun_popup__content',
      '#tcaptcha_transform_dy',
      '#lPwdError'
    ]

    const out: string[] = []
    const rect = (el: Element): DOMRect => el.getBoundingClientRect()

    for (const frame of Array.from(document.querySelectorAll('iframe'))) {
      const src = (frame.getAttribute('src') ?? '').toLowerCase()
      if (!src || !KEYWORDS.some((k) => src.includes(k))) continue
      const r = rect(frame)
      const own = getComputedStyle(frame)
      const parent = frame.parentElement ? getComputedStyle(frame.parentElement) : null
      out.push(
        `iframe[${src.slice(0, 60)}] rect=${Math.round(r.width)}x${Math.round(r.height)} ` +
          `vis=${own.visibility} disp=${own.display} opacity=${own.opacity} ` +
          `parent(vis=${parent?.visibility} disp=${parent?.display} opacity=${parent?.opacity})`
      )
    }

    for (const sel of POPUPS) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const r = rect(el)
        const st = getComputedStyle(el)
        out.push(
          `${sel} rect=${Math.round(r.width)}x${Math.round(r.height)} ` +
            `vis=${st.visibility} disp=${st.display} opacity=${st.opacity}`
        )
      }
    }

    const input = document.getElementById('j-captcha-mobile')
    if (input) {
      const r = rect(input)
      const st = getComputedStyle(input)
      out.push(
        `#j-captcha-mobile rect=${Math.round(r.width)}x${Math.round(r.height)} ` +
          `vis=${st.visibility} disp=${st.display} opacity=${st.opacity}`
      )
    }
    return out
  })
}

const browser: Browser = await chromium.launch({ headless: true })

async function withPage<T>(url: string, fn: (page: Page, service: CaptchaService) => Promise<T>): Promise<T> {
  const page = await browser.newPage()
  const session = new BrowserSession(page, () => {})
  const service = new CaptchaService({
    session,
    shouldStop: () => false,
    log: silentLog,
    requestCaptcha: async () => true
  })
  console.log(`\n--- ${url} ---`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await settle(page)
  console.log(`  最终 URL: ${page.url()}`)
  try {
    return await fn(page, service)
  } finally {
    await page.close()
  }
}

try {
  // ============================================================
  // 1. 智慧树登录页：页面自带图片验证码输入框与 yidun 容器
  // ============================================================
  await withPage('https://onlineweb.zhihuishu.com/', async (page, service) => {
    const candidates = await auditCandidates(page)
    console.log(`  页面上与验证码相关的候选元素 ${candidates.length} 个：`)
    for (const line of candidates) console.log(`    · ${line}`)

    const hit = await service.detect()
    record(
      '智慧树登录页：未触发时不应误报',
      hit === null,
      hit ? `误报为 ${hit.kind}: ${hit.detail}` : '未检出（正确）'
    )

    // 点登录按钮触发滑块（不填账号也会弹）
    const clicked = await page
      .locator('.wall-sub-btn, span.wall-sub-btn')
      .first()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    await page.waitForTimeout(3500)

    const after = await service.detect()
    const afterCandidates = await auditCandidates(page)
    console.log(`  点击登录后候选元素 ${afterCandidates.length} 个：`)
    for (const line of afterCandidates) console.log(`    · ${line}`)
    console.log(`  （是否点到登录按钮: ${clicked}）`)

    record(
      '智慧树登录页：触发后行为符合预期',
      after === null ? !clicked : true,
      after ? `检出 ${after.kind}: ${after.detail.slice(0, 60)}` : '未检出'
    )
  })

  // ============================================================
  // 2. 课程页（未登录会跳转）：确认跳转后的页面上不误报
  // ============================================================
  await withPage('https://studyvideoh5.zhihuishu.com/stuStudy', async (_page, service) => {
    const hit = await service.detect()
    record(
      '课程站（未登录跳转页）：不应误报',
      hit === null,
      hit ? `误报为 ${hit.kind}: ${hit.detail}` : '未检出（正确）'
    )
  })

  // ============================================================
  // 3. 图谱课程站
  // ============================================================
  await withPage('https://ai-smart-course-student-pro.zhihuishu.com/', async (_page, service) => {
    const hit = await service.detect()
    record(
      '图谱课程站：不应误报',
      hit === null,
      hit ? `误报为 ${hit.kind}: ${hit.detail}` : '未检出（正确）'
    )
  })
} catch (error) {
  record('真实站点验证', false, error instanceof Error ? error.message.split('\n')[0] : String(error))
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`)
}
process.exitCode = failed.length ? 1 : 0
