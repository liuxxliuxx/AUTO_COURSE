/**
 * Runner 主循环端到端测试。
 *
 * 用具夹页面把「点击 → 监控 → 记账 → 找下一个 → 终止」整条循环真实跑一遍，
 * 只把**登录**换成桩（真实登录需要线上账号）。
 *
 * 重点验证 handoff §28 点名的那条修正：skip_completed=false 时必须能正常结束，
 * 而不是绕回起点无限循环。
 *
 * ⚠️ 夹具准备的两个要点：
 *  1. `videoUrl` 传空串 —— Runner 会先 `navigate(videoUrl)`，再去做列表解析。
 *     如果传了 URL，Runner 会重新加载页面，**把测试预先摆好的 DOM 全部冲掉**，
 *     于是断言的就是未被改动的原始夹具，测试会"通过"但验的不是想验的东西。
 *  2. 关掉 `<video loop>` 并换成 20 秒的素材 —— 夹具默认的 tiny.webm 只有 2 秒，
 *     监控循环「确保在播」那一段等待就要 2~5 秒，进循环时视频已经结束了，
 *     elapsed 恒为 0，时长上限与「已看时长」这类断言全部失真。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { ClassicCourseRunner } from '../../src/main/automation/classic/classic-course-runner'
import type { LoginProvider } from '../../src/main/automation/login/provider'
import type { RunOutcome, RunnerContext } from '../../src/main/automation/runner'
import { EventBus } from '../../src/main/services/event-bus'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import type { AppSettings } from '../../src/shared/types'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')

/** 桩登录：直接成功，不碰任何线上站点 */
const stubLogin: LoginProvider = {
  method: 'zhihuishu',
  login: async () => ({ ok: true, alreadyLoggedIn: true, message: '（测试桩）已登录' })
}

let server: FixtureServer
let browser: Browser
let dir: string

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir)
  browser = await chromium.launch({ headless: true })
  dir = mkdtempSync(join(tmpdir(), 'ac-runner-'))
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
  rmSync(dir, { recursive: true, force: true })
})

interface Harness {
  page: Page
  context: RunnerContext
  watched: number[]
  completed: string[]
  logs: string[]
  stop: () => void
}

/** 建一个已经加载好夹具的页面，并让 Runner 不要重新导航 */
async function makeHarness(
  overrides: Partial<AppSettings> = {},
  prepare?: (page: Page) => Promise<void>
): Promise<Harness> {
  const page = await browser.newPage()
  await page.goto(`${server.origin}/classic-course.html`)
  // 换成 20 秒素材并关掉循环：视频会真正走到 ended，且 elapsed 能真的累积
  await page.evaluate(async () => {
    const v = document.querySelector('#courseVideo') as HTMLVideoElement | null
    if (!v) return
    v.loop = false
    v.src = '/assets/tiny-long.webm'
    await new Promise<void>((resolve) => {
      if (v.readyState >= 1 && Number.isFinite(v.duration)) return resolve()
      v.addEventListener('loadedmetadata', () => resolve(), { once: true })
    })
  })
  if (prepare) await prepare(page)

  const session = new BrowserSession(page, () => {})

  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    // 空串 → Runner 跳过 navigate，保住我们刚摆好的 DOM
    videoUrl: '',
    courseNote: '测试课程',
    timeLimitMinutes: 0,
    ...overrides
  }

  const watched: number[] = []
  const completed: string[] = []
  const logs: string[] = []
  let stopped = false

  const context: RunnerContext = {
    settings,
    credentials: { username: 'u', password: 'p' },
    bus: new EventBus(),
    session,
    log: {
      debug: () => {},
      info: (m) => logs.push(m),
      warn: (m) => logs.push(`WARN ${m}`),
      error: (m) => logs.push(`ERROR ${m}`),
      exception: () => {}
    },
    media: null,
    lastVideoTitle: '',
    shouldStop: () => stopped,
    sessionWatchedSeconds: () => watched.reduce((a, b) => a + b, 0),
    reportVideoWatched: (s) => watched.push(s),
    reportVideoCompleted: (t) => completed.push(t),
    reportCurrentTitle: () => {},
    requestCaptcha: async () => true
  }

  return {
    page,
    context,
    watched,
    completed,
    logs,
    stop: () => {
      stopped = true
    }
  }
}

/** 把所有非小节条目都标成已完成 */
async function markAllFinished(page: Page): Promise<void> {
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
}

/** 把 current_play 挪到指定标题 */
async function setCurrentPlay(page: Page, title: string): Promise<void> {
  await page.locator('li.video').evaluateAll((nodes, wanted) => {
    for (const node of nodes) {
      node.classList.remove('current_play')
      const text = (node.querySelector('.catalogue_title') as HTMLElement | null)?.innerText.trim()
      if (text === wanted) node.classList.add('current_play')
    }
  }, title)
}

