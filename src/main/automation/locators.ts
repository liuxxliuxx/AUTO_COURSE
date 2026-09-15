/**
 * 定位助手：把 v1「多候选选择器依次尝试」的写法搬到 Playwright。
 *
 * v1 有 `src/utils/element_finder.py` 做这件事；直接换成单个 `page.locator()`
 * 会丢掉容错能力（实测智慧树登录页已经有选择器失效，见 docs/PLAYWRIGHT_POC.md §2.2）。
 */

import type { Frame, FrameLocator, Locator, Page } from 'playwright-core'

/** 可以在其中执行定位的作用域 */
export type Scope = Page | Frame | Locator | FrameLocator

/**
 * 依次尝试每个 CSS 选择器，返回第一个"可见"的 Locator。
 * 每个候选给一个较短的超时，全部失败返回 null。
 */
export async function firstVisible(
  scope: Scope,
  selectors: readonly string[],
  timeoutMs = 2_000
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first()
    try {
      await locator.waitFor({ state: 'visible', timeout: timeoutMs })
      return locator
    } catch {
      // 试下一个候选
    }
  }
  return null
}

/** 依次尝试每个 XPath，返回第一个可见的 Locator。 */
export async function firstVisibleXPath(
  scope: Scope,
  xpaths: readonly string[],
  timeoutMs = 2_000
): Promise<Locator | null> {
  for (const xpath of xpaths) {
    const locator = scope.locator(`xpath=${xpath}`).first()
    try {
      await locator.waitFor({ state: 'visible', timeout: timeoutMs })
      return locator
    } catch {
      // 试下一个候选
    }
  }
  return null
}

/** 元素是否存在且可见（不等待）。 */
export async function isVisible(locator: Locator | null): Promise<boolean> {
  if (!locator) return false
  try {
    return await locator.isVisible()
  } catch {
    return false
  }
}

/**
 * 在预算内轮询「第一个可见的候选」，命中就立刻返回。
 *
 * 与 `firstVisible` 的差别：预算是**整个策略**共享的，而不是每个选择器各等一遍
 * 超时。播放器按钮在暂停/播放之间的显隐会来回切，用 `firstVisible` 时
 * 3 个候选各等 5 秒，用户看到的就是"点了半天没反应"（实测恢复播放要 18 秒）。
 */
export async function firstVisibleWithin(
  scope: Scope,
  selectors: readonly string[],
  budgetMs: number,
  pollMs = 120
): Promise<Locator | null> {
  const deadline = Date.now() + Math.max(0, budgetMs)
  for (;;) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first()
      if (await isVisible(locator)) return locator
    }
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/**
 * 元素中心是否被别的元素盖住 —— 真人点下去会点在那个元素上。
 *
 * 用来提前识别"普通 click 一定会以 element intercepts pointer events 超时"，
 * 直接改走坐标点击；否则每次被遮罩的点击都要白等一个 timeout。
 */
async function isCovered(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false
      const top = document.elementFromPoint(x, y)
      if (!top) return false
      return top !== el && !el.contains(top) && !top.contains(el)
    })
  } catch {
    return false
  }
}

/** 按元素中心坐标点击（`force: true`）：跳过遮挡/稳定性检查，事件仍然可信。 */
async function clickAtCenter(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.click({ force: true, timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

/**
 * 可信点击：先正常点，失败（被遮罩挡住 / 元素不稳定）再退回 `force: true`。
 *
 * **绝对不要退回 `element.click()`。** 那会派发 `isTrusted === false` 的合成
 * 事件，而智慧树学习页在 `#container` 上挂了防脚本守卫：只要收到一个不可信
 * 点击就弹「检测到异常脚本…」、暂停播放，并在 3 秒后
 * `location.replace('https://www.zhihuishu.com')` —— 表现就是刷课刚开始就
 * 跳回学堂首页（详见 docs/MIGRATION.md）。
 *
 * `force: true` 跳过的只是「遮挡 / 可见性 / 稳定性」这些前置检查，点击本身
 * 仍由浏览器输入管线发出，`isTrusted === true`，与真人点击等价。
 *
 * 被遮罩挡住时**不再先等一个 timeout**：直接走坐标点击，省掉每次 3 秒的空转。
 */
export async function safeClick(locator: Locator, timeoutMs = 5_000): Promise<boolean> {
  if (await isCovered(locator)) return clickAtCenter(locator, timeoutMs)

  try {
    await locator.click({ timeout: timeoutMs })
    return true
  } catch {
    return clickAtCenter(locator, timeoutMs)
  }
}

/** 读取文本并去掉首尾空白；失败返回空串。 */
export async function textOf(locator: Locator | null): Promise<string> {
  if (!locator) return ''
  try {
    return ((await locator.textContent()) ?? '').trim()
  } catch {
    return ''
  }
}
