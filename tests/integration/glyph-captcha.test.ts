import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CaptchaService } from '../../src/main/automation/captcha'
import { BrowserSession } from '../../src/main/automation/browser-session'
import type { GlyphPrediction, GlyphInput } from '../../src/main/services/glyph-worker'
import type { Logger } from '../../src/main/services/logger'

const image = readFileSync(resolve('resources/glyph-recognition/golden/images/worker-01-006.jpg'))
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() }
const matched: GlyphPrediction = { status: 'matched', targetId: 'o1', pointInImage: { x: 240, y: 120 }, objects: [{ id: 'o1', bbox_xyxy: [200, 80, 280, 160] }] }
let browser: Browser, context: BrowserContext, page: Page
beforeAll(async () => { browser = await chromium.launch() })
afterEach(async () => { await context?.close() })
afterAll(async () => { await browser?.close() })

async function setup(options: { acceptAt?: number; status?: string; mode?: string; dpr?: number; iframe?: boolean; infer?: () => Promise<GlyphPrediction> } = {}) {
  context = await browser.newContext({ deviceScaleFactor: options.dpr ?? 2, viewport: { width: 1000, height: 800 } })
  page = await context.newPage()
  let checks = 0
  const html = `<body data-number="1" data-clicks="0"><div class="yidun_popup" style="position:fixed;left:80px;top:100px;background:white;padding:10px">
  <p class="yidun_tips__text">请点击红色大写A</p><img class="yidun_bg-img" src="/image?n=1" style="display:block;width:320px;height:160px">
  <button class="yidun_refresh">刷新</button></div><script>
  const img=document.querySelector('img');
  document.querySelector('button').onclick=()=>{document.body.dataset.number=String(+document.body.dataset.number+1);img.src='/image?n='+document.body.dataset.number};
  img.onclick=async()=>{document.body.dataset.clicks=String(+document.body.dataset.clicks+1);
    const result=await fetch('/api/v3/check?n='+document.body.dataset.number).then(r=>r.json());
    if(${JSON.stringify(options.mode)}==='close-only'||result.data.result&&${JSON.stringify(options.mode)}!=='keep-open')document.querySelector('.yidun_popup').style.display='none';
  };</script></body>`
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/image') return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (url.pathname.includes('/check')) {
      checks++
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { result: options.mode === 'close-only' ? null : checks >= (options.acceptAt ?? 1) } }) })
    }
    return route.fulfill({ contentType: 'text/html', body: options.iframe && url.pathname === '/outer' ? '<iframe src="/fixture" style="margin:100px;width:700px;height:500px"></iframe>' : html })
  })
  const manual = vi.fn(async () => true), dispose = vi.fn()
  const infer = vi.fn(async (_input: GlyphInput) => options.infer ? options.infer() : ({ ...matched, status: options.status ?? 'matched' }))
  let stopped = false
  const service = new CaptchaService({ session: new BrowserSession(page, () => {}), log, shouldStop: () => stopped, requestCaptcha: manual,
    glyph: { createRecognizer: async () => ({ recognize: infer, dispose }), resultTimeoutMs: 450, loadTimeoutMs: 300, retryDelayMs: 0 } })
  await page.goto('https://c.dun.163.com/' + (options.iframe ? 'outer' : 'fixture'))
  const frame = options.iframe ? page.frames()[1] : page.mainFrame()
  await frame.locator('img').waitFor()
  await frame.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).naturalWidth > 0)
  return { service, manual, infer, dispose, frame, stop: () => { stopped = true }, checks: () => checks }
}

