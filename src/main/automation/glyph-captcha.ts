import { createHash } from 'node:crypto'
import type { Frame, Locator, Page, Response } from 'playwright-core'
import type { Logger } from '../services/logger'
import { createGlyphWorker, type GlyphPrediction, type GlyphRecognizer } from '../services/glyph-worker'

export type AutomaticCaptchaResult = 'solved' | 'manual' | 'stopped'
interface Challenge {
  frame: Frame
  popup: Locator
  image: Locator
  source: string
  instruction: string
  width: number
  height: number
}
export interface GlyphCaptchaOptions {
  createRecognizer?: () => Promise<GlyphRecognizer>
  resultTimeoutMs?: number
  loadTimeoutMs?: number
  retryDelayMs?: number
}

function providerUrl(value: string): boolean {
  try { return /(?:^|\.)(?:dun\.163\.com|cstaticdun\.126\.net|nosdn\.127\.net|necaptcha\.com)$/.test(new URL(value).hostname) }
  catch { return false }
}
export function parseCaptchaCheck(body: string): boolean | null {
  try {
    const wrapped = body.match(/^[\w.$]+\(([\s\S]*)\)\s*;?\s*$/)
    const payload = JSON.parse(wrapped ? wrapped[1] : body)
    return typeof payload.data?.result === 'boolean' ? payload.data.result : null
  } catch { return null }
}
export function validGlyphPoint(result: GlyphPrediction, width: number, height: number): boolean {
  if (result?.status !== 'matched' || !result.targetId || !Array.isArray(result.objects)) return false
  const targets = result.objects.filter(o => o.id === result.targetId)
  const p = result.pointInImage, box = targets[0]?.bbox_xyxy
  return targets.length === 1 && !!p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x > 0 && p.y > 0 && p.x < width && p.y < height && Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) &&
    p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]
}

