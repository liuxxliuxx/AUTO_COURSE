import { WorkflowService } from '../../src/main/workflows/workflow-service'
import type { WorkflowInput, WorkflowRun } from '../../src/shared/workflows'
/** Built Vue UI with real course persistence and an isolated desktop IPC boundary. */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { startFixtureServer, type FixtureServer } from '../../scripts/poc/fixture-server.mjs'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { CourseService } from '../../src/main/services/course-service'
import type { CourseInput, CourseRunOptions, BotStatus, SchedulerConfig, SettingsPatch, LogEntry } from '../../src/shared/types'
let browser: Browser, server: FixtureServer, context: BrowserContext, page: Page, db: Database
let courses: CourseService, settings: SettingsService, starts: number, failSave: boolean, state: BotStatus
let pageErrors: string[]
let fixtureLogs: LogEntry[]
let workflows: WorkflowService
let runFixtures: WorkflowRun[] | null
let lastFlowId: string
const shots = '/private/tmp/auto-course-ui'
beforeAll(async () => { server = await startFixtureServer(resolve('out/renderer')); browser = await chromium.launch({ headless: true }); mkdirSync(shots, { recursive: true }) })
afterAll(async () => { await browser?.close(); await server?.close() })
beforeEach(async () => {
  db = new Database(':memory:'); settings = new SettingsService(db)
  starts = 0; failSave = false; fixtureLogs = []; runFixtures = null
  state = { state: 'idle', mode: null, currentTitle: null, completedCount: 0, watchedSeconds: 0, stoppedReason: null, message: '准备好后开始一门课程', tone: 'neutral' }
  courses = new CourseService(db, settings, () => state.state !== 'idle' ? state.courseId ?? null : null)
  workflows = new WorkflowService(db,courses,()=>state.state!=='idle'); lastFlowId=''
  context = await browser.newContext({ viewport: { width: 1180, height: 780 } }); page = await context.newPage()
  pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message))
  let config: SchedulerConfig = { enabled: false, courseId: null, startTime: '06:00', endTime: '23:00', allDay: false, dailyLimitMinutes: 0 }
  await page.exposeFunction('_invoke', async (name: string, args: unknown[]) => {
    let result: unknown
    switch (name) {
      case 'workflows.list': return workflows.list()
      case 'workflows.get': return workflows.get(args[0] as string)
      case 'workflows.create': if(failSave)throw Error('fixture 保存失败');return workflows.create(args[0] as WorkflowInput)
      case 'workflows.update': if(failSave)throw Error('fixture 保存失败');return workflows.update(args[0] as string,args[1] as number,args[2] as WorkflowInput)
      case 'workflows.remove': return workflows.remove(args[0] as string)
      case 'workflows.logs': return fixtureLogs.map(l=>({...l,workflowId:lastFlowId,runId:'fixture-run',stepId:'fixture-step'}))
      case 'workflows.confirm': return
      case 'workflows.stop': state={...state,state:'idle',stoppedReason:'user'};return
      case 'workflows.runs': {
        if (runFixtures) return runFixtures
        if(!state.snapshot)return []
        const course=state.snapshot.course
        const flow=workflows.get(lastFlowId)??{id:'fixture-flow',version:1,name:course.name,steps:[{id:'fixture-step',courseId:course.id,options:course.options}],schedule:null,notice:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
        return [{id:'fixture-run',workflowId:flow.id,source:'manual',state:state.state==='idle'?(state.error?'failed':'cancelled'):state.state==='stopping'?'stopping':'running',snapshot:{workflow:flow,steps:flow.steps.map(s=>({...s,course:courses.get(s.courseId)!})),settings:settings.getAll()},startedAt:new Date().toISOString(),finishedAt:null,message:state.error?.message??'',steps:flow.steps.map(s=>({stepId:s.id,state:state.state==='idle'?'failed':'running',status:state,transcription:null,error:state.error?.message??null,startedAt:null,finishedAt:null}))}] satisfies WorkflowRun[]
      }
      case 'workflows.start': {
        const flow=workflows.get(args[0] as string);lastFlowId=flow?.id??''
        const course=flow?courses.get(flow.steps[0].courseId)!:state.snapshot!.course
        starts++;state={...state,state:'running',phase:'executing',courseId:course.id,error:null,snapshot:{id:'fixture-run',course,settings:settings.getAll(),startedAt:new Date().toISOString(),source:'manual'}}
        return {ok:true,runId:'fixture-run'}
      }
      case 'courses.list': return courses.list()
      case 'courses.create': if (failSave) throw new Error('fixture 保存失败'); result = courses.create(args[0] as CourseInput); break
      case 'courses.update': result = courses.update(args[0] as string, args[1] as CourseInput); break
      case 'courses.remove': result = courses.remove(args[0] as string); break
      case 'courses.select': result = courses.select(args[0] as string); break
      case 'courses.defaults': result = courses.defaults(args[0] as CourseRunOptions); break
      case 'settings.getAll': return settings.getAll()
      case 'settings.update': if (failSave) throw new Error('fixture 设置保存失败'); return settings.update(args[0] as SettingsPatch)
      case 'credentials.get': return { username: 'fixture-user', hasPassword: true }
      case 'credentials.state': case 'credentials.set': return { hasUsername: true, hasPassword: true, encryptionAvailable: true }
      case 'scheduler.get': return { config, inRange: true, targetReached: false, nextTickAt: 0 }
      case 'scheduler.update': config = { ...config, ...args[0] as Partial<SchedulerConfig> }; return { config, inRange: true, targetReached: false, nextTickAt: 0 }
      case 'bot.status': return state
      case 'bot.start': {
        const course = courses.get((args[0] as { courseId: string }).courseId)!
        starts += 1; state = { ...state, state: 'running', phase: 'executing', courseId: course.id,
          snapshot: { id: 'fixture-run', course, settings: settings.getAll(), startedAt: new Date().toISOString(), source: 'manual' } }
        return { ok: true }
      }
      case 'bot.stop': state = { ...state, state: 'idle' }; return
      case 'progress.get': return { today: { date: '2026-09-16', watchedSeconds: 0 }, sessionSeconds: 0, targetMinutes: 0 }
      case 'logs.recent': return fixtureLogs
      case 'transcription.get': return { phase: 'idle', title: null, completed: 0, failed: 0, message: '转录未启用', tone: 'neutral', percent: null }
      case 'app.version': return { version: '2.0.0', platform: 'darwin' }
      default: return null
    }
    return result
  })
  await page.addInitScript(() => {
    type Bridge = { _invoke(name: string, args: unknown[]): Promise<unknown> }
    Object.defineProperty(window, 'appApi', { value: new Proxy({}, { get: (_target, domain: string) => {
      if (domain === 'events') return new Proxy({}, { get: () => () => () => {} })
      return new Proxy({}, { get: (_object, method: string) => (...args: unknown[]) => (window as unknown as Bridge)._invoke(`${domain}.${method}`, args) })
    } }) })
  })
  await page.goto(server.origin + '/index.html')
  await page.getByRole('heading', { name: '我的课程', exact: true }).waitFor()
})
afterEach(async () => { await context?.close(); db?.close(); expect(pageErrors).toEqual([]) })
async function add(name: string, key: string, action = 'learn'): Promise<void> {
  await page.getByRole('button', { name: '添加课程', exact: true }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('课程地址', { exact: false }).fill(`https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${key}`)
  await form.getByLabel('课程名称', { exact: true }).fill(name)
  await form.getByLabel('运行方式', { exact: true }).selectOption(action)
  await form.getByRole('button', { name: '保存课程', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
}
describe('课程与运行界面', () => {
  it('空状态、添加两门不同配置、切换与刷新后配置保持独立，保存不启动', async () => {
    expect(await page.getByText('从第一门课程开始').isVisible()).toBe(true)
    await page.screenshot({ path: `${shots}/empty.png`, fullPage: true })
    await add('艺术与审美', 'a', 'learn-transcribe'); await add('高等数学', 'b')
    expect(starts).toBe(0)
    await page.getByRole('button', { name: /艺术与审美 传统课/ }).click()
    expect(await page.getByRole('region', { name: '课程详情' }).getByText('学习并转录', { exact: true }).isVisible()).toBe(true)
    await page.getByRole('button', { name: '设为本次课程', exact: true }).click()
    await page.reload(); await page.getByRole('heading', { name: '艺术与审美', exact: true }).waitFor()
    expect(courses.list().courses).toHaveLength(2)
    await page.screenshot({ path: `${shots}/courses.png`, fullPage: true })
    await page.getByRole('button', { name: '构建工作流', exact: true }).click()
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    expect(starts).toBe(0)
    await page.getByRole('button', { name: '立即运行', exact: true }).click()
    await page.getByRole('heading', { name: '运行', exact: true }).waitFor(); expect(starts).toBe(1)
    await page.screenshot({ path: `${shots}/run.png`, fullPage: true })
    await page.getByRole('link', { name: '课程', exact: true }).click()
    expect(await page.getByRole('button', { name: '编辑', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: /高等数学 传统课/ }).click()
    expect(await page.getByRole('button', { name: '编辑', exact: true }).isEnabled()).toBe(true)
  })
  it('重复地址可打开已有课程，取消编辑不覆盖原课程，保存失败保留输入', async () => {
    await add('课程 A', 'a')
    await page.getByRole('button', { name: '添加课程', exact: true }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('课程地址', { exact: false }).fill('https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=a')
    await form.getByLabel('课程名称', { exact: true }).fill('重复课程')
    await form.getByRole('button', { name: '保存课程', exact: true }).click()
    await form.getByRole('button', { name: '打开已有课程', exact: true }).click()
    expect(courses.list().courses).toHaveLength(1)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await form.getByLabel('课程名称', { exact: true }).fill('不保存的名称')
    page.once('dialog', dialog => dialog.accept()); await form.getByRole('button', { name: '取消', exact: true }).click()
    expect(courses.list().courses[0].name).toBe('课程 A')
    await page.getByRole('button', { name: '添加课程', exact: true }).click()
    await form.getByLabel('课程地址', { exact: false }).fill('https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=b')
    await form.getByLabel('课程名称', { exact: true }).fill('输入应保留')
    failSave = true; await form.getByRole('button', { name: '保存课程', exact: true }).click()
    await form.getByRole('alert').waitFor(); expect(await form.getByLabel('课程名称', { exact: true }).inputValue()).toBe('输入应保留')
    await page.screenshot({ path: `${shots}/save-error.png`, fullPage: true })
    failSave = false; await form.getByRole('button', { name: '保存课程', exact: true }).click(); await form.waitFor({ state: 'hidden' })
  })
  it('账号密码不回填、默认设置不改变现有课程、定时入口迁移到工作流', async () => {
    await add('课程 A', 'a'); await add('课程 B', 'b')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByText('留空保留已保存的密码', { exact: false }).count() // placeholder assertion below
    await page.getByPlaceholder('留空保留已保存的密码').waitFor()
    expect(await page.getByPlaceholder('留空保留已保存的密码').inputValue()).toBe('')
    await page.screenshot({ path: `${shots}/settings.png`, fullPage: true })
    await page.getByRole('button', { name: '课程默认配置', exact: true }).click()
    await page.getByLabel('运行方式', { exact: true }).selectOption('transcribe')
    await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByRole('status').waitFor()
    expect(courses.list().courses.every(c => c.options.action === 'learn')).toBe(true)
    expect(courses.list().defaults.action).toBe('transcribe')
    expect(await page.getByRole('button', { name: '自动调度', exact:true }).count()).toBe(0)
    expect(await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).count()).toBe(1)
  })
  it('键盘焦点限制在表单，长名称和窄窗口没有水平溢出', async () => {
    await add('这是一门名称较长的课程，用于检查缩放后的布局与文字换行', 'long')
    await page.setViewportSize({ width: 740, height: 570 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByLabel('课程地址', { exact: false }).focus(); await page.keyboard.press('Shift+Tab')
    expect(await page.getByRole('dialog').getByRole('button', { name: '保存课程', exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.screenshot({ path: `${shots}/compact-form.png`, fullPage: true })
    await page.keyboard.press('Escape'); expect(await page.getByRole('dialog').count()).toBe(0)
  })
})


describe('紧凑工作区布局', () => {
  it('多课程、长地址和长日志在窗口尺寸及缩放变化后仍可操作', async () => {
    for (let i = 0; i < 20; i++) courses.create({
      name: i === 0 ? '长课程名称用于验证详情换行与列表省略'.repeat(5) : `测试课程 ${i}`,
      url: `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=density-${i}&extra=${'x'.repeat(160)}`,
      options: courses.list().defaults
    })
    fixtureLogs = Array.from({ length: 150 }, (_, i) => ({ time: Date.now() + i, level: i % 3 === 0 ? 'warning' : 'info', message: `事件 ${i}：${'长日志内容'.repeat(30)}` }))
    await page.reload()
    await page.getByRole('heading', { name: '我的课程', exact: true }).waitFor()
    const visibleRows = await page.locator('.course-row').evaluateAll(rows => rows.filter(row => {
      const r = row.getBoundingClientRect(), container = row.parentElement!.getBoundingClientRect()
      return r.top >= container.top && r.bottom <= container.bottom
    }).length)
    expect(visibleRows).toBeGreaterThanOrEqual(10)
    await page.getByRole('button', { name: /长课程名称/ }).click()
    await page.getByRole('button', { name: '设为本次课程', exact: true }).click()
    for (const size of [{ width: 1180, height: 780 }, { width: 960, height: 640 }, { width: 740, height: 570 }]) {
      for (const scale of [1, 1.3]) {
        // Electron zoom reduces CSS viewport dimensions; emulate that effective viewport in Chromium.
        await page.setViewportSize({ width: Math.floor(size.width / scale), height: Math.floor(size.height / scale) })
        const label = `${size.width}-${size.height}-${scale}`
        for (const route of ['课程', '运行', '设置']) {
          await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: route, exact: true }).click()
          if (route === '设置') await page.getByLabel('账号', { exact: true }).waitFor()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          expect(await page.locator('.page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
          if (route === '课程') {
            expect(await page.locator('.course-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
            expect(await page.locator('.course-detail').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
            await page.getByRole('button', { name: '编辑', exact: true }).click()
            const save = page.getByRole('button', { name: '保存课程', exact: true })
            await save.scrollIntoViewIfNeeded()
            expect(await save.isVisible()).toBe(true)
            await page.screenshot({ path: `${shots}/dialog-${label}.png` })
            await page.keyboard.press('Escape')
          }
          if (route === '运行') {
            expect(await page.getByText('还没有运行记录').isVisible()).toBe(true)
          }
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          await page.screenshot({ path: `${shots}/${route}-${label}.png` })
        }
      }
    }
  })
})


describe('紧凑界面操作与提示', () => {
  it('编辑保存和移除仍使用原有课程操作', async () => {
    await add('待编辑课程', 'edit-remove')
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByLabel('课程名称', { exact: true }).fill('已编辑课程')
    await page.getByRole('button', { name: '保存课程', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    expect(courses.list().courses[0].name).toBe('已编辑课程')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: '移除', exact: true }).click()
    await page.getByRole('heading', { name: '从第一门课程开始' }).waitFor()
    expect(courses.list().courses).toHaveLength(0)
  })

  it('人工处理、失败重试和停止中的操作在小窗口仍可达', async () => {
    await add('提示测试课程', 'notices')
    const course = courses.list().courses[0]
    fixtureLogs = Array.from({ length: 100 }, () => ({ time: Date.now(), level: 'info', message: '等待用户处理' }))
    await page.setViewportSize({ width: 740, height: 570 })
    state = { ...state, state: 'running', phase: 'waiting', courseId: course.id,
      snapshot: { id: 'notice-run', course, settings: settings.getAll(), startedAt: new Date().toISOString(), source: 'manual' } }
    for (const kind of ['captcha', 'manual-login'] as const) {
      state.intervention = { id:'request-id', kind, message: '请在课程窗口完成操作，再返回继续运行。', scene: 'login', at: Date.now() }
      await page.reload()
      const confirm = page.getByRole('button', { name: '已完成，继续' })
      await confirm.click()
      expect(await confirm.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })).toBe(true)
      await page.screenshot({ path: `${shots}/${kind}.png` })
    }
    state = { ...state, state: 'stopping', phase: 'stopping', intervention: null }
    await page.reload()
    const stop = page.getByRole('button', { name: '停止工作流', exact: true })
    await stop.waitFor()
    expect(await stop.isDisabled()).toBe(true)
    state = { ...state, state: 'idle', phase: 'finished', error: { stage: 'executing', code: 'execution', message: '测试执行失败' } }
    await page.reload()
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '运行', exact: true }).click()
    await page.getByRole('button', { name: '重新运行', exact: true }).click()
    expect(starts).toBe(1)
  })
})


describe('外观强调色', () => {
  it('预览、取消、保存失败、全局应用和刷新恢复', async () => {
    const hue = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent-hue'))
    expect(await hue()).toBe('218')
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '外观', exact: true }).click()
    await page.getByRole('radio', { name: '紫色', exact: true }).check()
    expect(await hue()).toBe('218')
    await page.getByRole('button', { name: '取消修改', exact: true }).click()
    await page.getByRole('radio', { name: '蓝色（默认）', exact: true }).waitFor()
    expect(await page.getByRole('radio', { name: '蓝色（默认）', exact: true }).isChecked()).toBe(true)
    await page.screenshot({ path: `${shots}/appearance-blue.png` })
    await page.getByRole('radio', { name: '青绿', exact: true }).check()
    failSave = true
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByRole('alert').waitFor()
    expect(await hue()).toBe('218')
    expect(settings.getAll().accentColor).toBe('blue')
    expect(await page.getByRole('radio', { name: '青绿', exact: true }).isChecked()).toBe(true)
    failSave = false
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('设置已保存', { exact: true }).waitFor()
    expect(await hue()).toBe('166')
    expect(settings.getAll().accentColor).toBe('teal')
    await page.reload()
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
    expect(await hue()).toBe('166')
    await page.getByRole('button', { name: '外观', exact: true }).click()
    expect(await page.getByRole('radio', { name: '青绿', exact: true }).isChecked()).toBe(true)
    await page.setViewportSize({ width: 569, height: 438 })
    await page.getByRole('radio', { name: '橙色', exact: true }).check()
    expect(await page.locator('.page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `${shots}/appearance-narrow.png` })
  })
})

describe('工作流编辑与持久化',()=>{
  it('添加与排序步骤、独立配置、定时、失败保留输入、取消编辑及重启恢复',async()=>{
    await add('课程 A','flow-a');await add('课程 B','flow-b')
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'创建工作流',exact:true}).click()
    await page.getByLabel('工作流名称',{exact:true}).fill('每日两门课')
    const a=courses.list().courses.find(c=>c.name==='课程 A')!,b=courses.list().courses.find(c=>c.name==='课程 B')!
    for(const c of [a,b]){await page.getByLabel('选择步骤课程').selectOption(c.id);await page.getByRole('button',{name:'添加步骤',exact:true}).click()}
    await page.locator('.step').first().getByLabel('单次时长',{exact:true}).selectOption('limited')
    await page.locator('.step').first().getByLabel('分钟数',{exact:true}).fill('7')
    await page.getByRole('button',{name:'上移步骤 2',exact:true}).click()
    await page.getByLabel('触发方式',{exact:true}).selectOption('daily')
    await page.getByLabel('每日开始时间',{exact:true}).fill('15:35')
    failSave=true;await page.getByRole('button',{name:'保存工作流',exact:true}).click();await page.getByRole('alert').waitFor()
    expect(await page.getByLabel('工作流名称').inputValue()).toBe('每日两门课')
    failSave=false;await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor();expect(starts).toBe(0)
    const flow=workflows.list()[0];expect(flow.steps.map(s=>s.courseId)).toEqual([b.id,a.id]);expect(flow.steps[1].options.timeLimitMinutes).toBe(7);expect(a.options.timeLimitMinutes).toBe(0)
    expect(flow.schedule).toMatchObject({kind:'daily',enabled:true,time:'15:35'})
    await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('工作流名称').fill('不保存')
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消',exact:true}).click();expect(workflows.list()[0].name).toBe('每日两门课')
    await page.reload();await page.getByRole('heading',{name:'每日两门课',exact:true}).waitFor()
    await page.setViewportSize({width:740,height:570});await page.screenshot({path:`${shots}/workflow.png`,fullPage:true})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  })
})


describe('运行记录显示', () => {
  it('空页接收运行记录后显示详情，切换运行 ID 同步详情，步骤按 ID 匹配', async () => {
    await add('显示测试课程', 'display')
    const course = courses.list().courses[0]
    const flow = workflows.create({ name: '显示测试工作流', steps: [{ id: 's1', courseId: course.id, options: course.options }, { id: 's2', courseId: course.id, options: course.options }], schedule: null })
    const makeRun = (id: string, name: string): WorkflowRun => ({
      id, workflowId: flow.id, source: 'manual', state: 'running', startedAt: '2026-09-19T01:00:00Z', finishedAt: null, message: '',
      snapshot: { workflow: { ...flow, name }, steps: flow.steps.map(s => ({ ...s, course })), settings: settings.getAll() },
      steps: [...flow.steps].reverse().map(s => ({ stepId: s.id, state: s.id === 's1' ? 'succeeded' : 'running', status: null, error: null, transcription: null, startedAt: null, finishedAt: null }))
    })
    await page.getByRole('navigation').getByRole('link', { name: '运行', exact: true }).click()
    await page.getByText('还没有运行记录').waitFor()
    runFixtures = [makeRun('one', '工作流一'), makeRun('two', '工作流二')]
    await page.getByRole('heading', { name: /工作流[一二]/ }).waitFor()
    await page.evaluate(() => { location.hash = '/run?id=one' })
    await page.getByRole('heading', { name: '工作流一', exact: true }).waitFor()
    expect(await page.locator('.step').first().innerText()).toContain('成功')
    expect(await page.locator('.step').nth(1).innerText()).toContain('执行中')
    expect(await page.locator('.step').first().innerText()).toContain('不限时长')
    await page.evaluate(() => { location.hash = '/run?id=two' })
    await page.getByRole('heading', { name: '工作流二', exact: true }).waitFor()
    await page.setViewportSize({ width: 569, height: 438 })
    expect(await page.locator('.runs-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `${shots}/run-display-fixed.png` })
  })
})
