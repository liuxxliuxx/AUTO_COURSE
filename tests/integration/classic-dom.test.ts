/**
 * DOM 夹具测试（handoff §29）。
 *
 * 用真实的 Playwright Chromium 打开 `tests/fixtures/` 里复刻真实结构的页面，
 * 直接驱动迁移后的 Navigator / VideoController / QuizService / CaptchaService。
 *
 * 这些测试不碰真实智慧树站点，因此可以稳定重复运行；
 * 真实站点只用于 scripts/poc/ 里的联网冒烟。
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { CaptchaService } from '../../src/main/automation/captcha'
import { QuizService, FixedAnswerStrategy } from '../../src/main/automation/quiz'
import { VideoController } from '../../src/main/automation/classic/video-controller'
import { ClassicCourseNavigator } from '../../src/main/automation/classic/navigator'
import type { Logger } from '../../src/main/services/logger'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')

/** 安静版 logger，测试里不污染输出 */
const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  exception: () => {}
}

let server: FixtureServer
let browser: Browser
let page: Page
let session: BrowserSession

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir)
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  session = new BrowserSession(page, () => {})
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

beforeEach(async () => {
  await page.goto(`${server.origin}/classic-course.html`)
})

// ============================================================================
// 视频控制器
// ============================================================================

