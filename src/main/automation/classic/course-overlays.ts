import type { Locator, Page } from 'playwright-core'
import type { Logger } from '../../services/logger'

export type LayerKind = 'preschool' | 'info' | 'reminder' | 'assistant' | 'notice' | 'progress-error' | 'quiz' | 'protected' | 'unknown'
export interface CourseLayer {
  id: string
  kind: LayerKind
  description: string
  closeId: string | null
  actionable: boolean
  blocking: boolean
  exiting?: boolean
}

/** Browser-side inspection. All control discovery is scoped to one semantic panel. */
export function inspectCourseLayers(targetId: string | null): CourseLayer[] {
  const excluded = '.video-topic'
  const exitingMask = '.v-modal.v-modal-leave,.v-modal.v-modal-leave-active,.el-overlay.is-leaving'
  const protectedCss = '.yidun_popup,.yidun_modal,[class*="captcha" i],#tcaptcha_transform_dy,#lPwdError'
  const visible = (el: Element, allowTransparent = false): boolean => {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || /hidden|collapse/.test(style.visibility) || !allowTransparent && Number(style.opacity) === 0) return false
      if (node !== el && /hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) {
        const b = node.getBoundingClientRect()
        if (r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom) return false
      }
    }
    return true
  }
  const text = (el: Element): string => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()
  const floating = (el: Element): boolean => el.matches('[role="dialog"],[aria-modal="true"]') || ['fixed', 'absolute'].includes(getComputedStyle(el).position)
  const ignored = (el: Element): boolean => !!el.closest(excluded)
  const protectedNode = (el: Element): boolean => !!el.closest(protectedCss) || (el.matches('iframe') && /captcha|yidun|turing|verify/i.test(el.getAttribute('src') ?? ''))
  const structural = (el: Element): boolean => el.matches('body,html,video,li.video') || !!el.querySelector('video,li.video')
  const target = targetId ? document.querySelector(`[data-ac-target="${targetId}"]`) : null
  let hit: Element | null = null
  if (target) {
    const r = target.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    if (r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
      const top = document.elementFromPoint(x, y)
      if (top && top !== target && !target.contains(top) && !ignored(top)) hit = top
    }
  }
  const roots = new Set<Element>()
  document.querySelectorAll('[role="dialog"],[aria-modal="true"],.el-dialog,.el-message-box,.ant-modal,.layui-layer,.dialog-read,.ss2077-msg-custom,.ai-draggable-dialog,' + exitingMask + ',' + protectedCss + ',iframe').forEach(el => {
    if (el.matches('iframe') && !protectedNode(el)) return
    if (visible(el,el.matches(exitingMask)) && !ignored(el) && !structural(el)) roots.add(el)
  })
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/欢迎|学习|考试时间|考核比|网络|提交|保存|同步/.test(node.textContent ?? '')) continue
    for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
      if (ignored(el) || structural(el)) break
      if (visible(el) && floating(el) && el.getBoundingClientRect().width >= 100 && el.getBoundingClientRect().height >= 16) { roots.add(el); break }
    }
  }
  if (hit) {
    for (let el: Element | null = hit; el && el !== document.body; el = el.parentElement) {
      if (structural(el)) break
      if (floating(el) || protectedNode(el)) { roots.add(el); break }
    }
  }
  // Keep the semantic content, not its wrapper, mask or a text descendant.
  const panels = [...roots].filter(el => ![...roots].some(other => other !== el && el.contains(other)))
  const results: Array<CourseLayer & { rank: number }> = []
  for (const root of panels) {
    if (!visible(root,root.matches(exitingMask)) || ignored(root)) continue
    const value = text(root), compact = value.replace(/\s+/g, '')
    const bounds = root.getBoundingClientRect()
    const wrapper = root.closest('.el-dialog__wrapper,.ant-modal-wrap,.dialog') ?? root
    let kind: LayerKind = 'unknown'
    if (protectedNode(root) || root.querySelector(protectedCss)) kind = 'protected'
    else if (/弹题|测验|答题/.test(root.getAttribute('aria-label') ?? '') || root.closest('.topic-item,.topic-option-item') || root.querySelector('.topic-item,.topic-option-item')) kind = 'quiz'
    else if (/学习进度.*(?:提交|保存|同步)失败/.test(compact) || /(?:网络连接|连接服务器).*(?:失败|异常|问题)/.test(compact) && /重新进入|刷新|重新加载|返回学堂/.test(compact)) kind = 'progress-error'
    else if (root.matches('.dialog-read')) kind = 'preschool'
    else if (root.closest('.dialog-warn') && /课程提醒/.test(value)) kind = 'reminder'
    else if (root.matches('.ai-draggable-dialog')) kind = 'assistant'
    else if (root.matches('.ai-helper-agreement-Dialog')) kind = 'notice'
    else if (bounds.width >= 120 && bounds.height >= 60 && bounds.width * bounds.height <= innerWidth * innerHeight * .8 &&
      (/欢迎(?:你)?加入课程|当前时间计划学习进度|班级平均学习进度/.test(compact) || ['课程学习时间', '考试时间', '考核比'].filter(k => compact.includes(k)).length >= 2 || root.matches('.ss2077-msg-custom') && compact.includes('学习进度'))) kind = 'info'
    // Ordinary page copy or the permanent recommendation banner is not a modal.
    if (kind === 'unknown' && (!floating(root) || root.matches('.exploreTip'))) continue
    if (kind === 'unknown' && root.querySelector('input,textarea,select,iframe')) kind = 'protected'
    let actionable = false
    for (const [px, py] of [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]]) {
      const x = bounds.left + bounds.width * px, y = bounds.top + bounds.height * py
      const top = document.elementFromPoint(x,y)
      if (top && (top === root || root.contains(top))) actionable = true
    }
    const blocking = !!hit && (root.contains(hit) || wrapper.contains(hit)) || root.matches('[role="dialog"],[aria-modal="true"],.dialog-read') || root.closest('.el-dialog__wrapper') !== null || bounds.width * bounds.height > innerWidth * innerHeight * .8
    const state = window as unknown as { __acLayerIds?: WeakMap<Element,string>; __acLayerSerial?: number }
    state.__acLayerIds ??= new WeakMap()
    let id = state.__acLayerIds.get(root)
    if (!id) { id = `layer-${Date.now()}-${state.__acLayerSerial = (state.__acLayerSerial ?? 0) + 1}`; state.__acLayerIds.set(root,id) }
    root.setAttribute('data-ac-layer', id)
    let close: Element | undefined
    if (kind !== 'protected' && kind !== 'quiz') {
      const controls = Array.from(root.querySelectorAll('button,[role="button"],a,i,svg,span,div,[aria-label],[title]'))
      if(kind==='assistant')root.closest('.ai-helper-sections')?.querySelectorAll('.not-expand-icon,.ai-close-icon').forEach(el=>controls.push(el))
      close = controls.filter(el => {
        if (!visible(el) || el.matches('input,textarea,select') || el.closest(protectedCss)) return false
        const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.trim()
        const t = text(el), cls = el.getAttribute('class') ?? ''
        if (kind === 'reminder') return el.matches('.talk-later-btn') && t === '下次再说'
        if (kind === 'assistant') return /close|collapse|not-expand/i.test(cls) || /^(?:收起|关闭)$/.test(t)
        const explicit = /^(?:关闭|close)$/i.test(label) || /^(?:知道了|我知道了|关闭|好的|×|✕|✖|x|X)$/.test(t) || !t && /close|guanbi/i.test(cls)
        // Geometry fallback is restricted to identified passive cards, not unknown actions.
        const r = el.getBoundingClientRect()
        const corner = kind === 'info' && r.width <= 64 && r.height <= 64 && r.left >= bounds.left + bounds.width * .65 && r.top <= bounds.top + Math.min(80,bounds.height*.25) && getComputedStyle(el).cursor === 'pointer' && t.length <= 1
        return explicit || corner
      }).sort((a,b) => a.contains(b) ? -1 : b.contains(a) ? 1 : 0)[0]
      close?.setAttribute('data-ac-layer-close',id)
    }
    let rank = Number(getComputedStyle(wrapper).zIndex) || Number(getComputedStyle(root).zIndex) || 0
    for (let n = wrapper.parentElement; n; n = n.parentElement) rank = Math.max(rank, Number(getComputedStyle(n).zIndex) || 0)
    results.push({id,kind,description:`${root.tagName.toLowerCase()}${root.id ? `#${root.id}` : ''} ${value.slice(0,500)}`,closeId:close?id:null,actionable,blocking,exiting:kind === 'unknown' && root.matches(exitingMask),rank})
  }
  return results.sort((a,b) => Number(b.actionable)-Number(a.actionable) || b.rank-a.rank).map(({rank:_,...layer})=>layer)
}