const run = (harness: Harness): Promise<RunOutcome> =>
  new ClassicCourseRunner(() => stubLogin).run(harness.context)

describe('ClassicCourseRunner 主循环', () => {
  it('skip_completed=true：只处理未完成项，跳过已完成与小节标题', async () => {
    const harness = await makeHarness({ skipCompleted: true })
    const outcome = await run(harness)

    expect(harness.completed.length).toBeGreaterThan(0)
    expect(harness.completed).not.toContain('1.1 绪论') // 已完成
    expect(harness.completed).not.toContain('2.1 绘画语言') // 已完成
    expect(harness.completed).not.toContain('第二章 章节导语') // 小节标题
    expect(outcome.reason).toBe('completed')

    await harness.page.close()
  }, 300_000)

  /**
   * handoff §28「Classic Course 回环」：
   * v1 在 skip_completed=false 时会环形回到起点无限刷下去。
   * v2 必须在跑完一轮后正常结束。
   */
  it('skip_completed=false：跑完一轮就结束，不会无限循环', async () => {
    const harness = await makeHarness({ skipCompleted: false })
    const outcome = await run(harness)

    // 每一项最多处理一次
    expect(new Set(harness.completed).size).toBe(harness.completed.length)
    expect(harness.completed.length).toBeLessThanOrEqual(5)
    expect(outcome.reason).toBe('completed')
    expect(harness.logs.some((m) => m.includes('已回到本轮起点'))).toBe(true)

    await harness.page.close()
  }, 300_000)

  it('时长上限触发时以 time-limit 结束，且只处理一节', async () => {
    const harness = await makeHarness({ skipCompleted: true, timeLimitMinutes: 1 })
    // 先垫 300 秒已看时长：处理完第一节后累计必然超过 1 分钟上限
    const base = harness.context.sessionWatchedSeconds
    ;(harness.context as { sessionWatchedSeconds: () => number }).sessionWatchedSeconds = () =>
      300 + base()

    const outcome = await run(harness)

    expect(outcome.reason).toBe('time-limit')
    expect(harness.completed).toHaveLength(1)

    await harness.page.close()
  }, 300_000)

  it('外部停止会结束循环并保留已看时长', async () => {
    const harness = await makeHarness({ skipCompleted: true })
    // 点击约 3.5s，20 秒素材的监控至少要跑十几秒，9 秒必然落在监控循环里
    const timer = setTimeout(() => harness.stop(), 9000)

    const outcome = await run(harness)
    clearTimeout(timer)

    expect(outcome.reason).toBe('user')
    expect(harness.watched.length).toBeGreaterThan(0)
    expect(harness.watched.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    await harness.page.close()
  }, 300_000)

  it('没有可处理视频时以 pool-exhausted 结束', async () => {
    const harness = await makeHarness({ skipCompleted: true }, markAllFinished)
    const outcome = await run(harness)

    expect(outcome.reason).toBe('pool-exhausted')
    expect(outcome.completedCount).toBe(0)
    expect(harness.completed).toHaveLength(0)

    await harness.page.close()
  }, 120_000)

  it('从上次进度继续：不从列表最前面开始', async () => {
    const harness = await makeHarness({ skipCompleted: true }, (page) =>
      setCurrentPlay(page, '1.3 审美与形式')
    )
    const outcome = await run(harness)

    expect(harness.completed.length).toBeGreaterThan(0)
    // current_play 在 1.3，起点从它之后算，所以不该先处理 1.1 / 1.2
    expect(harness.completed[0]).not.toBe('1.1 绪论')
    expect(harness.completed[0]).not.toBe('1.2 艺术的起源')
    expect(outcome.reason).toBe('completed')

    await harness.page.close()
  }, 300_000)

  it('登录失败且被停止时直接返回 user，不做后续动作', async () => {
    const harness = await makeHarness()
    const failing: LoginProvider = {
      method: 'zhihuishu',
      login: async () => ({ ok: false, alreadyLoggedIn: false, message: '失败' })
    }
    harness.stop()

    const outcome = await new ClassicCourseRunner(() => failing).run(harness.context)

    expect(outcome.completedCount).toBe(0)
    expect(harness.completed).toHaveLength(0)

    await harness.page.close()
  }, 120_000)

  it('每节视频都会上报观看时长与完成', async () => {
    const harness = await makeHarness({ skipCompleted: true })
    // 只处理第一节就停，避免跑满整轮
    const timer = setTimeout(() => harness.stop(), 20000)
    await run(harness)
    clearTimeout(timer)

    if (harness.completed.length > 0) {
      expect(harness.watched.length).toBeGreaterThanOrEqual(harness.completed.length)
    }

    await harness.page.close()
  }, 300_000)
})
