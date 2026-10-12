import type { Locator, Page } from 'playwright-core'
import type { Logger } from '../../services/logger'
import {
  COURSE_INFO_CLOSE_CSS, COURSE_INFO_MARKERS, COURSE_INFO_PROTECTED_CSS,
  LEARNING_PROGRESS_POPUP_CSS
} from '../constants'

/** Dismiss passive course information cards using site controls and verify the result. */
export class CourseOverlays {
  private serial = 0
  constructor(private readonly page: Page, private readonly log: Logger) {}

  async dismiss(): Promise<number> {
    const token = `ac-info-${Date.now()}-${this.serial++}`
    const panels = await this.page.evaluate(({ token, markers, closeSelectors, protectedSelectors, knownSelectors }) => {
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' &&
          r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
      }
      const text = (el: Element): string => (el as HTMLElement).innerText ?? el.textContent ?? ''
      const passive = (el: Element): boolean => {
        const value = text(el).replace(/\s+/g, '')
        if (/(?:提交|保存|同步)失败|网络连接问题|返回学堂|重新进入视频/.test(value)) return false
        return /欢迎(?:你)?加入课程/.test(value) ||
          ['课程学习时间', '考试时间', '考核比'].filter(key => value.includes(key)).length >= 2 ||
          /当前时间计划学习进度|班级平均学习进度/.test(value) ||
          (knownSelectors.some(selector => el.matches(selector) || !!el.querySelector(selector)) && value.includes('学习进度'))
      }
      const floating = (el: Element): boolean => {
        if (['fixed', 'absolute'].includes(getComputedStyle(el).position)) return true
        // Ordinary course copy inside an absolutely positioned layout is not a popup.
        if (!knownSelectors.some(selector => el.matches(selector)) && el.getAttribute('role') !== 'dialog') return false
        for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
          if (['fixed', 'absolute'].includes(getComputedStyle(node).position)) return true
        }
        return false
      }
      const closeControl = (root: Element): Element | undefined => {
        const bounds = root.getBoundingClientRect()
        return Array.from(root.querySelectorAll(closeSelectors.join(','))).filter(el => {
          if (!visible(el)) return false
          const rect = el.getBoundingClientRect()
          if (rect.width > 64 || rect.height > 64) return false
          const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.getAttribute('class') ?? ''}`
          const explicit = /close|guanbi|关闭/i.test(label) || /^[×✕✖xX]$/.test(text(el).trim())
          const corner = rect.left >= bounds.left + bounds.width * 0.65 && rect.top <= bounds.top + Math.min(80, bounds.height * 0.25)
          const clickable = getComputedStyle(el).cursor === 'pointer' || el.matches('button,[role="button"]')
          return explicit || (corner && clickable && text(el).trim().length <= 1)
        }).sort((a, b) => {
          // Prefer the outer clickable control over a nested SVG path/icon.
          if (a.contains(b)) return -1
          if (b.contains(a)) return 1
          return b.getBoundingClientRect().right - a.getBoundingClientRect().right
        })[0]
      }
      const seeds = new Set<Element>()
      for (const selector of knownSelectors) document.querySelectorAll(selector).forEach(el => seeds.add(el))
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (markers.some(marker => node.textContent?.includes(marker)) && node.parentElement) seeds.add(node.parentElement)
      }
      const roots = new Map<Element, Element | undefined>()
      for (const seed of seeds) {
        let fallback: Element | null = null
        for (let root: Element | null = seed; root && root !== document.body; root = root.parentElement) {
          if (!visible(root)) continue
          const r = root.getBoundingClientRect()
          if (root.querySelector(protectedSelectors.join(',')) || root.matches(protectedSelectors.join(','))) break
          if (r.width < 120 || r.height < 60 || r.width * r.height > innerWidth * innerHeight * 0.8 || !floating(root) || !passive(root)) continue
          fallback = root
          const close = closeControl(root)
          if (close) { roots.set(root, close); fallback = null; break }
        }
        if (fallback) roots.set(fallback, undefined)
      }
      // A text seed may discover a child of another panel. Keep the complete panel once.
      const panels = [...roots].filter(([root]) => ![...roots.keys()].some(other => other !== root && other.contains(root)))
      return panels.map(([root, close], index) => {
        const id = `${token}-${index}`
        root.setAttribute('data-ac-course-info', id)
        close?.setAttribute('data-ac-course-info-close', id)
        return { id, hasClose: !!close }
      })
    }, {
      token, markers: COURSE_INFO_MARKERS, closeSelectors: COURSE_INFO_CLOSE_CSS,
      protectedSelectors: COURSE_INFO_PROTECTED_CSS, knownSelectors: LEARNING_PROGRESS_POPUP_CSS
    })
    let removed = 0
    for (const { id, hasClose } of panels) {
      const root = this.page.locator(`[data-ac-course-info="${id}"]`)
      if (hasClose) {
        await this.page.locator(`[data-ac-course-info-close="${id}"]`).click({ timeout: 700 }).catch(() => {})
        await root.waitFor({ state: 'hidden', timeout: 500 }).catch(() => {})
      }
      if (await root.isVisible().catch(() => false)) {
        // Narrow fallback for the identified passive card; never remove a course container/mask.
        await root.evaluate(el => el.remove()).catch(() => {})
      }
      if (!(await root.isVisible().catch(() => false))) {
        removed++
        this.log.info('已关闭课程信息/学习助手浮层')
      } else {
        this.log.warn('课程信息浮层仍未关闭')
      }
    }
    return removed
  }

  /** Classify the actual blocking layer, including a mask's sibling dialog. */
  async inspect(target: Locator): Promise<{
    description: string
    signature: string
    reloadRequired: boolean
    closeId: string | null
  } | null> {
    const token = `ac-blocker-${Date.now()}-${this.serial++}`
    return target.evaluate((el, { token, protectedSelectors }) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!hit || hit === el || el.contains(hit)) return null
      const visible = (node: Element): boolean => {
        const b = node.getBoundingClientRect(), style = getComputedStyle(node)
        return b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 &&
          b.top < innerHeight && b.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden'
      }
      const text = (node: Element): string => ((node as HTMLElement).innerText ?? node.textContent ?? '').replace(/\s+/g, ' ').trim()
      let root = hit
      let floating = false
      for (let node: Element | null = hit; node && node !== document.body; node = node.parentElement) {
        if (node.contains(el)) break
        root = node
        if (node.matches('[role="dialog"],[aria-modal="true"]') || ['fixed', 'absolute'].includes(getComputedStyle(node).position)) {
          floating = true
          break
        }
      }
      // Some libraries render the mask and dialog as siblings in one portal.
      const parent = root.parentElement
      if (parent && parent !== document.body && !parent.contains(el)) root = parent
      const candidates = [root, ...Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],.el-message-box,.el-dialog,.ant-modal,.layui-layer'))]
        .filter(visible)
      // Unknown component classes still expose error text inside a floating ancestor.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!/学习进度|网络连接|连接服务器/.test(node.textContent ?? '')) continue
        for (let panel = node.parentElement; panel && panel !== document.body; panel = panel.parentElement) {
          if (panel.contains(el)) break
          if (visible(panel) && ['fixed', 'absolute'].includes(getComputedStyle(panel).position)) {
            candidates.push(panel)
            break
          }
        }
      }
      const protectedCss = protectedSelectors.join(',')
      const protectedPanel = (node: Element): boolean => node.matches(protectedCss) || !!node.querySelector(protectedCss)
      const needsReload = (node: Element): boolean => {
        const value = text(node).replace(/\s+/g, '')
        return /学习进度.*(?:提交|保存|同步)失败/.test(value) ||
          /(?:网络连接|连接服务器).*(?:失败|异常|问题)/.test(value) && /(?:重新进入|刷新|重新加载|返回学堂)/.test(value)
      }
      const failed = protectedPanel(root) ? undefined : candidates.find(node => !protectedPanel(node) && needsReload(node))
      if (failed) root = failed
      const description = `${root.tagName.toLowerCase()}${root.id ? `#${root.id}` : ''} ${text(root).slice(0, 500)}`
      let close: Element | undefined
      if (!failed && floating && !protectedPanel(root)) {
        close = Array.from(root.querySelectorAll('button,[role="button"],a,[aria-label],[title],[class*="close" i]')).find(node => {
          if (!visible(node)) return false
          const value = text(node)
          const label = node.getAttribute('aria-label') ?? node.getAttribute('title') ?? ''
          // Only explicit dismissal actions: never guess an unknown confirmation/navigation action.
          return /^(?:关闭|close)$/i.test(label.trim()) ||
            /^(?:知道了|我知道了|关闭|好的|×|✕|✖)$/.test(value) ||
            (!value && /close/i.test(node.getAttribute('class') ?? ''))
        })
        close?.setAttribute('data-ac-blocker-close', token)
      }
      return { description, signature: description, reloadRequired: !!failed, closeId: close ? token : null }
    }, { token, protectedSelectors: COURSE_INFO_PROTECTED_CSS }).catch(() => null)
  }

  async closeBlocker(id: string): Promise<boolean> {
    const control = this.page.locator(`[data-ac-blocker-close="${id}"]`)
    try {
      await control.click({ timeout: 700 })
      return true // The caller rechecks hit testing; a click alone does not prove dismissal.
    } catch { return false }
  }

  /** Inspect hit targets instead of waiting for a blocked click to time out. */
  async obstruction(target: Locator): Promise<string | null> {
    return target.evaluate(el => {
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null
      const hit = document.elementFromPoint(x, y)
      if (!hit || hit === el || el.contains(hit)) return null
      return `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''} ${((hit as HTMLElement).innerText ?? '').trim().slice(0, 100)}`
    }).catch(() => null)
  }
}