describe('VideoController', () => {
  /** 夹具用的是静态 tiny.webm，等 metadata 加载完 duration 才可用 */
  const waitForMedia = async (): Promise<void> => {
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 20_000 }
    )
  }

  it('读取播放状态', async () => {
    await waitForMedia()
    const video = new VideoController(page, silentLog)
    const state = await video.readState()
    expect(state.exists).toBe(true)
    expect(state.durationSeconds).toBeGreaterThan(0)
    expect(state.paused).toBe(true)
    expect(state.playing).toBe(false)
  })

  it('play() 能把视频推进到播放态，pause 后能读回', async () => {
    await waitForMedia()
    const video = new VideoController(page, silentLog)
    // 夹具默认 muted，浏览器允许自动播放
    const started = await video.play()
    expect(started).toBe(true)
    expect(await video.isPlaying()).toBe(true)

    await page.locator('#courseVideo').evaluate((el) => (el as HTMLVideoElement).pause())
    expect(await video.isPaused()).toBe(true)
  })

  it('getProgress 返回可读的 mm:ss', async () => {
    await waitForMedia()
    const video = new VideoController(page, silentLog)
    const progress = await video.getProgress()
    expect(progress.duration).toMatch(/^\d+:\d{2}$/)
    expect(progress.current).toMatch(/^\d+:\d{2}$/)
  })

  /**
   * 「暂停后恢复」的延迟回归。
   *
   * 旧实现里 play() 会先固定睡 2 秒，再逐个候选各等 5 秒可见性超时，
   * 实测恢复一次要 18 秒（用户反馈"点半天没反应"）。
   * 现在走原生 play() 快路径 + 预算内轮询，应该是毫秒级。
   */
  it('暂停后恢复走原生快路径，1 秒内完成', async () => {
    await waitForMedia()
    await page.evaluate(() => {
      const v = document.querySelector('#courseVideo') as HTMLVideoElement
      v.currentTime = 0.4
      // 模拟真实播放器：播放过之后大播放按钮就不再显示了
      ;(document.getElementById('bigPlay') as HTMLElement).style.display = 'none'
      return v.play()
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => (document.querySelector('#courseVideo') as HTMLVideoElement).pause())

    const video = new VideoController(page, silentLog)
    const startedAt = Date.now()
    expect(await video.play()).toBe(true)
    expect(await video.isPlaying()).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  it('getMediaUrl 能取到直链与 Cookie（blob 流返回空串）', async () => {
    await waitForMedia()
    const video = new VideoController(page, silentLog)
    const { url, cookieHeader } = await video.getMediaUrl()
    // 夹具的 src 是静态文件，但走的是同一段提取逻辑；
    // 这里顺带确认取不到直链时不会抛错（智慧树的 MSE blob 流就是这种情形）
    expect(url).toBe('')
    expect(typeof cookieHeader).toBe('string')
  })
})

// ============================================================================
// 弹题
// ============================================================================

describe('QuizService', () => {
  beforeEach(async () => {
    await page.goto(`${server.origin}/quiz-dialog.html`)
  })

  it('能定位到弹题对话框', async () => {
    const quiz = new QuizService(page, silentLog)
    const dialog = await quiz.findDialog()
    expect(dialog).not.toBeNull()
  })

  it('没有弹题时返回 null', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    const quiz = new QuizService(page, silentLog)
    expect(await quiz.findDialog()).toBeNull()
  })

  it('答题后选项进入 active，并能点「下一题」', async () => {
    const quiz = new QuizService(page, silentLog, new FixedAnswerStrategy(1))
    const dialog = await quiz.findDialog()
    expect(dialog).not.toBeNull()

    await dialog!.locator('.topic-item').nth(1).click()
    const active = await dialog!.locator('.topic-option-item.active').count()
    expect(active).toBe(1)
    expect(await dialog!.locator('.topic-option-item.active').first().textContent()).toContain('逻辑性')

    // 进入第二题
    await dialog!.locator('.btn-next').click()
    await page.waitForTimeout(200)
    expect(await page.locator('#qIndex').textContent()).toBe('2')
  })

  it('handle() 走完多题并关闭对话框', async () => {
    const quiz = new QuizService(page, silentLog, new FixedAnswerStrategy(0))
    const dialog = await quiz.findDialog()
    const closed = await quiz.handle(dialog!)
    expect(closed).toBe(true)
    await page.waitForTimeout(300)
    expect(await page.locator('#quizDialog').count()).toBe(0)
  })

  /**
   * handoff §28「Quiz Random Strategy」：
   * v1 在"验证选中失败"时会再调一次 select_option()，等于换了一个选项，
   * 同一道题的结果在重试之间来回跳。
   * v2 保证一道题只问策略一次。这里用一个会数数的策略来把这条钉死。
   */
  it('每道题只向策略询问一次（不会中途改选）', async () => {
    let calls = 0
    const countingStrategy = {
      name: 'counting',
      selectIndex(optionCount: number): number {
        calls += 1
        return optionCount - 1 // 固定选最后一项
      }
    }

    const quiz = new QuizService(page, silentLog, countingStrategy)
    const dialog = await quiz.findDialog()
    expect(await quiz.handle(dialog!)).toBe(true)

    // 夹具两题；即使中间因为验证重试点击了多次，策略也只应被问两次
    expect(calls).toBe(2)
  })

  it('选中的是同一个选项，不会因为重试而换一个', async () => {
    const quiz = new QuizService(page, silentLog, new FixedAnswerStrategy(2))
    const dialog = await quiz.findDialog()

    await dialog!.locator('.topic-item').nth(2).click()
    const first = await dialog!.locator('.topic-option-item.active').first().textContent()
    expect(first).toContain('数理性')

    // 再点一次同一个目标，active 仍然在它身上（不会被挪到别的选项）
    await dialog!.locator('.topic-item').nth(2).click()
    const second = await dialog!.locator('.topic-option-item.active').first().textContent()
    expect(second).toContain('数理性')
    expect(await dialog!.locator('.topic-option-item.active').count()).toBe(1)
  })
})

// ============================================================================
// 验证码检测
// ============================================================================

