import type { Page } from 'playwright-core'
import type { DiscoveredCourse } from '@shared/course-discovery'
import { courseTermLabels } from '@shared/course-discovery'
import { identifyCourse } from '@shared/courses'
import { COURSE_CENTER, DEFAULT_LOGGED_URL, VIDEO_LIST_ITEM_CSS, VIDEO_SMALL_LESSON_CSS, VIDEO_TITLE_CSS, VIDEO_FINISHED_MARK_CSS } from './constants'
import { MAP_ITEM_CSS } from './map/navigator'
import { isCourseCenterLanding, waitForCourseCenter } from './login/session-check'

export interface CourseCard { name: string; tag: string; term: string; occurrence: number }
export interface DiscoveryScan {
  courses: DiscoveredCourse[]
  scanned: number
  completed: number
  unsupported: number
  warnings: string[]
}

export function courseCardKind(tag: string): 'classic' | 'map' | null {
  if (tag.trim() === '共享课') return 'classic'
  if (tag.trim() === '图谱') return 'map'
  return null
}

export class CourseDiscoveryNavigator {
  constructor(private page: Page, private shouldStop: () => boolean,
    private report: (message: string) => void, private timeout = 30_000) {}

  private check(): void { if (this.shouldStop() || this.page.isClosed()) throw new Error('获取已取消或课程窗口已关闭') }

  async readCards(): Promise<CourseCard[]> {
    const rows = await this.page.locator(COURSE_CENTER.cards.join(',')).evaluateAll((nodes, selectors) => nodes.map(node => ({
      name: node.querySelector(selectors.title)?.textContent?.trim() ?? '',
      tag: node.querySelector(selectors.tag)?.textContent?.trim() ?? '',
      term: node.querySelector(selectors.term)?.textContent?.trim() ?? ''
    })), { title: COURSE_CENTER.title.join(','), tag: COURSE_CENTER.tag.join(','), term: COURSE_CENTER.term.join(',') })
    const seen = new Map<string, number>()
    return rows.map(row => {
      const key = JSON.stringify(row), occurrence = seen.get(key) ?? 0
      seen.set(key, occurrence + 1)
      return { ...row, occurrence }
    })
  }

  /** 学期选项异步加载；“全部学期”可见并不表示目标学期已经返回。 */
  private async selectTerm(term: string): Promise<void> {
    const selector = this.page.locator(COURSE_CENTER.semester.join(',')).first()
    const deadline = Date.now() + this.timeout
    if (await selector.getAttribute('aria-expanded') !== 'true') {
      let trigger = selector
      for (const ancestor of COURSE_CENTER.semesterTriggerAncestors) {
        const wrapper = selector.locator(ancestor)
        if (await wrapper.isVisible()) { trigger = wrapper; break }
      }
      await trigger.click({ timeout: this.timeout })
    }
    const labels = courseTermLabels(term)
    const name = new RegExp(`^(?:${labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`)
    let observed: string[] = []
    while (Date.now() < deadline) {
      this.check()
      // Element Plus 的菜单挂在 body 下。只读取当前 combobox 关联的菜单，且每轮重新读取 ID。
      const controls = (await selector.getAttribute('aria-controls') ?? await selector.getAttribute('aria-owns'))?.trim().split(/\s+/)[0]
      const scope = controls ? this.page.locator(`[id=${JSON.stringify(controls)}]`) : this.page
      const option = scope.getByRole('option', { name }).filter({ visible: true }).first()
      if (await option.isVisible()) {
        this.check()
        await option.click({ timeout: Math.max(1, deadline - Date.now()) })
        return
      }
      observed = (await scope.getByRole('option').allTextContents()).map(text => text.trim()).filter(Boolean)
      await this.page.waitForTimeout(150)
    }
    this.check()
    throw new Error(`等待当前学期“${term}”选项超时；当前下拉框选项：${observed.join('、') || '尚未加载'}。请稍后重试`)
  }