export class CourseOverlays {
  private serial = 0
  constructor(private readonly page: Page, private readonly log: Logger) {}
  async scan(target?: Locator): Promise<CourseLayer[]> {
    const id = target ? `target-${Date.now()}-${this.serial++}` : null
    if (target) await target.evaluate((el,id)=>el.setAttribute('data-ac-target',id!),id)
    try { return await this.page.evaluate(inspectCourseLayers,id) }
    finally { if(target) await target.evaluate(el=>el.removeAttribute('data-ac-target')).catch(()=>{}) }
  }
  root(layer: CourseLayer): Locator { return this.page.locator(`[data-ac-layer="${layer.id}"]`) }
  async waitForExit(layer: CourseLayer): Promise<boolean> {
    try {
      await this.page.waitForFunction(id => {
        const el = document.querySelector(`[data-ac-layer="${id}"]`)
        if (!el) return true
        const r = el.getBoundingClientRect(), style = getComputedStyle(el)
        if (!r.width || !r.height || style.display === 'none' || /hidden|collapse/.test(style.visibility)) return true
        // Opacity zero alone is insufficient: a transparent mask can still intercept clicks.
        return [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]].every(([px,py]) => {
          const top = document.elementFromPoint(r.left+r.width*px, r.top+r.height*py)
          return !top || top !== el && !el.contains(top)
        })
      }, layer.id, {timeout:1500,polling:50})
      return true
    } catch { return false }
  }
  async close(layer: CourseLayer, shouldStop: ()=>boolean = ()=>false): Promise<boolean> {
    if (!layer.closeId) return false
    for(let attempt=0;attempt<2&&!shouldStop();attempt++) {
      if (!await this.root(layer).isVisible()) return true
      try { await this.page.locator(`[data-ac-layer-close="${layer.closeId}"]`).click({timeout:700}) } catch { /* verify, then retry */ }
      await this.root(layer).waitFor({state:'hidden',timeout:1000}).catch(()=>{})
      if (!await this.root(layer).isVisible()) { this.log.info(`已关闭课程浮层（${layer.kind}）`);return true }
    }
    return false
  }
  // Compatibility helpers for direct navigator/DOM tests. Production uses the coordinator.
  async dismiss(): Promise<number> {
    let count=0
    for(let round=0;round<10;round++) {
      const layer=(await this.scan()).find(l=>l.actionable&&['info','preschool','reminder','assistant','notice'].includes(l.kind))
      if(!layer||!await this.close(layer))break
      count++
    }
    return count
  }
  async inspect(target?: Locator): Promise<{description:string;signature:string;reloadRequired:boolean;closeId:string|null}|null> {
    const layer=(await this.scan(target)).find(l=>l.actionable&&(l.kind==='progress-error'||!!target&&l.blocking))
    return layer?{description:layer.description,signature:layer.id,reloadRequired:layer.kind==='progress-error',closeId:layer.closeId}:null
  }
  async closeBlocker(id:string):Promise<boolean>{ const layer=(await this.scan()).find(l=>l.id===id);return !!layer&&this.close(layer) }
  async obstruction(target:Locator):Promise<string|null>{
    return target.evaluate(el=>{
      const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
      if(r.width<=0||r.height<=0||x<0||y<0||x>=innerWidth||y>=innerHeight)return null
      const hit=document.elementFromPoint(x,y)
      if(!hit||el.contains(hit)||hit.closest('.video-topic'))return null
      // Do not record content or classes of unrelated page elements.
      return `${hit.tagName.toLowerCase()}${hit.id?`#${hit.id}`:''} 遮挡操作目标`
    })
  }
}