describe('CaptchaService', () => {
  const makeCaptcha = (): { service: CaptchaService; requests: string[] } => {
    const requests: string[] = []
    const service = new CaptchaService({
      session,
      shouldStop: () => false,
      log: silentLog,
      requestCaptcha: async (_scene, message) => {
        requests.push(message)
        return true
      }
    })
    return { service, requests }
  }

  it('无验证码时返回 null', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    const { service } = makeCaptcha()
    expect(await service.detect()).toBeNull()
  })

  /**
   * 回归：目标站点长期在 DOM 里挂一个休眠的验证码容器（v1 注释里的 #captchaYidun）。
   * 它没弹出来，但 iframe 一直在，而且通常是 visibility/opacity/裁剪 这类
   * **不影响 bounding rect** 的方式藏起来的。
   *
   * 只看 getBoundingClientRect() 的实现会把这些算作"可见"，
   * 于是刷课时莫名其妙弹出"请完成验证码"，用户到浏览器里却找不到验证码。
   * 必须对齐 Selenium `is_displayed()` 的语义。
   */
  it('休眠的验证码容器不误报（visibility / opacity / 裁剪 / 视口外 / display）', async () => {
    await page.goto(`${server.origin}/classic-course.html`)

    // 夹具里四种隐藏方式各有一个 iframe，都带 cstaticdun（命中关键字表）
    const hiddenFrames = await page
      .locator(
        '#captchaYidun iframe, iframe[src*="hidden-by-opacity"], iframe[src*="clipped-away"], iframe[src*="parked-offscreen"], #captchaHiddenDisplay iframe'
      )
      .count()
    expect(hiddenFrames).toBe(5)

    const { service } = makeCaptcha()
    expect(await service.detect()).toBeNull()
  })

  it('休眠容器是被判为"不可见"排除的，而不是压根没匹配上', async () => {
    await page.goto(`${server.origin}/classic-course.html`)

    const debugLines: string[] = []
    const capturingLog: Logger = { ...silentLog, debug: (m) => debugLines.push(m) }
    const service = new CaptchaService({
      session,
      shouldStop: () => false,
      log: capturingLog,
      requestCaptcha: async () => true
    })

    expect(await service.detect()).toBeNull()

    // 四个命中关键字的 iframe 都应该出现在"被排除"清单里，
    // 并且带上各自的隐藏原因；否则说明是关键字没匹配上，而不是可见性判对了
    const joined = debugLines.join('\n')
    expect(joined).toContain('hidden-by-visibility')
    expect(joined).toContain('hidden-by-opacity')
    expect(joined).toContain('clipped-away')
    expect(joined).toContain('parked-offscreen')
    // 诊断要能说清"被谁、以什么方式藏起来的"
    expect(joined).toContain('visibility:hidden')
    expect(joined).toContain('opacity:0')
    expect(joined).toContain('overflow 完全裁掉')
    expect(joined).toContain('完全在视口之外')
    expect(joined).toContain('display:none')
  })

  it('休眠容器仍然挡不住真正的验证码弹出', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    const { service } = makeCaptcha()
    expect(await service.detect()).toBeNull()

    // 真的弹出来 → 必须检出（不能因为修误报而变成漏报）
    await page.evaluate(() => (window as unknown as { __showCaptcha: () => void }).__showCaptcha())
    const hit = await service.detect()
    expect(hit?.kind).toBe('popup')

    await page.evaluate(() => (window as unknown as { __hideCaptcha: () => void }).__hideCaptcha())
    expect(await service.detect()).toBeNull()
  })

  it('visibility:hidden 的容器内的验证码 iframe 不算可见', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    // 直接验证判据本身：把休眠容器换成"只有 rect 检查会通过"的状态
    const verdict = await page.evaluate(() => {
      const frame = document.querySelector('#captchaYidun iframe') as HTMLIFrameElement
      const rect = frame.getBoundingClientRect()
      const own = getComputedStyle(frame).visibility
      const parent = getComputedStyle(frame.parentElement as Element).visibility
      return { rectWidth: rect.width, rectHeight: rect.height, own, parent }
    })

    // rect 是正常的（300x150）—— 证明"只看 rect"必然误报
    expect(verdict.rectWidth).toBeGreaterThan(10)
    expect(verdict.rectHeight).toBeGreaterThan(0)
    // 真正能区分的是继承下来的 visibility
    expect(verdict.parent).toBe('hidden')
  })

  it('检测到弹窗式验证码', async () => {
    await page.goto(`${server.origin}/captcha.html`)
    const { service } = makeCaptcha()
    expect(await service.detect()).toBeNull()

    await page.locator('#trigger').click()
    const hit = await service.detect()
    expect(hit?.kind).toBe('popup')
  })

  it('检测到 iframe 式验证码（关键字匹配）', async () => {
    await page.goto(`${server.origin}/login.html`)
    await page.locator('#submitBtn').click()
    await page.waitForTimeout(300)

    const { service } = makeCaptcha()
    const hit = await service.detect()
    expect(hit?.kind).toBe('iframe')
    expect(hit?.detail).toContain('cstaticdun')
  })

  it('checkAndHandle 会请求人工确认，并在确认后继续', async () => {
    await page.goto(`${server.origin}/captcha.html`)
    await page.locator('#trigger').click()

    const { service, requests } = makeCaptcha()
    const handled = await service.checkAndHandle('video', '播放过程中出现验证码')
    expect(handled).toBe(true)
    expect(requests).toHaveLength(1)
  })

  it('用户处理完毕后不再检出', async () => {
    await page.goto(`${server.origin}/captcha.html`)
    await page.locator('#trigger').click()
    const { service } = makeCaptcha()
    expect(await service.detect()).not.toBeNull()

    await page.locator('#clear').click()
    expect(await service.detect()).toBeNull()
  })
})