  /** 只有明确看到列表结束标记才返回，不能把网络慢当作课程全部加载。 */
  async loadCurrentTerm(term: string): Promise<CourseCard[]> {
    this.check()
    if (!isCourseCenterLanding(this.page.url())) await this.page.goto(DEFAULT_LOGGED_URL, { waitUntil: 'domcontentloaded', timeout: this.timeout })
    const ready = await waitForCourseCenter(this.page, this.shouldStop, this.timeout)
    if (!ready.loggedIn) throw new Error(ready.detail)
    await this.selectTerm(term)
    const labels = courseTermLabels(term)
    for (let round = 0; round < 100; round++) {
      this.check()
      await this.waitForCards(term)
      const cards = await this.readCards()
      if (cards.some(c => c.term && !labels.includes(c.term))) throw new Error('学期筛选尚未生效，未导入课程，请重试')
      if (await this.page.getByText(COURSE_CENTER.endText).first().isVisible()) return cards
      if (!cards.length && await this.page.getByText(COURSE_CENTER.emptyText).first().isVisible()) return []
      const count = cards.length
      await this.page.locator(COURSE_CENTER.cards.join(',')).last().evaluate(el => {
        el.scrollIntoView({ block: 'end' })
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
            parent.scrollTop = parent.scrollHeight
            parent.dispatchEvent(new Event('scroll'))
            break
          }
        }
      })
      await this.page.waitForFunction(({ card, count }) => document.querySelectorAll(card).length > count || /到底了/.test(document.body.innerText),
        { card: COURSE_CENTER.cards.join(','), count }, { timeout: this.timeout })
    }
    throw new Error('课程列表超过加载上限，未导入，请检查主页后重试')
  }

  private async waitForCards(term: string): Promise<void> {
    await this.page.waitForFunction(({ card, loading, terms, title, termSelector }) => {
      const busy = Array.from(document.querySelectorAll(loading)).some(el => (el as HTMLElement).offsetHeight > 0)
      const cards = Array.from(document.querySelectorAll(card))
      const ready = cards.length > 0 && cards.every(el => {
        const label = el.querySelector(termSelector)?.textContent?.trim()
        return el.querySelector(title)?.textContent?.trim() && (!label || terms.includes(label))
      })
      return !busy && (ready || (!cards.length && /暂无课程|暂无数据|没有课程/.test(document.body.innerText)))
    }, { card: COURSE_CENTER.cards.join(','), loading: COURSE_CENTER.loading.join(','), title: COURSE_CENTER.title.join(','),
      termSelector: COURSE_CENTER.term.join(','), terms: courseTermLabels(term) }, { timeout: this.timeout })
  }

  /** 不点击视频或练习，只读取平台返回的学习进度。 */
  async completion(kind: 'classic' | 'map'): Promise<boolean> {
    const selector = kind === 'classic' ? VIDEO_LIST_ITEM_CSS : MAP_ITEM_CSS
    await this.page.locator(selector).first().waitFor({ state: 'attached', timeout: this.timeout })
    // 等待异步进度和整棵目录渲染稳定，避免只看到第一个章节便判定完成。
    let previous = '', stable = 0
    const deadline = Date.now() + this.timeout
    while (Date.now() < deadline) {
      this.check()
      const states = kind === 'classic'
        ? await this.page.locator(selector).evaluateAll((nodes, s) => nodes
          .filter(n => !n.matches(s.small) && !n.querySelector(s.small) && n.querySelector(s.title)?.textContent?.trim())
          .map(n => ({ id: n.textContent, progress: n.querySelector(s.done) ? 100 : 0 })),
        { small: VIDEO_SMALL_LESSON_CSS, title: VIDEO_TITLE_CSS, done: VIDEO_FINISHED_MARK_CSS })
        : await this.page.locator(selector).evaluateAll(nodes => nodes.map(n => {
          const match = /学习进度\s*([\d.]+)\s*%/.exec(n.textContent ?? '')
          return { id: n.id, progress: match ? Number(match[1]) : null }
        }))
      const signature = JSON.stringify(states)
      stable = signature === previous ? stable + 1 : 0
      previous = signature
      if (stable >= 2 && states.length && states.every(s => s.progress !== null && s.progress >= 0 && s.progress <= 100)) {
        return states.every(s => s.progress === 100)
      }
      await this.page.waitForTimeout(500)
    }
    throw new Error('学习进度未完整加载，已跳过，请稍后重试')
  }

  async scan(term: string): Promise<DiscoveryScan> {
    this.report(`正在加载${term}的全部课程`)
    const cards = await this.loadCurrentTerm(term)
    const result: DiscoveryScan = { courses: [], scanned: 0, completed: 0, unsupported: 0, warnings: [] }
    const candidates = cards.filter(card => {
      if (courseCardKind(card.tag)) return true
      result.unsupported++
      return false
    })
    for (const [index, card] of candidates.entries()) {
      this.check()
      this.report(`检查 ${index + 1}/${candidates.length}：${card.name}`)
      try {
        const current = index === 0 ? cards : await this.loadCurrentTerm(term)
        const position = current.findIndex(c => c.name === card.name && c.tag === card.tag && c.term === card.term && c.occurrence === card.occurrence)
        if (position < 0) throw new Error('课程卡片已变更，请重新获取')
        const kind = courseCardKind(card.tag)!
        await this.page.locator(COURSE_CENTER.cards.join(',')).nth(position).locator(COURSE_CENTER.title.join(',')).click({ timeout: this.timeout })
        // BrowserService 在获取期间将课程弹窗导航收进当前受控窗口。
        await this.page.waitForURL(url => {
          try { return identifyCourse(url.toString()).kind === kind } catch { return false }
        }, { timeout: this.timeout })
        const parsed = identifyCourse(this.page.url())
        if (await this.completion(kind)) result.completed++
        else result.courses.push({ name: card.name, url: parsed.url, kind })
      } catch (error) {
        this.check()
        result.warnings.push(`${card.name}：${error instanceof Error ? error.message : String(error)}`)
      }
      result.scanned++
    }
    return result
  }
}
