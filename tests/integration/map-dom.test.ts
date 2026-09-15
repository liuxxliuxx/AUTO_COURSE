/**
 * 图谱课 DOM 夹具测试。
 *
 * 夹具 `tests/fixtures/map-course.html` 复刻了 map_course.py 注释里记的两个坑：
 *  - 知识项的 id 是 knowledgeId-XXX；
 *  - 视频卡片与 PPT 卡片的 class 都是 basic-info-video-card-container。
 */

import { chromium, type Browser, type Page } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { MapCourseNavigator } from '../../src/main/automation/map/navigator'
import type { Logger } from '../../src/main/services/logger'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, '..', 'fixtures')

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
let navigator: MapCourseNavigator

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir)
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  navigator = new MapCourseNavigator(page, silentLog)
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

beforeEach(async () => {
  await page.goto(`${server.origin}/map-course.html`)
})

describe('图谱页解析', () => {
  it('解析出全部知识项及其进度', async () => {
    const items = await navigator.getKnowledgeItems()
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.knowledgeId)).toEqual(['1001', '1002', '1003'])
    expect(items.map((i) => i.progress)).toEqual([100, 40, 0])
    expect(items[0].title).toBe('艺术的定义')
  })

  it('标题里不含「学习进度」与百分号', async () => {
    const items = await navigator.getKnowledgeItems()
    for (const item of items) {
      expect(item.title).not.toContain('学习进度')
      expect(item.title).not.toContain('%')
    }
  })

  it('页面上没有知识项时返回空数组', async () => {
    await page.goto(`${server.origin}/classic-course.html`)
    expect(await navigator.getKnowledgeItems()).toEqual([])
  })
})

describe('学习页必学资源解析', () => {
  beforeEach(async () => {
    await page.goto(`${server.origin}/map-course.html#study`)
  })

  it('只取「必学」分区，忽略「选学」', async () => {
    const resources = await navigator.getMustLearnResources()
    expect(resources).toHaveLength(3)
    expect(resources.map((r) => r.title).join(' ')).not.toContain('选学')
  })

  it('视频与 PPT 的 class 相同，但类型判定正确', async () => {
    const resources = await navigator.getMustLearnResources()

    const video = resources.find((r) => r.title.includes('艺术是什么'))
    const ppt = resources.find((r) => r.title.includes('课件讲义'))
    const done = resources.find((r) => r.title.includes('拓展阅读'))

    expect(video?.type).toBe('video')
    expect(ppt?.type).toBe('other') // 靠「共 24 页」判出来，不是靠 class
    expect(done?.type).toBe('video') // 已完成但仍是视频
    expect(done?.done).toBe(true)
  })

  /**
   * index 必须是全页卡片的文档序下标 —— openResource 用它来定位。
   * 选学卡片夹在中间时，只按必学分区计数会点错。
   */
  it('index 与页面上的卡片下标对齐', async () => {
    const resources = await navigator.getMustLearnResources()
    for (const resource of resources) {
      const text = await page
        .locator(
          ".basic-info-video-card-container, .resources-list > *, .resources-list [class*='item']"
        )
        .nth(resource.index)
        .innerText()
      expect(text.replace(/\s+/g, ' ').trim()).toBe(resource.title)
    }
  })

  it('openResource 点到的确实是那一张卡片', async () => {
    const resources = await navigator.getMustLearnResources()
    const ppt = resources.find((r) => r.title.includes('课件讲义'))
    expect(ppt).toBeDefined()

    expect(await navigator.openResource(ppt!)).toBe(true)
    const opened = await page.locator('.basic-info-video-card-container.opened').count()
    expect(opened).toBe(1)
    expect(await page.locator('.basic-info-video-card-container.opened').innerText()).toContain(
      '课件讲义'
    )
  })
})

describe('播放器状态读取', () => {
  it('学习页里能读到被容器包住的 video', async () => {
    await page.goto(`${server.origin}/map-course.html#study`)
    await page.locator('#mapVideo').evaluate((el) => {
      el.setAttribute('src', '/assets/tiny.webm')
    })
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#mapVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 15_000 }
    )

    const info = await navigator.getVideoInfo()
    expect(info.found).toBe(true)
    expect(info.duration).toBeGreaterThan(0)
    expect(info.paused).toBe(true)
  })

  it('页面上没有 video 时返回 found=false', async () => {
    await page.goto(`${server.origin}/quiz-dialog.html`)
    const info = await navigator.getVideoInfo()
    expect(info.found).toBe(false)
    expect(info.duration).toBe(0)
  })

  it('resumeVideo 能让暂停的视频重新播放', async () => {
    await page.goto(`${server.origin}/map-course.html#study`)
    await page.locator('#mapVideo').evaluate((el) => {
      const v = el as HTMLVideoElement
      v.setAttribute('src', '/assets/tiny.webm')
    })
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#mapVideo') as HTMLVideoElement | null
        return !!v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 15_000 }
    )

    await page.locator('#mapVideo').evaluate((el) => (el as HTMLVideoElement).play())
    await page.waitForTimeout(300)
    await page.locator('#mapVideo').evaluate((el) => (el as HTMLVideoElement).pause())
    expect((await navigator.getVideoInfo()).paused).toBe(true)

    await navigator.resumeVideo()
    await page.waitForTimeout(300)
    expect((await navigator.getVideoInfo()).paused).toBe(false)
  })
})