/** One automatic owner per CaptchaService, using original response bytes, never screenshots. */
export class GlyphCaptchaSolver {
  private readonly images = new Map<string, Response>()
  private recognizer: GlyphRecognizer | null = null
  private disposed = false
  private readonly response = (response: Response): void => {
    if (response.request().resourceType() !== 'image' || !providerUrl(response.url())) return
    this.images.set(response.url(), response)
    if (this.images.size > 30) this.images.delete(this.images.keys().next().value!)
  }
  constructor(private readonly page: Page, private readonly log: Logger, private readonly options: GlyphCaptchaOptions = {}) {
    page.on('response', this.response)
    page.once('close', () => this.dispose())
  }
  dispose(): void {
    this.disposed = true
    this.page.off('response', this.response)
    this.images.clear()
    this.recognizer?.dispose()
  }
  private stopped(shouldStop: () => boolean): boolean { return this.disposed || this.page.isClosed() || shouldStop() }
  private async pause(ms: number, shouldStop: () => boolean): Promise<void> {
    const end = Date.now() + ms
    while (!this.stopped(shouldStop) && Date.now() < end) await this.page.waitForTimeout(Math.min(100, end - Date.now()))
  }
  private async read(): Promise<Challenge | null> {
    const found: Challenge[] = []
    let popupCount = 0
    for (const frame of this.page.frames()) {
      const popups = frame.locator('.yidun_popup:visible')
      const count = await popups.count()
      popupCount += count
      if (count !== 1) continue
      const popup = popups.first(), images = popup.locator('.yidun_bg-img:visible')
      if (await images.count() !== 1) continue
      const image = images.first()
      const state = await image.evaluate(el => {
        const img = el as HTMLImageElement
        return { source: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight, complete: img.complete, dpr: devicePixelRatio }
      })
      const instruction = (await popup.locator('.yidun_tips__text').allTextContents()).join(' ').replace(/\s+/g, ' ').trim()
      if (!state.complete || !state.width || !state.height || state.dpr !== 2 || !state.source || !instruction) continue
      found.push({ frame, popup, image, source: state.source, instruction, width: state.width, height: state.height })
    }
    return popupCount === 1 && found.length === 1 ? found[0] : null
  }
  private same(a: Challenge, b: Challenge | null): b is Challenge {
    return !!b && a.frame === b.frame && a.source === b.source && a.instruction === b.instruction && a.width === b.width && a.height === b.height
  }
  private async bytes(challenge: Challenge): Promise<Buffer> {
    const response = this.images.get(challenge.source)
    if (response && response.ok()) return response.body()
    // BrowserContext's request client shares the current session cookies.
    const fetched = await this.page.context().request.get(challenge.source, { timeout: 10_000, failOnStatusCode: true })
    try { return await fetched.body() } finally { await fetched.dispose() }
  }
  private async gone(challenge: Challenge): Promise<boolean> {
    if (challenge.frame.isDetached()) return false
    return await challenge.frame.locator('.yidun_popup:visible').count() === 0
  }
  private async refresh(previous: Challenge, shouldStop: () => boolean): Promise<Challenge | null> {
    let current = await this.read()
    if (current && !this.same(previous, current)) return current
    if (!current || this.stopped(shouldStop)) return null
    const refresh = current.popup.locator('.yidun_refresh:visible')
    if (await refresh.count() !== 1) return null
    await refresh.click({ timeout: 1500 })
    const end = Date.now() + (this.options.loadTimeoutMs ?? 8000)
    while (!this.stopped(shouldStop) && Date.now() < end) {
      current = await this.read()
      if (current && !this.same(previous, current)) return current
      await this.pause(100, shouldStop)
    }
    return null
  }
  private async submit(challenge: Challenge, prediction: GlyphPrediction, hash: string, shouldStop: () => boolean): Promise<'accepted' | 'failed' | 'manual' | 'stopped'> {
    const current = await this.read()
    if (!this.same(challenge, current)) return 'failed'
    const bytes = await this.bytes(current)
    if (createHash('sha256').update(bytes).digest('hex') !== hash) return 'failed'
    const point = prediction.pointInImage!
    // Locator coordinates are CSS pixels within the image, including iframe offsets.
    // DPR is already reflected in naturalWidth; applying it again would double-scale.
    const position = await current.image.evaluate((el, p) => {
      const img = el as HTMLImageElement, r = img.getBoundingClientRect()
      const x = p.x * r.width / img.naturalWidth, y = p.y * r.height / img.naturalHeight
      return document.elementFromPoint(r.x + x, r.y + y) === img ? { x, y } : null
    }, point)
    if (!position) return 'failed'
    let result: boolean | null = null, limited = false
    const pending = new Set<Promise<void>>()
    const onResponse = (response: Response): void => {
      if (!providerUrl(response.url())) return
      try { if (response.request().frame() !== challenge.frame) return } catch { return }
      if ([403, 429].includes(response.status())) limited = true
      if (!/\/api\/v\d+\/check(?:\?|$)/.test(response.url())) return
      const task = response.text().then(body => { result = parseCaptchaCheck(body) }).catch(() => {}).finally(() => pending.delete(task))
      pending.add(task)
    }
    this.page.on('response', onResponse)
    try {
      if (this.stopped(shouldStop)) return 'stopped'
      if (!this.same(challenge, await this.read())) return 'failed'
      await current.image.click({ position, trial: true, timeout: 1500 })
      if (!this.same(challenge, await this.read())) return 'failed'
      const box = await current.image.boundingBox()
      if (!box || this.stopped(shouldStop)) return this.stopped(shouldStop) ? 'stopped' : 'failed'
      await this.page.mouse.click(box.x + point.x * box.width / challenge.width, box.y + point.y * box.height / challenge.height)
      const end = Date.now() + (this.options.resultTimeoutMs ?? 12_000)
      while (!this.stopped(shouldStop) && Date.now() < end) {
        if (limited) return 'manual'
        if (result === true && await this.gone(challenge)) return 'accepted'
        if (result === false) return 'failed'
        const next = await this.read()
        if (next && !this.same(challenge, next)) return 'failed'
        await this.pause(100, shouldStop)
      }
      return this.stopped(shouldStop) ? 'stopped' : 'failed'
    } finally {
      this.page.off('response', onResponse)
      // Response parsing is bounded by the enclosing attempt; it never causes a click.
      pending.clear()
    }
  }
  async solve(shouldStop: () => boolean): Promise<AutomaticCaptchaResult> {
    try {
      if (this.stopped(shouldStop)) return 'stopped'
      let challenge = await this.read()
      const loadEnd = Date.now() + (this.options.loadTimeoutMs ?? 8000)
      while (!challenge && !this.stopped(shouldStop) && Date.now() < loadEnd) {
        // Only wait for a recognized Yidun panel, not other providers or login inputs.
        if (!await this.page.locator('.yidun_popup:visible').count()) break
        await this.pause(100, shouldStop)
        challenge = await this.read()
      }
      if (!challenge) return 'manual'
      for (let attempt = 1; attempt <= 5; attempt++) {
        if (this.stopped(shouldStop)) return 'stopped'
        this.log.info(`离线验证码识别（${attempt}/5，DPR=2）`)
        const bytes = await this.bytes(challenge)
        const hash = createHash('sha256').update(bytes).digest('hex')
        this.recognizer ??= await (this.options.createRecognizer ?? createGlyphWorker)()
        if (this.stopped(shouldStop)) { this.recognizer.dispose(); return 'stopped' }
        const prediction = await this.recognizer.recognize({ bytes, width: challenge.width, height: challenge.height, instruction: challenge.instruction }, shouldStop)
        if (this.stopped(shouldStop)) return 'stopped'
        if (prediction.status === 'unsupported_instruction') return 'manual'
        if (validGlyphPoint(prediction, challenge.width, challenge.height)) {
          const outcome = await this.submit(challenge, prediction, hash, shouldStop)
          if (outcome === 'stopped') return 'stopped'
          if (outcome === 'manual') return 'manual'
          if (outcome === 'accepted') { this.log.info('离线验证码已获站点确认通过'); return 'solved' }
        }
        this.log.warn(`离线验证码第 ${attempt} 次未通过`)
        if (attempt === 5) break
        // One click per challenge. Retry only after a new challenge is loaded.
        await this.pause(this.options.retryDelayMs ?? 1000, shouldStop)
        const next = await this.refresh(challenge, shouldStop)
        if (!next) return this.stopped(shouldStop) ? 'stopped' : 'manual'
        challenge = next
      }
      this.log.warn('离线验证码连续失败 5 次，转人工处理')
      return 'manual'
    } catch {
      if (this.stopped(shouldStop)) return 'stopped'
      // Do not include URLs, response bodies, tokens or image bytes in errors.
      this.log.warn('离线验证码暂不可用，转人工处理')
      return 'manual'
    }
  }
}