describe('DPR 2 离线验证码与人工兜底', () => {
  it('原图坐标映射到 CSS 坐标，站点通过且退出后继续', async () => {
    const t = await setup()
    expect(await t.service.checkAndHandle('course', '人工验证')).toBe(true)
    expect(t.checks()).toBe(1); expect(t.manual).not.toHaveBeenCalled()
    expect(t.infer.mock.calls[0][0]).toMatchObject({ width: 480, height: 240 })
    await page.close(); expect(t.dispose).toHaveBeenCalledOnce()
  })
  it('前四次站点拒绝，第五次通过，不转人工', async () => {
    const t = await setup({ acceptAt: 5 })
    expect(await t.service.checkAndHandle('video', '人工验证')).toBe(true)
    expect(t.checks()).toBe(5); expect(t.manual).not.toHaveBeenCalled()
    expect(await t.frame.locator('body').getAttribute('data-number')).toBe('5')
  })
  it('连续五次失败仅提交五次，后续检查保持人工流程', async () => {
    const t = await setup({ acceptAt: 99 })
    expect(await t.service.checkAndHandle('course', '人工验证')).toBe(true)
    expect(t.checks()).toBe(5); expect(t.manual).toHaveBeenCalledOnce()
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.checks()).toBe(5); expect(t.manual).toHaveBeenCalledTimes(2)
  })
  it('模型拒识也计入五次失败，每次刷新，不提交猜测', async () => {
    const t = await setup({ status: 'uncertain' })
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.infer).toHaveBeenCalledTimes(5); expect(t.checks()).toBe(0); expect(t.manual).toHaveBeenCalledOnce()
  })
  it('人工处理真正完成后，下一个独立验证码恢复离线识别', async () => {
    const t = await setup({ status: 'uncertain' })
    t.manual.mockImplementation(async () => {
      await t.frame.locator('.yidun_popup').evaluate(el => (el as HTMLElement).style.display = 'none')
      return true
    })
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.infer).toHaveBeenCalledTimes(5)
    t.infer.mockResolvedValue(matched)
    await t.frame.locator('.yidun_popup').evaluate(el => (el as HTMLElement).style.display = 'block')
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.infer).toHaveBeenCalledTimes(6); expect(t.manual).toHaveBeenCalledOnce()
  })
  it('不支持的题型直接沿用人工流程', async () => {
    const t = await setup({ status: 'unsupported_instruction' })
    await t.service.checkAndHandle('login', '人工验证')
    expect(t.infer).toHaveBeenCalledOnce(); expect(t.manual).toHaveBeenCalledOnce(); expect(t.checks()).toBe(0)
  })
  it('推理期间停止，不点击也不发出人工请求', async () => {
    const t = await setup({ infer: async () => { t.stop(); return matched } })
    expect(await t.service.checkAndHandle('course', '人工验证')).toBe(false)
    expect(t.checks()).toBe(0); expect(t.manual).not.toHaveBeenCalled()
  })
  it('推理期间图片变更，丢弃旧结果，重新识别后才提交', async () => {
    const t = await setup({ infer: async () => {
      if (t.infer.mock.calls.length === 1) { await t.frame.locator('button').click(); await t.frame.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).complete) }
      return matched
    } })
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.infer).toHaveBeenCalledTimes(2); expect(t.checks()).toBe(1); expect(t.manual).not.toHaveBeenCalled()
  })
  it.each(['close-only', 'keep-open'])('只有关闭或只有通过信号不算完成：%s', async mode => {
    const t = await setup({ mode })
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.manual).toHaveBeenCalledOnce()
  })
  it('非 DPR 2 挑战不进入模型', async () => {
    const t = await setup({ dpr: 1 })
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.infer).not.toHaveBeenCalled(); expect(t.manual).toHaveBeenCalledOnce()
  })
  it('iframe 内挑战保留页面偏移', async () => {
    const t = await setup({ iframe: true })
    // The shared detector recognizes captcha/verify iframe URLs.
    await page.locator('iframe').evaluate(el => el.setAttribute('src', '/fixture?captcha=1'))
    await page.frames()[1].waitForLoadState()
    await t.service.checkAndHandle('course', '人工验证')
    expect(t.checks()).toBe(1); expect(t.manual).not.toHaveBeenCalled()
  })
})
