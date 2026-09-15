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

/** 安全点击：元素不可交互时退回 JS click（v1 对登录按钮就是这么做的）。 */
export async function safeClick(locator: Locator, timeoutMs = 5_000): Promise<boolean> {
  try {
    await locator.click({ timeout: timeoutMs })
    return true
  } catch {
    try {
      await locator.evaluate((el) => (el as HTMLElement).click())
      return true
    } catch {
      return false
    }
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