// ============================================================================
// 课程导航
// ============================================================================

describe('ClassicCourseNavigator', () => {
  const makeNavigator = (skipCompleted = true): ClassicCourseNavigator => {
    const captcha = new CaptchaService({
      session,
      shouldStop: () => false,
      log: silentLog,
      requestCaptcha: async () => true
    })
    const quiz = new QuizService(page, silentLog)
    return new ClassicCourseNavigator(page, silentLog, captcha, quiz, skipCompleted)
  }

  it('解析出全部视频项，并正确标记已完成 / 小节 / 当前播放', async () => {
    const nav = makeNavigator()
    const entries = await nav.listVideos()

    expect(entries).toHaveLength(6)
    expect(entries.filter((e) => e.finished)).toHaveLength(2)
    expect(entries.filter((e) => e.current)).toHaveLength(1)
    expect(entries.find((e) => e.current)?.title).toBe('1.2 艺术的起源')
  })

  /**
   * 把 current_play 挪到指定标题上。
   *
   * 真实流程里这是"点了某个视频"的结果；`nextVideoAfter` 按传入标题定位，
   * 找不到才回退到 current_play —— 所以这些用例大多需要先摆好 DOM。
   */
  const setCurrentPlay = async (title: string): Promise<void> => {
    await page.locator('li.video').evaluateAll((nodes, wanted) => {
      for (const node of nodes) {
        node.classList.remove('current_play')
        const text = (node.querySelector('.catalogue_title') as HTMLElement | null)?.innerText.trim()
        if (text === wanted) node.classList.add('current_play')
      }
    }, title)
  }

  it('skipCompleted=true 时跳过已完成与小节标题', async () => {
    const nav = makeNavigator(true)
    // current_play 是 1.2，下一个应该是 1.3
    const next = await nav.nextVideoAfter(null)
    expect(next?.title).toBe('1.3 审美与形式')
  })

  /**
   * 起点（firstPlayable）不能参考 current_play。
   *
   * 课程页一加载，站点就把列表第一项标成 current_play（自动选中并载入播放器）。
   * 早期实现用 `nextVideoAfter(null)` 取起点 —— 它返回的是"当前项的下一项"，
   * 于是第一个视频永远刷不到，用户看到的是"有多个课时从第二个开始播放"。
   */
  it('firstPlayable 不会被 current_play 带跑：仍从第一个未完成项开始', async () => {
    const nav = makeNavigator(true)
    // 夹具默认 current_play = 1.2（真实站点是第一个视频，这里两者等价于"当前项"）
    const start = await nav.firstPlayable()
    expect(start?.title).toBe('1.2 艺术的起源')
  })

  it('firstPlayable 跳过已完成的 1.1，但不会跳到 1.3', async () => {
    await setCurrentPlay('1.1 绪论')
    const nav = makeNavigator(true)
    const start = await nav.firstPlayable()
    expect(start?.title).toBe('1.2 艺术的起源')
  })

  it('firstPlayable 在 skipCompleted=false 时从列表第一项开始', async () => {
    await setCurrentPlay('1.2 艺术的起源')
    const nav = makeNavigator(false)
    const start = await nav.firstPlayable()
    expect(start?.title).toBe('1.1 绪论')
  })

  /**
   * 定位当前位置时**标题优先于 DOM 的 current_play**（与 v1 相反，见 nav 注释）。
   *
   * 站点一加载就把第一项标成 current_play，若以它为准，
   * 「从上次进度继续」会从第一项之后开始而不是上次那节之后。
   */
  it('传入标题优先于 DOM current_play', async () => {
    const nav = makeNavigator(true)
    // DOM 停留在 1.1（站点自动选中），调用方说"刚处理完 1.2"
    await setCurrentPlay('1.1 绪论')
    const next = await nav.nextVideoAfter('1.2 艺术的起源')
    expect(next?.title).toBe('1.3 审美与形式')
  })

  it('标题不在列表里（改版/改名）时退回 current_play 定位', async () => {
    const nav = makeNavigator(true)
    await setCurrentPlay('1.2 艺术的起源')
    const next = await nav.nextVideoAfter('已被改名的旧标题')
    expect(next?.title).toBe('1.3 审美与形式')
  })

  it('找不到 current_play 时回退到传入标题', async () => {
    await page.locator('li.video').evaluateAll((nodes) => {
      for (const node of nodes) node.classList.remove('current_play')
    })
    const nav = makeNavigator(true)
    const next = await nav.nextVideoAfter('1.2 艺术的起源')
    expect(next?.title).toBe('1.3 审美与形式')
  })

  it('跳过已完成时会越过已学完的 2.1', async () => {
    const nav = makeNavigator(true)
    await setCurrentPlay('1.3 审美与形式')
    const next = await nav.nextVideoAfter('1.3 审美与形式')
    // 1.4 是小节标题、2.1 已完成 → 应落到 2.2
    expect(next?.title).toBe('2.2 雕塑与空间')
  })

  it('skipCompleted=false 时不再跳过已完成项', async () => {
    const nav = makeNavigator(false)
    await setCurrentPlay('1.3 审美与形式')
    const next = await nav.nextVideoAfter('1.3 审美与形式')
    // 2.1 已完成，但不跳过；不过 1.4 是小节标题，仍然要跳过
    expect(next?.title).toBe('2.1 绘画语言')
  })

  it('小节标题在任何配置下都不会被当成视频', async () => {
    const nav = makeNavigator(false)
    await setCurrentPlay('1.3 审美与形式')
    const next = await nav.nextVideoAfter('1.3 审美与形式')
    expect(next?.title).not.toBe('第二章 章节导语')
  })

  it('走到末尾会绕回头部，并标记 wrapped', async () => {
    const nav = makeNavigator(false)
    await setCurrentPlay('2.2 雕塑与空间')
    const next = await nav.nextVideoAfter('2.2 雕塑与空间')
    expect(next?.title).toBe('1.1 绪论')
    expect(next?.wrapped).toBe(true)
  })

  it('全部完成时 nextVideoAfter 返回 null（不再无限绕圈）', async () => {
    // 把未完成的都标成已完成，只留下小节标题
    await page.locator('li.video').evaluateAll((nodes) => {
      for (const node of nodes) {
        if (node.classList.contains('small-lesson')) continue
        if (!node.querySelector('.time_icofinish')) {
          const mark = document.createElement('i')
          mark.className = 'time_icofinish'
          node.appendChild(mark)
        }
      }
    })
    const nav = makeNavigator(true)
    expect(await nav.nextVideoAfter(null)).toBeNull()
  })

  it('点击视频会切换 current_play', async () => {
    const nav = makeNavigator()
    const target = page.locator('li.video').nth(2)
    const clicked = await nav.clickVideo(target, '1.3 审美与形式')
    expect(clicked).toBe(true)
    expect(await page.locator('li.video').nth(2).getAttribute('class')).toContain('current_play')
  })

  it('处理初始弹窗后弹窗消失', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    await page.evaluate(() => {
      const dialog = document.createElement('div')
      dialog.className = 'dialog-read'
      dialog.innerHTML = '<div class="box"><i class="iconfont">✕</i>学前必读</div>'
      dialog.querySelector('i')?.addEventListener('click', () => dialog.remove())
      document.body.appendChild(dialog)
    })

    const nav = makeNavigator()
    await nav.handleInitialDialogs()
    expect(await page.locator('.dialog-read').count()).toBe(0)
  })
})
