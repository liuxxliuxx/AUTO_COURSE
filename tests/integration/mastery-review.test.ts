import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MasteryCourseRunner } from '../../src/main/automation/mastery/mastery-course-runner'
let browser: Browser, page: Page
beforeAll(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage() })
afterAll(async () => { await browser?.close() })
const runner = new MasteryCourseRunner() as unknown as {
  readAnalysis(page: Page): Promise<{ wrong: string[]; correct: Array<{content: string;correctIndices:number[]}> }>
  selectOptions(page: Page, index: number, type: string, selected: number[]): Promise<void>
}
const question = (result: string) => `<div class="exam-item"><p class="option-name">测试题干</p><div class="quest-type">单选题</div><label class="el-radio is-checked">A.甲</label><label class="el-radio">B.乙</label>${result}</div>`
describe('掌握度解析结果', () => {
  it('已勾选但没有判分结果不能存为正确答案', async () => {
    await page.setContent(`<div class="exam-preview">${question('')}</div>`)
    expect(await runner.readAnalysis(page)).toEqual({ wrong: [], correct: [] })
  })
  it('错题的勾选项不能当作正确答案，正确判分才能入库', async () => {
    await page.setContent(`<div class="exam-preview">${question('<div class="question-result error">回答错误</div>')}</div>`)
    expect(await runner.readAnalysis(page)).toEqual({ wrong: ['测试题干'], correct: [] })
    await page.locator('.question-result').evaluate(el => el.classList.remove('error'))
    expect((await runner.readAnalysis(page)).correct[0]).toMatchObject({ content: '测试题干', correctIndices: [0] })
  })
  it('重答多选会清除旧选择且不反向取消已经选好的答案', async () => {
    await page.setContent(`<div class="exam-item"><label class="el-checkbox is-checked">甲</label><label class="el-checkbox is-checked">乙</label><label class="el-checkbox">丙</label></div><script>document.querySelectorAll('label').forEach(el=>el.onclick=()=>el.classList.toggle('is-checked'))</script>`)
    await runner.selectOptions(page, 0, 'multi', [1, 2])
    expect(await page.locator('.is-checked').allTextContents()).toEqual(['乙', '丙'])
  })
})
