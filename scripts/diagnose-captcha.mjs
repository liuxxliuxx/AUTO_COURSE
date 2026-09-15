/**
 * 验证码**误报**诊断脚本。
 *
 * 复用应用自己的 Browser Host（同一个二进制、同一个 userData），
 * 因此带着上次登录的 Cookie，可以在真实课程页上把「哪些元素被判成了验证码」
 * 逐条打印出来 —— 每条都附上它为什么可见 / 为什么不可见。
 *
 * 用法：
 *   node scripts/diagnose-captcha.mjs "<课程页 URL>"
 *   node scripts/diagnose-captcha.mjs "<课程页 URL>" --click "三个名人的人生境界故事"
 *
 * --click 会在页面上找到含该标题的 li.video 并点一下，再采集一次 ——
 * 「切换课程时出现验证码」这类误报正好发生在这一步之后。
 */

import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const url = process.argv[2]
const clickIndex = process.argv.indexOf('--click')
const clickTitle = clickIndex >= 0 ? process.argv[clickIndex + 1] : null

if (!url) {
  console.error('用法: node scripts/diagnose-captcha.mjs "<URL>" [--click "<视频标题>"]')
  process.exit(2)
}

/** 与 src/main/automation/constants.ts 保持一致 */
const KEYWORDS = ['captcha', 'yidun', 'turing', 'cstaticdun', 'necaptcha', 'verify']
const POPUPS = [
  '.yidun_popup',
  '.yidun_modal',
  '.yidun_popup__content',
  '#tcaptcha_transform_dy',
  '#lPwdError'
]
const IMAGE_INPUT_ID = 'j-captcha-mobile'

const downloadDir = join(root, 'tests', '.tmp', 'captcha-diag', 'downloads')
mkdirSync(downloadDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, '--browser-host', `--download-dir=${downloadDir}`],
  cwd: root,
  env: { ...process.env }
})

/** 页面里跑一遍检测 + 采集「为什么」 */
const probe = (keywords, popups, imageInputId) =>
  // eslint-disable-next-line no-undef
  (([keywords, popups, imageInputId]) => {
    const describe = (el) => {
      const rect = el.getBoundingClientRect()
      const chain = []
      let hiddenBy = null
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const cs = getComputedStyle(node)
        if (
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          cs.visibility === 'collapse' ||
          Number(cs.opacity) === 0
        ) {
          hiddenBy = {
            tag: node.tagName.toLowerCase(),
            id: node.id || null,
            cls: typeof node.className === 'string' ? node.className.slice(0, 80) : null,
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity
          }
          break
        }
        chain.push(`${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}`)
      }

      const vw = window.innerWidth
      const vh = window.innerHeight
      const intersects =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < vw &&
        rect.top < vh

      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const inViewport = cx >= 0 && cy >= 0 && cx < vw && cy < vh
      const top = inViewport ? document.elementFromPoint(cx, cy) : null
      const covered = inViewport ? !(top === el || el.contains(top) || top?.contains(el)) : null

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: typeof el.className === 'string' ? el.className.slice(0, 120) : null,
        src: el.getAttribute?.('src') ?? null,
        display: getComputedStyle(el).display,
        visibility: getComputedStyle(el).visibility,
        opacity: getComputedStyle(el).opacity,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        },
        oldRule: rect.width > 10 && rect.height > 0, // 迁移后的判定
        v1Rule: getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden',
        intersectsViewport: intersects,
        hiddenBy,
        hiddenByAncestor: hiddenBy !== null,
        coveredByOtherElement: covered,
        topElementAtCenter: top
          ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}.${String(top.className).slice(0, 40)}`
          : null
      }
    }

    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
      matched: KEYWORDS.some((k) => (f.getAttribute('src') ?? '').toLowerCase().includes(k)),
      ...describe(f)
    }))

    const popupHits = []
    for (const sel of popups) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        popupHits.push({ selector: sel, ...describe(el) })
      }
    }

    const imageInput = document.getElementById(imageInputId)
    return {
      page: { url: location.href, title: document.title, vw: window.innerWidth, vh: window.innerHeight },
      iframes,
      popupHits,
      imageInput: imageInput ? describe(imageInput) : null
    }
  })([keywords, popups, imageInputId])

const collect = async (label) => {
  const report = await page.evaluate(probe, [KEYWORDS, POPUPS, IMAGE_INPUT_ID])
  console.log(`\n================ ${label} ================`)
  console.log(`页面: ${report.page.url}\n标题: ${report.page.title}\n视口: ${report.page.vw}x${report.page.vh}`)

  console.log('\n--- iframe ---')
  if (report.iframes.length === 0) console.log('(无)')
  for (const f of report.iframes) {
    const verdict = f.matched ? (f.oldRule ? '旧规则=命中' : '旧规则=跳过') : '关键字不匹配'
    console.log(
      `[${verdict}] src=${f.src}\n    rect=${JSON.stringify(f.rect)} oldRule=${f.oldRule} v1Rule=${f.v1Rule} ` +
        `在视口内=${f.intersectsViewport} 被祖先隐藏=${f.hiddenByAncestor} 被遮挡=${f.coveredByOtherElement}` +
        `${f.hiddenBy ? `\n    隐藏来源: ${JSON.stringify(f.hiddenBy)}` : ''}` +
        `${f.coveredByOtherElement ? `\n    中心点元素: ${f.topElementAtCenter}` : ''}`
    )
  }

  console.log('\n--- 弹窗候选 ---')
  if (report.popupHits.length === 0) console.log('(无)')
  for (const p of report.popupHits) {
    console.log(
      `[${p.oldRule ? '旧规则=命中' : '旧规则=跳过'}] ${p.selector}\n    rect=${JSON.stringify(p.rect)} ` +
        `display=${p.display} visibility=${p.visibility} opacity=${p.opacity} 在视口内=${p.intersectsViewport} ` +
        `被祖先隐藏=${p.hiddenByAncestor} 被遮挡=${p.coveredByOtherElement}` +
        `${p.hiddenBy ? `\n    隐藏来源: ${JSON.stringify(p.hiddenBy)}` : ''}` +
        `${p.coveredByOtherElement ? `\n    中心点元素: ${p.topElementAtCenter}` : ''}`
    )
  }

  console.log('\n--- 图片验证码输入框 ---')
  console.log(report.imageInput ? JSON.stringify(report.imageInput) : '(无)')

  const falsy = [
    ...report.iframes.filter((f) => f.matched && f.oldRule),
    ...report.popupHits.filter((p) => p.oldRule),
    ...(report.imageInput?.oldRule ? [report.imageInput] : [])
  ]
  console.log(
    `\n>>> 旧规则本轮会判定为「有验证码」的元素数: ${falsy.length}` +
      (falsy.length ? ' —— 见上方「旧规则=命中」项' : '')
  )
  return falsy
}

let page
try {
  page = await app.firstWindow({ timeout: 30_000 })
  console.log(`导航到 ${url} ...`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(5_000)

  await collect('加载后')

  if (clickTitle) {
    const item = page.locator('li.video', { hasText: clickTitle }).first()
    if (await item.count()) {
      console.log(`\n点击视频「${clickTitle}」...`)
      await item.click({ timeout: 10_000 }).catch((e) => console.log(`点击失败: ${e.message}`))
      await page.waitForTimeout(4_000)
      await collect(`点击「${clickTitle}」后`)
    } else {
      console.log(`\n未找到标题含「${clickTitle}」的 li.video`)
    }
  }
} catch (error) {
  console.error('诊断失败:', error instanceof Error ? error.message : String(error))
} finally {
  await app.close().catch(() => undefined)
}
