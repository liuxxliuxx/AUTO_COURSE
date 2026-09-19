import type { Locator, Page } from 'playwright-core'

export interface MasteryPoint {
  name: string
  rate: number | null
  status: string
}

export function parseMasteryRateText(text: string): number | null {
  const match = text.match(/(\d{1,3})\s*%/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

/** Reads the lazy-loaded mastery list without relying on Vue internals. */
export async function readMasteryPoints(page: Page): Promise<MasteryPoint[]> {
  return page.locator('div.mastery-content li.item-box').evaluateAll((nodes) => nodes.map((node) => {
    const name = (node.querySelector('div.item-box-name')?.textContent ?? '').trim()
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    const status = (node.getAttribute('class') ?? '').replace(/\s+/g, ' ').trim()
    const rateText = [
      text,
      ...Array.from(node.querySelectorAll('span.item-box-rate, div.item-box-rate, span[class*="rate"], div[class*="rate"], span[class*="percent"], div[class*="percent"]')).map((el) => el.textContent ?? '')
    ].join(' ')
    const match = rateText.match(/(\d{1,3})\s*%/)
    const rate = match ? Math.max(0, Math.min(100, Number(match[1]))) : null
    return { name, rate, status }
  })).catch(() => [])
}

export async function scrollMasteryPanel(page: Page): Promise<void> {
  const panel = page.locator('div.el-scrollbar__wrap').first()
  if (await panel.count() === 0) return
  let previous = -1
  for (let i = 0; i < 20; i += 1) {
    const height = await panel.evaluate((el) => {
      const node = el as HTMLElement
      node.scrollTop = node.scrollHeight
      return node.scrollHeight
    }).catch(() => 0)
    if (height === previous) break
    previous = height
    await page.waitForTimeout(250)
  }
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false)
}

/** Hover a point and click the matching popover button. */
export async function clickImproveMastery(page: Page, name: string): Promise<boolean> {
  const names = page.locator('div.mastery-content li.item-box div.item-box-name')
  const count = await names.count().catch(() => 0)
  for (let i = 0; i < count; i += 1) {
    const item = names.nth(i)
    if ((await item.textContent().catch(() => ''))?.trim() !== name) continue
    await item.scrollIntoViewIfNeeded().catch(() => undefined)
    await item.hover().catch(() => undefined)
    await page.waitForTimeout(200)
    const popovers = page.locator('div.mastery-box-custom-popover')
    const popCount = await popovers.count().catch(() => 0)
    for (let j = 0; j < popCount; j += 1) {
      const pop = popovers.nth(j)
      if (!(await visible(pop))) continue
      if ((await pop.locator('strong.name').textContent().catch(() => ''))?.trim() !== name) continue
      const button = pop.locator('button.el-button--primary.btn').first()
      if (await visible(button)) {
        await button.click().catch(() => undefined)
        return true
      }
    }
  }
  return false
}

export async function readMasteryRate(page: Page, name: string): Promise<number | null> {
  const names = page.locator('div.mastery-content li.item-box div.item-box-name')
  const count = await names.count().catch(() => 0)
  for (let i = 0; i < count; i += 1) {
    const item = names.nth(i)
    if ((await item.textContent().catch(() => ''))?.trim() !== name) continue
    await item.scrollIntoViewIfNeeded().catch(() => undefined)
    await item.hover().catch(() => undefined)
    await page.waitForTimeout(120)
    const popovers = page.locator('div.mastery-box-custom-popover')
    for (let j = 0; j < await popovers.count().catch(() => 0); j += 1) {
      const pop = popovers.nth(j)
      if (!(await visible(pop))) continue
      if ((await pop.locator('strong.name').textContent().catch(() => ''))?.trim() !== name) continue
      return parseMasteryRateText((await pop.locator('div.text').textContent().catch(() => '')) ?? '')
    }
  }
  return null
}
