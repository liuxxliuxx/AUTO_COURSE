import { AccountService } from '../../src/main/services/account-service'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkflowService } from '../../src/main/workflows/workflow-service'
import { MasteryQuestionBank } from '../../src/main/automation/mastery/question-bank'
import { buildCourseQuestionBankExport } from '../../src/main/services/question-bank-export'
import type { WorkflowInput, WorkflowRun } from '../../src/shared/workflows'
/** Built Vue UI with real course persistence and an isolated desktop IPC boundary. */
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
let perRunLogs: Record<string, LogEntry[]> | null
let delayedLogs: Record<string, number>
let fixtureLogs: LogEntry[]
let accounts: AccountService, accountId: string, accountDir: string
let workflows: WorkflowService
let runFixtures: WorkflowRun[] | null
let lastFlowId: string
let cacheClears: number
let cancelExport: boolean
let failFlowListOnce: boolean
let failSettingsLoadOnce:boolean
let actionDelay:number, startRejection:{message:string;runId?:string}|null
const shots = '/private/tmp/auto-course-ui'
beforeAll(async () => { server = await startFixtureServer(resolve('out/renderer')); browser = await chromium.launch({ headless: true }); mkdirSync(shots, { recursive: true }) })
afterAll(async () => { await browser?.close(); await server?.close() })
beforeEach(async () => {
  db = new Database(':memory:'); settings = new SettingsService(db)
  starts = 0; failSave = false; fixtureLogs = []; perRunLogs = null; delayedLogs = {}; runFixtures = null
  cancelExport = false; cacheClears = 0
  failFlowListOnce = false;actionDelay=0;startRejection=null;failSettingsLoadOnce=false
  state = { state: 'idle', mode: null, currentTitle: null, completedCount: 0, watchedSeconds: 0, stoppedReason: null, message: '准备好后开始一门课程', tone: 'neutral' }
  courses = new CourseService(db, settings, () => state.state !== 'idle' ? state.courseId ?? null : null)
  accountDir=mkdtempSync(join(tmpdir(),'ac-ui-'));accounts=new AccountService(db,accountDir)
  accountId=accounts.create({name:'默认账号',username:'fixture-user',password:'secret',loginMethod:'zhihuishu',loggedUrl:''}).id
  workflows = new WorkflowService(db,courses,()=>state.state!=='idle',accounts); lastFlowId=''
  context = await browser.newContext({ viewport: { width: 1180, height: 780 } }); page = await context.newPage()
  pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message))
  let config: SchedulerConfig = { enabled: false, courseId: null, startTime: '06:00', endTime: '23:00', allDay: false, dailyLimitMinutes: 0 }
  await page.exposeFunction('_invoke', async (name: string, args: unknown[]) => {
    let result: unknown
    switch (name) {
      case 'accounts.list': return accounts.list()
      case 'accounts.progress': return accounts.progress(args[0] as string)
      case 'accounts.create': if(failSave)throw Error('fixture 保存失败');return accounts.create(args[0] as import('../../src/shared/accounts').AccountInput)
      case 'accounts.update': if(failSave)throw Error('fixture 保存失败');return accounts.update(args[0] as string,args[1] as import('../../src/shared/accounts').AccountInput)
      case 'accounts.remove': return accounts.remove(args[0] as string)
      case 'app.welcome': return false
      case 'app.dismissWelcome': return

      case 'workflows.list': if (failFlowListOnce) { failFlowListOnce = false; throw Error('fixture 列表刷新失败') }; return workflows.list()
      case 'workflows.get': return workflows.get(args[0] as string)
      case 'workflows.create': if(failSave)throw Error('fixture 保存失败');return workflows.create(args[0] as WorkflowInput)
      case 'workflows.update': if(failSave)throw Error('fixture 保存失败');return workflows.update(args[0] as string,args[1] as number,args[2] as WorkflowInput)
      case 'workflows.remove': return workflows.remove(args[0] as string)
      case 'workflows.logs': {const id=args[0] as string; const data=perRunLogs?.[id]??fixtureLogs;if(delayedLogs[id])await new Promise(resolve=>setTimeout(resolve,delayedLogs[id]));return data.map(l=>({...l,workflowId:lastFlowId,runId:id,stepId:'fixture-step'}))}
      case 'workflows.confirm': return
      case 'workflows.stop': {
        const run=runFixtures?.find(run=>run.id===args[0])
        if(run)run.state='stopping'
        if(actionDelay)await new Promise(resolve=>setTimeout(resolve,actionDelay))
        if(run){run.state='cancelled';for(const step of run.steps)if(step.state==='running'||step.state==='pending')step.state='cancelled'}
        state={...state,state:'idle',stoppedReason:'user'};return
      }
      case 'workflows.runs': {
        if (runFixtures) return runFixtures
        if(!state.snapshot)return []
        const course=state.snapshot.course
        const flow=workflows.get(lastFlowId)??{id:'fixture-flow',version:1,name:course.name,steps:[{id:'fixture-step',accountId, courseId:course.id,options:course.options}],schedule:null,notice:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
        return [{id:'fixture-run',workflowId:flow.id,source:'manual',state:state.state==='idle'?(state.error?'failed':'cancelled'):state.state==='stopping'?'stopping':'running',snapshot:{workflow:flow,steps:flow.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course:courses.get(s.courseId)!})),settings:settings.getAll()},startedAt:new Date().toISOString(),finishedAt:null,message:state.error?.message??'',steps:flow.steps.map(s=>({stepId:s.id,state:state.state==='idle'?'failed':'running',status:state,transcription:null,error:state.error?.message??null,startedAt:null,finishedAt:null}))}] satisfies WorkflowRun[]
      }
      case 'workflows.start': {
        if(startRejection)return {ok:false,...startRejection}
        const flow=workflows.get(args[0] as string);lastFlowId=flow?.id??''
        const course=flow?courses.get(flow.steps[0].courseId)!:state.snapshot!.course
        starts++;state={...state,state:'running',phase:'executing',courseId:course.id,error:null,snapshot:{id:'fixture-run',course,settings:settings.getAll(),startedAt:new Date().toISOString(),source:'manual'}}
        return {ok:true,runId:'fixture-run'}
      }
      case 'courses.list': return courses.list()
      case 'courses.exportQuestionBank': {
        if (failSave) throw new Error('fixture 写入失败')
        const data = buildCourseQuestionBankExport(db, courses, args[0] as string)
        return cancelExport ? { canceled: true, path: '', count: 0 } : { canceled: false, path: '/tmp/题库.json', count: data.questions.length }
      }
      case 'courses.create': if (failSave) throw new Error('fixture 保存失败'); result = courses.create(args[0] as CourseInput); break
      case 'courses.update': result = courses.update(args[0] as string, args[1] as CourseInput); break
      case 'courses.remove': result = courses.remove(args[0] as string); break
      case 'courses.select': result = courses.select(args[0] as string); break
      case 'courses.defaults': result = courses.defaults(args[0] as CourseRunOptions); break
      case 'settings.getAll': if(failSettingsLoadOnce){failSettingsLoadOnce=false;throw Error('fixture 设置读取失败')};return settings.getAll()
      case 'settings.clearCache': cacheClears++; if(actionDelay)await new Promise(resolve=>setTimeout(resolve,actionDelay));if(failSave)throw Error('请先停止所有运行中的任务');return {bytes:2048}
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
      case 'app.version': return { version: '3.0.0', platform: 'darwin' }
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
afterEach(async () => { await context?.close(); db?.close(); if(accountDir)rmSync(accountDir,{recursive:true,force:true}); expect(pageErrors).toEqual([]) })
const choiceLabels: Record<string,string>={learn:'学习','learn-transcribe':'学习并转录',transcribe:'仅转录',limited:'指定分钟',unlimited:'不限时长',none:'仅手动',daily:'每日定时',once:'单次定时',beginning:'课程开头',resume:'上次位置',info:'信息',warning:'警告',error:'错误',debug:'调试','':'全部'}
async function choose(scope:Page|Locator,label:string,value:string):Promise<void>{await scope.getByRole('radiogroup',{name:label,exact:true}).getByRole('radio',{name:choiceLabels[value],exact:true}).click()}
async function add(name: string, key: string, action = 'learn'): Promise<void> {
  await page.getByRole('button', { name: '添加课程', exact: true }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('课程地址', { exact: false }).fill(`https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${key}`)
  await form.getByLabel('课程名称', { exact: true }).fill(name)
  await choose(form,'运行方式',action)
  await form.getByRole('button', { name: '保存课程', exact: true }).click()
  await form.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.matches('.page-header button'))
}
describe('课程与运行界面', () => {
  it('只有掌握度课程显示导出，空题库/写入失败提示，取消不报成功，成功按课程导出', async () => {
    await add('传统课', 'export-classic')
    expect(await page.getByRole('button', { name: '导出题库', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: '添加课程', exact: true }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('课程地址', { exact: false }).fill('https://studywisdomh5.zhihuishu.com/study/mastery?recruitAndCourseId=export-mastery')
    await form.getByLabel('课程名称', { exact: true }).fill('掌握度导出')
    await form.getByRole('button', { name: '保存课程', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    const button = page.getByRole('button', { name: '导出题库', exact: true })
    await button.click()
    await page.getByRole('alert').filter({ hasText: '暂无已关联' }).waitFor()
    const course = courses.list().courses.find(c => c.name === '掌握度导出')!
    new MasteryQuestionBank(db, course.id).saveCorrect('题目', 'single', ['一', '二'], [1])
    failSave = true; await button.click()
    await page.getByRole('alert').filter({ hasText: '写入失败' }).waitFor()
    failSave = false; cancelExport = true; await button.click()
    await page.waitForFunction(() => !document.querySelector('[role="alert"]') && !document.querySelector('[role="status"]'))
    cancelExport = false; cacheClears = 0; await button.click()
    await page.getByRole('status').filter({ hasText: '题库已导出，共 1 道题' }).waitFor()
    expect(starts).toBe(0)
  })
  it('空状态、添加两门不同配置、切换与刷新后配置保持独立，保存不启动', async () => {
    expect(await page.getByText('从第一门课程开始').isVisible()).toBe(true)
    await page.screenshot({ path: `${shots}/empty.png`, fullPage: true })
    await add('艺术与审美', 'a', 'learn-transcribe'); await add('高等数学', 'b')
    expect(starts).toBe(0)
    await page.getByRole('button', { name: /艺术与审美 传统课/ }).click()
    expect(await page.getByRole('region', { name: '课程详情' }).getByText('学习并转录', { exact: true }).isVisible()).toBe(true)
    await page.getByRole('button', { name: '设为默认课程', exact: true }).click()
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
    await page.waitForFunction(() => !!document.querySelector('[role=dialog]')?.contains(document.activeElement))
    await page.keyboard.press('Tab')
    expect(await form.evaluate(el=>el.contains(document.activeElement))).toBe(true)
    await page.screenshot({ path: `${shots}/save-error.png`, fullPage: true })
    failSave = false; await form.getByRole('button', { name: '保存课程', exact: true }).click(); await form.waitFor({ state: 'hidden' })
  })
  it('账号密码不回填、默认设置不改变现有课程、定时入口迁移到工作流', async () => {
    await add('课程 A', 'a'); await add('课程 B', 'b')
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link', { name: '账号', exact: true }).click()
    await page.getByRole('button', {name:'编辑',exact:true}).click()
    await page.getByPlaceholder('留空保留已保存的密码').waitFor()
    expect(await page.getByPlaceholder('留空保留已保存的密码').inputValue()).toBe('')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.getByRole('link', {name:'设置',exact:true}).click()
    await page.screenshot({ path: `${shots}/settings.png`, fullPage: true })
    await page.getByRole('button', { name: '课程默认配置', exact: true }).click()
    await choose(page,'运行方式','transcribe')
    await page.getByRole('button', { name: '保存当前分类', exact: true }).click(); await page.getByRole('status').waitFor()
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
    await page.getByRole('button', { name: '设为默认课程', exact: true }).click()
    for (const size of [{ width: 1180, height: 780 }, { width: 960, height: 640 }, { width: 740, height: 570 }]) {
      for (const scale of [1, 1.3]) {
        // Electron zoom reduces CSS viewport dimensions; emulate that effective viewport in Chromium.
        await page.setViewportSize({ width: Math.floor(size.width / scale), height: Math.floor(size.height / scale) })
        const label = `${size.width}-${size.height}-${scale}`
        for (const route of ['课程', '运行', '设置']) {
          await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: route, exact: true }).click()
          if (route === '设置') await page.getByRole('radiogroup', {name:'运行方式',exact:true}).waitFor()
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
    lastFlowId=workflows.create({name:'人工处理工作流',steps:[{id:'fixture-step',accountId, courseId:course.id,options:course.options}],schedule:null}).id
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
    state = { ...state, state: 'stopping', phase: 'stopping' }
    await page.reload()
    const stop = page.getByRole('button', { name: '正在停止…', exact: true })
    await stop.waitFor()
    expect(await stop.isDisabled()).toBe(true)
    expect(await page.getByRole('button',{name:'已完成，继续',exact:true}).count()).toBe(0)
    expect(await page.locator('.attention').count()).toBe(0)
    state = { ...state, state: 'idle', phase: 'finished', intervention:null, error: { stage: 'executing', code: 'execution', message: '测试执行失败' } }
    await page.reload()
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '运行', exact: true }).click()
    await page.getByRole('button', { name: '运行最新配置', exact: true }).click()
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
    await page.getByRole('button', { name: '保存当前分类', exact: true }).click()
    await page.getByRole('alert').waitFor()
    expect(await hue()).toBe('218')
    expect(settings.getAll().accentColor).toBe('blue')
    expect(await page.getByRole('radio', { name: '青绿', exact: true }).isChecked()).toBe(true)
    failSave = false
    await page.getByRole('button', { name: '保存当前分类', exact: true }).click()
    await page.getByText('当前分类设置已保存', { exact: true }).waitFor()
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
    for(const c of [a,b]) await page.getByRole('button',{name:`添加 ${c.name}`,exact:true}).click()
    await page.locator('.step-select').first().click()
    await choose(page.getByRole('region',{name:'步骤配置'}),'单次时长','limited')
    await page.getByRole('region',{name:'步骤配置'}).getByLabel('分钟数',{exact:true}).fill('7')
    await page.getByRole('button',{name:'上移步骤 2',exact:true}).click()
    await page.getByRole('button',{name:'仅手动',exact:true}).click()
    await choose(page,'触发方式','daily')
    await page.getByLabel('每日开始时间',{exact:true}).fill('15:35')
    failSave=true;await page.getByRole('button',{name:'保存工作流',exact:true}).click();await page.getByRole('alert').waitFor()
    expect(await page.getByLabel('工作流名称').inputValue()).toBe('每日两门课')
    failSave=false;await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor();expect(starts).toBe(0)
    const flow=workflows.list()[0];expect(flow.steps.map(s=>s.courseId)).toEqual([b.id,a.id]);expect(flow.steps[1].options.timeLimitMinutes).toBe(7);expect(a.options.timeLimitMinutes).toBe(0)
    expect(flow.schedule).toMatchObject({kind:'daily',enabled:true,time:'15:35'})
    failSave=true
    await page.getByRole('button',{name:'停用定时',exact:true}).click()
    await page.getByRole('alert').waitFor()
    expect(workflows.get(flow.id)?.schedule?.enabled).toBe(true)
    failSave=false
    await page.getByRole('button',{name:'停用定时',exact:true}).click()
    await page.getByRole('button',{name:'启用定时',exact:true}).waitFor()
    expect(workflows.get(flow.id)?.schedule).toMatchObject({enabled:false,nextAt:null,time:'15:35'})
    expect(workflows.get(flow.id)?.steps).toEqual(flow.steps)
    await page.reload()
    await page.getByRole('button',{name:'启用定时',exact:true}).click()
    await page.getByRole('button',{name:'停用定时',exact:true}).waitFor()
    expect(workflows.get(flow.id)?.schedule?.enabled).toBe(true)
    expect(starts).toBe(0)
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
    const flow = workflows.create({ name: '显示测试工作流', steps: [{ id: 's1', accountId, courseId: course.id, options: course.options }, { id: 's2', accountId, courseId: course.id, options: course.options }], schedule: null })
    const makeRun = (id: string, name: string): WorkflowRun => ({
      id, workflowId: flow.id, source: 'manual', state: 'running', startedAt: '2026-09-19T01:00:00Z', finishedAt: null, message: '',
      snapshot: { workflow: { ...flow, name }, steps: flow.steps.map(s => ({ ...s, account:accounts.get(s.accountId)!, course })), settings: settings.getAll() },
      steps: [...flow.steps].reverse().map(s => ({ stepId: s.id, state: s.id === 's1' ? 'succeeded' : 'running', status: null, error: null, transcription: null, startedAt: null, finishedAt: null }))
    })
    await page.getByRole('navigation').getByRole('link', { name: '运行', exact: true }).click()
    await page.getByText('还没有运行记录').waitFor()
    runFixtures = [makeRun('one', '工作流一'), makeRun('two', '工作流二')]
    await page.getByRole('heading', { name: /工作流[一二]/ }).waitFor()
    await page.evaluate(() => { location.hash = '/run?id=one' })
    await page.getByRole('heading', { name: '工作流一', exact: true }).waitFor()
    expect(await page.locator('.step').first().innerText()).toContain('执行完成')
    expect(await page.locator('.step').nth(1).innerText()).toContain('执行中')
    expect(await page.locator('.step').first().innerText()).toContain('不限时长')
    await page.evaluate(() => { location.hash = '/run?id=two' })
    await page.getByRole('heading', { name: '工作流二', exact: true }).waitFor()
    await page.setViewportSize({ width: 569, height: 438 })
    expect(await page.locator('.runs-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `${shots}/run-display-fixed.png` })
  })
})

describe('工作流工作台', () => {
  it('重复课程的配置按 ID 保留，移除后选择相邻步骤，恢复配置与定时即时保存', async () => {
    await add('独立配置课程', 'editor-repeat')
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'创建工作流',exact:true}).click()
    expect(await page.getByRole('dialog').count()).toBe(0)
    for(let i=0;i<3;i++)await page.getByRole('button',{name:'添加 独立配置课程',exact:true}).click()
    await choose(page,'单次时长','limited')
    await page.getByLabel('分钟数',{exact:true}).fill('9')
    await page.getByRole('button',{name:'上移步骤 3',exact:true}).focus()
    await page.keyboard.press('Enter')
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('9')
    await page.locator('.editor-step').nth(1).dragTo(page.locator('.editor-step').first())
    expect(await page.locator('.step-select').first().getAttribute('aria-pressed')).toBe('true')
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('9')
    await page.locator('.editor-step').first().dragTo(page.locator('.editor-step').nth(1))
    await page.locator('.step-select').first().click()
    expect(await page.getByRole('radiogroup',{name:'单次时长',exact:true}).getByRole('radio',{name:'不限时长',exact:true}).getAttribute('aria-checked')).toBe('true')
    await choose(page,'单次时长','limited')
    await page.getByLabel('分钟数',{exact:true}).fill('4')
    await page.getByRole('button',{name:'恢复课程配置',exact:true}).click()
    expect(await page.getByRole('radiogroup',{name:'单次时长',exact:true}).getByRole('radio',{name:'不限时长',exact:true}).getAttribute('aria-checked')).toBe('true')
    await page.locator('.step-select').nth(1).click()
    await page.getByRole('button',{name:'移除步骤 2',exact:true}).click()
    expect(await page.locator('.step-select').nth(1).getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('button',{name:'仅手动',exact:true}).click()
    await choose(page,'触发方式','daily')
    await page.getByLabel('每日开始时间',{exact:true}).fill('16:42')
    // Submit without blur: schedule must already be in the draft.
    await page.getByRole('button',{name:'保存工作流',exact:true}).evaluate((el:HTMLButtonElement)=>el.click())
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    const flow=workflows.list()[0]
    expect(new Set(flow.steps.map(s=>s.id)).size).toBe(2)
    expect(flow.steps.map(s=>s.options.timeLimitMinutes)).toEqual([0,0])
    expect(flow.schedule?.time).toBe('16:42')
    expect(starts).toBe(0)
    await page.getByRole('button',{name:'创建工作流',exact:true}).click()
    await page.getByRole('button',{name:'返回',exact:true}).click()
    await page.getByRole('heading',{name:flow.name,exact:true}).waitFor()
  })

  it('十步编辑器在各窗口及缩放下保存区可达，配置错误定位，版本冲突保留草稿', async () => {
    for(let i=0;i<20;i++)courses.create({name:`工作台课程 ${i}`,url:`https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=editor-${i}`,options:courses.list().defaults})
    await page.reload()
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'创建工作流',exact:true}).click()
    for(let i=0;i<10;i++)await page.getByRole('button',{name:`添加 工作台课程 ${i}`,exact:true}).click()
    await choose(page,'单次时长','limited')
    await page.getByLabel('分钟数',{exact:true}).fill('8')
    for(const size of [{width:1180,height:780},{width:960,height:640},{width:740,height:570}])for(const scale of [1,1.3]){
      await page.setViewportSize({width:Math.floor(size.width/scale),height:Math.floor(size.height/scale)})
      const save=page.getByRole('button',{name:'保存工作流',exact:true})
      expect(await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})).toBe(true)
      expect(await page.locator('.workflow-editor').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await page.waitForFunction(()=>{const row=document.querySelector('.editor-step.selected')?.getBoundingClientRect();const list=document.querySelector('.step-rows')?.getBoundingClientRect();return !!row&&!!list&&row.top>=list.top-1&&row.bottom<=list.bottom+1})
      if(await page.getByRole('tab',{name:'配置',exact:true}).isVisible())await page.getByRole('tab',{name:'配置',exact:true}).click()
      expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('8')
      await page.screenshot({path:`${shots}/editor-${size.width}-${size.height}-${scale}.png`})
      if(await page.getByRole('tab',{name:'步骤',exact:true}).isVisible())await page.getByRole('tab',{name:'步骤',exact:true}).click()
    }
    await page.getByRole('button',{name:'添加课程',exact:true}).click()
    await page.getByRole('button',{name:'添加 工作台课程 5',exact:true}).click()
    expect(await page.locator('.editor-step').count()).toBe(11)
    await page.getByRole('button',{name:'移除步骤 11',exact:true}).click()
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    const flow=workflows.list()[0]
    expect(flow.steps).toHaveLength(10)
    await page.getByRole('button',{name:'编辑',exact:true}).click()
    await page.getByLabel('工作流名称',{exact:true}).fill('冲突后保留的名称')
    workflows.update(flow.id,flow.version,{name:'其他窗口已修改',steps:flow.steps,schedule:flow.schedule})
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'工作流已被修改'}).waitFor()
    expect(await page.getByLabel('工作流名称',{exact:true}).inputValue()).toBe('冲突后保留的名称')
    expect(await page.locator('.editor-step').count()).toBe(10)
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.locator('.flow-detail h2').filter({hasText:'其他窗口已修改'}).waitFor()
    expect(await page.getByRole('alert').count()).toBe(0)
    // A stored invalid option that is hidden by the form must still be located on save.
    const latest=workflows.list()[0]
    db.raw().prepare('UPDATE workflow_steps SET options=? WHERE workflow_id=? AND id=?').run(JSON.stringify({...latest.steps[0].options,timeLimitMinutes:-2}),latest.id,latest.steps[0].id)
    await page.reload()
    await page.getByRole('button',{name:'编辑',exact:true}).click()
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'时长必须为非负整数分钟'}).waitFor()
    expect(await page.getByRole('region',{name:'步骤配置'}).isVisible()).toBe(true)
    expect(await page.getByLabel('分钟数',{exact:true}).evaluate(el=>el===document.activeElement)).toBe(true)
    await page.getByRole('button',{name:'恢复课程配置',exact:true}).click()
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    for(const size of [{width:1180,height:780},{width:960,height:640},{width:740,height:570}])for(const scale of [1,1.3]){
      await page.setViewportSize({width:Math.floor(size.width/scale),height:Math.floor(size.height/scale)})
      expect(await page.locator('.page').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await page.screenshot({path:`${shots}/workflows-${size.width}-${size.height}-${scale}.png`})
    }
  })
})

describe('运行详情隔离与滚动',()=>{
  it('过滤、快照及切换记录后的日志隔离，刷新不重置滚动位置',async()=>{
    await add('原始课程','log-snapshot')
    const course=courses.list().courses[0]
    const flow=workflows.create({name:'快照工作流',steps:[{id:'step-log',accountId, courseId:course.id,options:course.options}],schedule:null})
    const makeRun=(id:string,state:WorkflowRun['state']):WorkflowRun=>({id,workflowId:flow.id,source:'manual',state,startedAt:'2026-10-01T00:00:00Z',finishedAt:null,message:'',snapshot:{workflow:flow,steps:flow.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course})),settings:settings.getAll()},steps:[{stepId:'step-log',state:'running',status:null,transcription:null,error:null,startedAt:null,finishedAt:null}]})
    runFixtures=[makeRun('alpha','running'),makeRun('beta','failed')]
    perRunLogs={alpha:Array.from({length:200},(_,i)=>({time:Date.now(),level:'info',message:`alpha 日志 ${i}`})),beta:[{time:Date.now(),level:'error',message:'beta 独立日志'}]}
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'运行',exact:true}).click()
    const pre=page.locator('.logs pre')
    await pre.getByText('alpha 日志 0',{exact:false}).waitFor()
    await pre.evaluate(el=>{el.scrollTop=100})
    perRunLogs.alpha.push({time:Date.now(),level:'info',message:'alpha 更新日志'})
    await page.waitForFunction(()=>document.querySelector('.logs pre')?.textContent?.includes('alpha 更新日志'))
    expect(await pre.evaluate(el=>el.scrollTop)).toBe(100)
    expect(await page.locator('.logs').getAttribute('open')).not.toBeNull()
    await page.getByRole('group',{name:'运行记录筛选'}).getByRole('button',{name:'异常',exact:true}).click()
    await page.locator('.tool-row').click()
    await pre.getByText('beta 独立日志',{exact:false}).waitFor()
    expect(await pre.innerText()).not.toContain('alpha')
    await context.grantPermissions(['clipboard-read','clipboard-write'])
    await choose(page,'日志级别','error')
    await page.getByRole('button',{name:'复制日志',exact:true}).click()
    await page.getByRole('status').filter({hasText:'日志已复制'}).waitFor()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toContain('[error] beta 独立日志')
    expect(clipboard).not.toContain('alpha')
    await choose(page,'日志级别','')
    workflows.update(flow.id,flow.version,{name:'新名称',steps:flow.steps,schedule:null})
    expect(await page.getByRole('region',{name:'运行详情'}).getByRole('heading',{name:'快照工作流',exact:true}).isVisible()).toBe(true)
    await page.getByRole('group',{name:'运行记录筛选'}).getByRole('button',{name:'全部',exact:true}).click()
    delayedLogs.alpha=700
    await page.locator('.tool-row').first().click()
    await page.locator('.tool-row').nth(1).click()
    await pre.getByText('beta 独立日志',{exact:false}).waitFor()
    await page.waitForTimeout(900)
    expect(await pre.innerText()).not.toContain('alpha')
    for(const size of [{width:1180,height:780},{width:960,height:640},{width:740,height:570}])for(const scale of [1,1.3]){
      await page.setViewportSize({width:Math.floor(size.width/scale),height:Math.floor(size.height/scale)})
      expect(await page.locator('.page').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await page.screenshot({path:`${shots}/runs-populated-${size.width}-${size.height}-${scale}.png`})
    }
  })
})

describe('舒适工具界面',()=>{
  it('课程与工作流筛选同步详情，保存新条目后能在列表中找到它', async () => {
    await add('搜索课程 A', 'search-a')
    await add('搜索课程 B', 'search-b')
    const search = page.getByRole('searchbox', { name: '搜索课程' })
    await search.fill('课程 A')
    expect(await page.getByRole('region', { name: '课程详情' }).getByRole('heading', { name: '搜索课程 A', exact: true }).isVisible()).toBe(true)
    await search.fill('不存在的课程')
    expect(await page.getByRole('region', { name: '课程详情' }).count()).toBe(0)
    await add('搜索课程 C', 'search-c')
    expect(await search.inputValue()).toBe('')
    expect(await page.locator('.course-row[aria-pressed=true]').innerText()).toContain('搜索课程 C')
    await search.fill('课程 A')
    page.once('dialog',dialog=>dialog.accept())
    await page.getByRole('button',{name:'移除',exact:true}).click()
    await page.getByRole('status').filter({hasText:'课程已移除'}).waitFor()
    expect(await page.getByRole('region',{name:'课程详情'}).count()).toBe(0)
    expect(await page.locator('.course-row').count()).toBe(0)
    const course = courses.list().courses[0]
    for (const name of ['搜索工作流 A', '搜索工作流 B']) workflows.create({ name, steps: [{ id: crypto.randomUUID(), accountId, courseId: course.id, options: course.options }], schedule: null })
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工作流', exact: true }).click()
    const flowSearch = page.getByRole('searchbox', { name: '搜索工作流' })
    await flowSearch.fill('工作流 B')
    expect(await page.locator('.flow-detail h2').innerText()).toBe('搜索工作流 B')
    await page.getByRole('button', { name: '创建工作流', exact: true }).click()
    await page.getByRole('button', { name: '添加 搜索课程 C', exact: true }).click()
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    await flowSearch.waitFor()
    expect(await flowSearch.inputValue()).toBe('')
    expect(await page.locator('.tool-row[aria-pressed=true]').innerText()).toContain('搜索课程 C 工作流')
    await flowSearch.fill('工作流 A')
    page.once('dialog',dialog=>dialog.accept())
    await page.getByRole('button',{name:'删除',exact:true}).click()
    await page.getByRole('status').filter({hasText:'工作流已删除'}).waitFor()
    expect(await page.locator('.flow-detail').count()).toBe(0)
    expect(await page.getByRole('heading',{name:'选择工作流',exact:true}).isVisible()).toBe(true)
    expect(starts).toBe(0)
  })

  it('定时错误打开配置并聚焦对应字段，修正后保留即时输入', async () => {
    await add('定时校验课程', 'schedule-focus')
    await page.getByRole('button', { name: '构建工作流', exact: true }).click()
    await page.getByRole('button', { name: '仅手动', exact: true }).click()
    await choose(page,'触发方式','daily')
    const zone = page.getByLabel('时区', { exact: true })
    await zone.fill('Invalid/Zone')
    await page.getByRole('button', { name: '每日定时 · 启用', exact: true }).click()
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '请输入有效时区' }).waitFor()
    expect(await zone.evaluate(el => el === document.activeElement)).toBe(true)
    await zone.fill('Asia/Shanghai')
    await page.getByLabel('每日开始时间', { exact: true }).fill('')
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '请选择有效的定时时间' }).waitFor()
    expect(await page.getByLabel('每日开始时间', { exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByLabel('每日开始时间', { exact: true }).fill('18:25')
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    await page.getByRole('button', { name: '立即运行', exact: true }).waitFor()
    expect(workflows.list()[0].schedule?.time).toBe('18:25')
    expect(workflows.list()[0].schedule?.timeZone).toBe('Asia/Shanghai')
  })

  it('工作流写入成功后刷新失败，重试保存不会创建重复工作流', async () => {
    await add('刷新失败课程', 'refresh-retry')
    await page.getByRole('button', { name: '构建工作流', exact: true }).click()
    failFlowListOnce = true
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '列表刷新失败' }).waitFor()
    expect(await page.getByLabel('工作流名称', { exact: true }).inputValue()).toBe('刷新失败课程 工作流')
    expect(workflows.list()).toHaveLength(1)
    await page.getByRole('button', { name: '保存工作流', exact: true }).click()
    await page.getByRole('button', { name: '立即运行', exact: true }).waitFor()
    expect(workflows.list()).toHaveLength(1)
    expect(starts).toBe(0)
  })

  it('编辑已到期但未改动的单次定时，保留原补跑规则', async () => {
    await add('补跑课程', 'due-edit')
    const course = courses.list().courses[0]
    const flow = workflows.create({ name:'等待补跑', steps:[{id:'due-step',accountId, courseId:course.id,options:course.options}], schedule:{kind:'once',enabled:true,time:new Date(Date.now()+3600000).toISOString(),timeZone:'Asia/Shanghai',nextAt:null} })
    const due = new Date(Date.now()-3600000).toISOString()
    const schedule = { ...flow.schedule!, time:due, nextAt:due }
    db.raw().prepare('UPDATE workflow_schedules SET config=? WHERE workflow_id=?').run(JSON.stringify(schedule),flow.id)
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'编辑',exact:true}).click()
    await page.getByLabel('工作流名称',{exact:true}).fill('补跑规则保留')
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.get(flow.id)?.schedule).toEqual(schedule)
    expect(workflows.get(flow.id)?.name).toBe('补跑规则保留')
  })

  it('键盘切换、排序和移除步骤后，配置与焦点仍指向可用步骤', async () => {
    await add('步骤键盘 A','step-key-a')
    await add('步骤键盘 B','step-key-b')
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'创建工作流',exact:true}).click()
    for (const name of ['步骤键盘 A','步骤键盘 B','步骤键盘 A']) await page.getByRole('button',{name:`添加 ${name}`,exact:true}).click()
    const rows = page.locator('.step-select')
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    expect(await rows.nth(1).getAttribute('aria-pressed')).toBe('true')
    await choose(page,'运行方式','learn-transcribe')
    await page.getByRole('button',{name:'上移步骤 2',exact:true}).focus()
    await page.keyboard.press('Enter')
    expect(await rows.first().getAttribute('aria-pressed')).toBe('true')
    expect(await rows.first().evaluate(el=>el===document.activeElement)).toBe(true)
    expect(await page.getByRole('radiogroup',{name:'运行方式',exact:true}).getByRole('radio',{name:'学习并转录',exact:true}).getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('End')
    expect(await rows.nth(2).getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('button',{name:'移除步骤 3',exact:true}).focus()
    await page.keyboard.press('Enter')
    expect(await rows.nth(1).evaluate(el=>el===document.activeElement)).toBe(true)
    expect(await rows.nth(1).getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.list()[0].steps[0].options.action).toBe('learn-transcribe')
    expect(workflows.list()[0].steps[1].options.action).toBe('learn')
  })

  it('列表支持方向键与首尾跳转，类型筛选直接可见，主要操作保持在顶部',async()=>{
    await add('键盘课程 A','keyboard-a')
    await add('键盘课程 B','keyboard-b')
    const rows=page.locator('.course-row')
    await rows.first().focus();await page.keyboard.press('ArrowDown')
    expect(await rows.nth(1).evaluate(el=>el===document.activeElement)).toBe(true)
    expect(await rows.nth(1).getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('Home')
    expect(await rows.first().getAttribute('aria-pressed')).toBe('true')
    await page.keyboard.press('End')
    expect(await rows.nth(1).getAttribute('aria-pressed')).toBe('true')
    const filter=page.getByRole('group',{name:'课程类型筛选'})
    expect(await filter.getByRole('button',{name:'传统课',exact:true}).isVisible()).toBe(true)
    await filter.getByRole('button',{name:'图谱课',exact:true}).click()
    expect(await rows.count()).toBe(0)
    await filter.getByRole('button',{name:'全部',exact:true}).click()
    expect(await rows.count()).toBe(2)
    const action=page.getByRole('button',{name:'构建工作流',exact:true})
    expect(await action.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight/2})).toBe(true)
    expect(await page.getByRole('button',{name:'添加课程',exact:true}).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(32)
    expect(await rows.first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48)
  })

  it('小窗口可连续添加课程，关闭后焦点回到入口，步骤配置无需标签切换',async()=>{
    await add('无需多级菜单课程','direct-editor')
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'创建工作流',exact:true}).click()
    await page.setViewportSize({width:740,height:570})
    const trigger=page.getByRole('button',{name:'添加课程',exact:true})
    await trigger.click()
    const search=page.getByRole('searchbox',{name:'搜索可添加课程'})
    expect(await search.evaluate(el=>el===document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    expect(await trigger.evaluate(el=>el===document.activeElement)).toBe(true)
    await trigger.click()
    await page.getByRole('button',{name:'添加 无需多级菜单课程',exact:true}).click()
    await page.getByRole('button',{name:'添加 无需多级菜单课程',exact:true}).click()
    expect(await page.getByRole('searchbox',{name:'搜索可添加课程'}).isVisible()).toBe(true)
    expect(await page.locator('.editor-step').count()).toBe(2)
    await page.getByRole('button',{name:'关闭',exact:true}).click()
    expect(await trigger.evaluate(el=>el===document.activeElement)).toBe(true)
    expect(await page.getByRole('tab',{name:'配置',exact:true}).count()).toBe(0)
    expect(await page.getByRole('region',{name:'工作流步骤'}).count()).toBe(1)
    await page.locator('.step-select').first().click()
    await choose(page,'运行方式','learn-transcribe')
    await page.emulateMedia({reducedMotion:'reduce'})
    expect(await page.getByRole('button',{name:'保存工作流',exact:true}).evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s')
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.list()[0].steps[0].options.action).toBe('learn-transcribe')
  })

  it('切换条目后详情回到标题，同一条目的滚动位置保持不变', async () => {
    await add('滚动课程 A','detail-scroll-a')
    await add('滚动课程 B','detail-scroll-b')
    await page.setViewportSize({width:740,height:570})
    const courseDetail=page.getByRole('region',{name:'课程详情'})
    await courseDetail.evaluate(el=>el.scrollTop=el.scrollHeight)
    expect(await courseDetail.evaluate(el=>el.scrollTop)).toBeGreaterThan(0)
    await page.locator('.course-row[aria-pressed=false]').click()
    expect(await courseDetail.evaluate(el=>el.scrollTop)).toBe(0)
    const course=courses.list().courses[0]
    for(const name of ['长详情工作流 A','长详情工作流 B']) workflows.create({name,steps:Array.from({length:20},()=>({id:crypto.randomUUID(),accountId, courseId:course.id,options:course.options})),schedule:null})
    await page.setViewportSize({width:1180,height:780})
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    const detail=page.locator('.workspace-detail')
    const rows=page.locator('.workspace-list .tool-row')
    await rows.first().click()
    await detail.evaluate(el=>el.scrollTop=200)
    expect(await detail.evaluate(el=>el.scrollTop)).toBe(200)
    await rows.first().click()
    expect(await detail.evaluate(el=>el.scrollTop)).toBe(200)
    await rows.nth(1).click()
    expect(await detail.evaluate(el=>el.scrollTop)).toBe(0)
    expect(await page.getByRole('button',{name:'立即运行',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})).toBe(true)
  })

  it('不可识别和已移除的课程步骤显示原因，移除失效步骤后可保存', async () => {
    for(const name of ['正常课程','旧类型课程','已移除课程']) await add(name,`unavailable-${name}`)
    const library=courses.list().courses
    const flow=workflows.create({name:'修复失效步骤',steps:library.map(course=>({id:crypto.randomUUID(),accountId, courseId:course.id,options:course.options})),schedule:null})
    const unknown=library.find(course=>course.name==='旧类型课程')!
    const removed=library.find(course=>course.name==='已移除课程')!
    db.raw().prepare('UPDATE courses SET kind=? WHERE id=?').run('unknown',unknown.id)
    expect(courses.remove(removed.id).ok).toBe(false)
    // Simulate an older archived reference; the normal API protects referenced courses.
    db.raw().prepare('UPDATE courses SET deleted_at=? WHERE id=?').run(new Date().toISOString(),removed.id)
    await page.reload()
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.getByRole('button',{name:'编辑',exact:true}).click()
    expect(await page.getByRole('button',{name:'添加 旧类型课程',exact:true}).isDisabled()).toBe(true)
    expect(await page.locator('.editor-step').filter({hasText:'课程类型不可识别'}).count()).toBe(1)
    expect(await page.locator('.editor-step').filter({hasText:'课程已移除'}).count()).toBe(1)
    expect(await page.getByRole('button',{name:'保存工作流',exact:true}).isDisabled()).toBe(true)
    for(const reason of ['课程已移除','课程类型不可识别']) await page.locator('.editor-step').filter({hasText:reason}).getByRole('button',{name:/移除步骤/}).click()
    expect(await page.locator('.editor-step').count()).toBe(1)
    expect(await page.getByRole('button',{name:'保存工作流',exact:true}).isEnabled()).toBe(true)
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.get(flow.id)?.steps).toHaveLength(1)
    expect(workflows.get(flow.id)?.steps[0].courseId).toBe(library.find(course=>course.name==='正常课程')!.id)
  })

  it('长工作流列表首尾跳转后，选中行不会被固定搜索栏遮挡', async () => {
    await add('列表滚动课程','list-scroll')
    const course = courses.list().courses[0]
    for(let i=0;i<12;i++) workflows.create({name:`列表工作流 ${i}`,steps:[{id:crypto.randomUUID(),accountId, courseId:course.id,options:course.options}],schedule:null})
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    await page.setViewportSize({width:740,height:570})
    const rows = page.locator('.workspace-list .tool-row')
    await rows.first().focus()
    for(const key of ['End','Home']) {
      await page.keyboard.press(key)
      const selected = page.locator('.workspace-list .tool-row[aria-pressed=true]')
      expect(await selected.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&el.contains(hit)})).toBe(true)
      expect(await selected.locator('strong').innerText()).toBe(await page.locator('.flow-detail h2').innerText())
    }
  })

  it('小窗口展开定时后仍能添加课程，折叠规则区不会丢失定时草稿', async () => {
    await add('窄窗口定时课程','narrow-schedule-picker')
    await page.getByRole('button',{name:'构建工作流',exact:true}).click()
    await page.setViewportSize({width:569,height:438})
    await page.getByRole('button',{name:'仅手动',exact:true}).click()
    await choose(page,'触发方式','daily')
    await page.getByLabel('每日开始时间',{exact:true}).fill('18:25')
    await page.getByRole('button',{name:'添加课程',exact:true}).click()
    const addButton = page.getByRole('button',{name:'添加 窄窗口定时课程',exact:true})
    expect(await addButton.evaluate(el=>{const r=el.getBoundingClientRect();const parent=document.querySelector('.editor-body')!.getBoundingClientRect();return r.top>=parent.top&&r.bottom<=parent.bottom})).toBe(true)
    await addButton.click()
    expect(await page.locator('.editor-step').count()).toBe(2)
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.list()[0].schedule?.time).toBe('18:25')
    expect(workflows.list()[0].steps).toHaveLength(2)
  })

  it('课程选择面板随窗口宽度恢复为课程库，搜索和键盘焦点保持可用', async () => {
    await add('窗口变化课程', 'picker-resize')
    await page.getByRole('button',{name:'构建工作流',exact:true}).click()
    await page.setViewportSize({width:740,height:570})
    const trigger = page.getByRole('button',{name:'添加课程',exact:true})
    await trigger.click()
    const search = page.getByRole('searchbox',{name:'搜索可添加课程'})
    await search.fill('窗口变化')
    await page.setViewportSize({width:1180,height:780})
    await page.waitForFunction(()=>!document.querySelector('.course-library')?.classList.contains('picker'))
    expect(await page.getByRole('button',{name:'关闭',exact:true}).count()).toBe(0)
    expect(await search.inputValue()).toBe('窗口变化')
    expect(await search.evaluate(el=>el===document.activeElement)).toBe(true)
    await page.setViewportSize({width:740,height:570})
    await page.waitForFunction(()=>document.activeElement?.matches('.editor-mobile-tools button'))
    expect(await trigger.evaluate(el=>el===document.activeElement)).toBe(true)
    await trigger.click()
    expect(await search.inputValue()).toBe('窗口变化')
    await page.keyboard.press('Escape')
    expect(await trigger.evaluate(el=>el===document.activeElement)).toBe(true)
  })

  it('所有强调色的主要操作文字对比清楚，切换颜色不会染色背景和正文',async()=>{
    const rgb=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number)
    const luminance=(values:number[])=>values.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
    await add('强调色文字对比课程','accent-row')
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'设置',exact:true}).click()
    await page.getByRole('button',{name:'外观',exact:true}).click()
    const base=await page.locator('.sidebar').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(document.body).color}))
    for(const label of ['青绿','紫色','玫瑰','橙色','蓝色（默认）']){
      await page.getByRole('radio',{name:label,exact:true}).check()
      const save=page.getByRole('button',{name:'保存当前分类',exact:true})
      await save.click()
      await page.getByRole('status').filter({hasText:'设置已保存'}).waitFor()
      const appearance=await save.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor}})
      const a=luminance(rgb(appearance.color)),b=luminance(rgb(appearance.background))
      expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5)
      expect(await page.locator('.sidebar').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(document.body).color}))).toEqual(base)
      await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'课程',exact:true}).click()
      const row = page.locator('.course-row[aria-pressed=true]')
      await row.waitFor()
      await page.waitForTimeout(120)
      const rowColors = await row.evaluate(el => ({ background:getComputedStyle(el).backgroundColor, text:getComputedStyle(el.querySelector('.course-row-content>div')!).color }))
      const c=luminance(rgb(rowColors.text)),d=luminance(rgb(rowColors.background))
      expect((Math.max(c,d)+.05)/(Math.min(c,d)+.05)).toBeGreaterThanOrEqual(4.5)
      await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'设置',exact:true}).click()
      await page.getByRole('button',{name:'外观',exact:true}).click()
    }
  })
})

describe('交互状态与直接操作',()=>{
  it('设置分类保留独立草稿，保存和取消仅作用于当前分类，离开仍确认',async()=>{
    await page.getByRole('link',{name:'设置',exact:true}).click()
    await page.getByRole('button',{name:'课程默认配置',exact:true}).click()
    await choose(page,'单次时长','limited')
    await page.getByLabel('分钟数',{exact:true}).fill('17')
    await page.getByRole('button',{name:'外观',exact:true}).click()
    await page.getByRole('radio',{name:'紫色',exact:true}).check()
    failSave=true
    await page.getByRole('button',{name:'保存当前分类',exact:true}).click()
    await page.getByRole('alert').waitFor()
    await page.getByRole('button',{name:'课程默认配置',exact:true}).click()
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('17')
    await page.getByRole('button',{name:'外观',exact:true}).click()
    expect(await page.getByRole('radio',{name:'紫色',exact:true}).isChecked()).toBe(true)
    failSave=false
    await page.getByRole('button',{name:'保存当前分类',exact:true}).click()
    await page.getByRole('status').filter({hasText:'当前分类设置已保存'}).waitFor()
    expect(settings.getAll().accentColor).toBe('violet')
    expect(courses.list().defaults.timeLimitMinutes).toBe(0)
    expect(await page.getByText('其他分类还有未保存的修改',{exact:true}).isVisible()).toBe(true)
    await page.getByRole('radio',{name:'橙色',exact:true}).check()
    await page.getByRole('button',{name:'取消修改',exact:true}).click()
    expect(await page.getByRole('radio',{name:'紫色',exact:true}).isChecked()).toBe(true)
    await page.getByRole('button',{name:'课程默认配置',exact:true}).click()
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('17')
    const dialog=page.waitForEvent('dialog')
    const leave=page.getByRole('link',{name:'课程',exact:true}).click()
    const prompt=await dialog
    expect(prompt.message()).toContain('课程默认配置')
    await prompt.dismiss();await leave
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('17')
    await page.getByRole('button',{name:'保存当前分类',exact:true}).click()
    await page.getByRole('status').filter({hasText:'当前分类设置已保存'}).waitFor()
    expect(courses.list().defaults.timeLimitMinutes).toBe(17)
    await page.reload();await page.getByRole('button',{name:'课程默认配置',exact:true}).click()
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('17')
    await page.screenshot({path:`${shots}/interaction-settings.png`})
  })

  it('直接选择支持方向键，时长不串步，移除与恢复课程配置可就地撤销',async()=>{
    await add('可撤销课程','undo-course')
    await page.getByRole('button',{name:'构建工作流',exact:true}).click()
    await page.getByRole('button',{name:'添加 可撤销课程',exact:true}).click()
    const rows=page.locator('.step-select')
    await rows.first().click()
    const action=page.getByRole('radiogroup',{name:'运行方式',exact:true})
    await action.getByRole('radio',{name:'学习',exact:true}).focus();await page.keyboard.press('ArrowRight')
    expect(await action.getByRole('radio',{name:'学习并转录',exact:true}).getAttribute('aria-checked')).toBe('true')
    await choose(page,'单次时长','limited');await page.getByLabel('分钟数',{exact:true}).fill('7')
    await choose(page,'单次时长','unlimited');await choose(page,'单次时长','limited')
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('7')
    await rows.nth(1).click();await choose(page,'单次时长','limited')
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('60')
    await page.getByLabel('分钟数',{exact:true}).fill('19')
    await page.getByRole('button',{name:'移除步骤 1',exact:true}).click()
    expect(await rows.count()).toBe(1)
    await page.getByLabel('分钟数',{exact:true}).fill('23')
    await page.getByRole('button',{name:'撤销',exact:true}).click()
    expect(await rows.count()).toBe(2)
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('7')
    await page.getByRole('button',{name:'恢复课程配置',exact:true}).click()
    expect(await page.getByLabel('分钟数',{exact:true}).count()).toBe(0)
    await page.getByRole('button',{name:'撤销',exact:true}).click()
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('7')
    await rows.nth(1).click()
    expect(await page.getByLabel('分钟数',{exact:true}).inputValue()).toBe('23')
    await page.screenshot({path:`${shots}/interaction-editor.png`})
    await page.keyboard.press('Control+s')
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.list()[0].steps.map(s=>s.options.timeLimitMinutes)).toEqual([7,23])
    expect(workflows.list()[0].steps[0].options.action).toBe('learn-transcribe')
  })

  it('待执行课程显示占用来源，人工处理覆盖普通运行状态，停止不阻塞另一记录',async()=>{
    await add('当前课程','occupy-current');await add('待执行课程','occupy-pending');await add('另一课程','occupy-other')
    const a=courses.list().courses.find(c=>c.name==='当前课程')!,b=courses.list().courses.find(c=>c.name==='待执行课程')!
    const flow=workflows.create({name:'占用测试',steps:[{id:'first',accountId, courseId:a.id,options:a.options},{id:'next',accountId, courseId:b.id,options:b.options}],schedule:null})
    const make=(id:string):WorkflowRun=>({id,workflowId:flow.id,source:'manual',state:'running',startedAt:'2026-10-01T00:00:00Z',finishedAt:null,message:'',snapshot:{workflow:flow,steps:flow.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course:s.courseId===a.id?a:b})),settings:settings.getAll()},steps:flow.steps.map((s,i)=>({stepId:s.id,state:i?'pending':'running',startedAt:i?null:'2026-10-01T00:00:00Z',finishedAt:null,error:null,transcription:null,status:i?null:{...state,state:'running',phase:'waiting',intervention:{id:'human',kind:'manual-login',scene:'login',message:'请完成登录',at:Date.now()}}}))})
    const c=courses.list().courses.find(course=>course.name==='另一课程')!
    const other=workflows.create({name:'另一任务',steps:[{id:'third',accountId, courseId:c.id,options:c.options}],schedule:null})
    const next=make('attention-b');next.workflowId=other.id;next.snapshot={workflow:other,steps:other.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course:c})),settings:settings.getAll()};next.steps=[{...next.steps[0],stepId:'third'}]
    runFixtures=[make('attention-a'),next]
    await page.locator('.course-row').filter({hasText:'待执行课程'}).getByText('已被占用',{exact:true}).waitFor()
    await page.locator('.course-row').filter({hasText:'待执行课程'}).click()
    expect(await page.getByRole('region',{name:'课程详情'}).innerText()).toContain('工作流“占用测试”占用了')
    await page.getByRole('link',{name:'查看运行',exact:true}).click()
    await page.getByRole('region',{name:'运行详情'}).getByRole('heading',{name:'占用测试',exact:true}).waitFor()
    expect(await page.locator('.attention-count').innerText()).toBe('2')
    await page.getByRole('group',{name:'运行记录筛选'}).getByRole('button',{name:'需处理',exact:true}).click()
    expect(await page.locator('.tool-row').count()).toBe(2)
    await page.getByRole('group',{name:'运行记录筛选'}).getByRole('button',{name:'全部',exact:true}).click()
    actionDelay=1800
    await page.getByRole('button',{name:'停止工作流',exact:true}).click()
    await page.locator('.tool-row').filter({hasText:'另一任务'}).click()
    expect(await page.getByRole('button',{name:'停止工作流',exact:true}).isEnabled()).toBe(true)
    expect(await page.getByRole('button',{name:'已完成，继续',exact:true}).isEnabled()).toBe(true)
    await page.locator('.tool-row').filter({hasText:'占用测试'}).click()
    await page.getByText('未执行',{exact:true}).waitFor()
    expect(await page.getByRole('button',{name:'已完成，继续',exact:true}).count()).toBe(0)
    await page.screenshot({path:`${shots}/interaction-stopped.png`})
  })

  it('日志明确加载与筛选空状态，跟随可关闭并显示新日志，选择同步深链接',async()=>{
    await add('日志反馈课程','log-feedback')
    const course=courses.list().courses[0]
    const flow=workflows.create({name:'日志反馈工作流',steps:[{id:'log',accountId, courseId:course.id,options:course.options}],schedule:null})
    runFixtures=[{id:'log-feedback',workflowId:flow.id,source:'manual',state:'succeeded',startedAt:'2026-10-01T00:00:00Z',finishedAt:'2026-10-01T00:30:00Z',message:'',snapshot:{workflow:flow,steps:flow.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course})),settings:settings.getAll()},steps:[{stepId:'log',state:'succeeded',startedAt:'2026-10-01T00:00:00Z',finishedAt:'2026-10-01T00:30:00Z',status:{...state,stoppedReason:'time-limit'},error:null,transcription:null}]}]
    perRunLogs={'log-feedback':Array.from({length:80},(_,i)=>({time:Date.now(),level:'info',message:`反馈日志 ${i}`}))};delayedLogs['log-feedback']=700
    await page.getByRole('link',{name:'运行',exact:true}).click()
    const pre=page.locator('.logs pre')
    await pre.filter({hasText:'正在加载日志…'}).waitFor()
    await pre.filter({hasText:'反馈日志 79'}).waitFor()
    expect(await page.getByRole('region',{name:'运行详情'}).innerText()).toContain('达到单次时长限制')
    expect(await pre.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(12)
    await page.getByRole('checkbox',{name:'跟随最新',exact:true}).uncheck()
    await pre.evaluate(el=>el.scrollTop=50)
    perRunLogs['log-feedback'].push({time:Date.now(),level:'info',message:'反馈新日志'})
    await page.getByRole('button',{name:'1 条新日志',exact:true}).waitFor()
    expect(await pre.evaluate(el=>el.scrollTop)).toBe(50)
    await page.getByRole('button',{name:'1 条新日志',exact:true}).click()
    expect(await pre.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(12)
    await choose(page,'日志级别','error')
    expect(await pre.innerText()).toBe('当前级别没有日志')
    expect(await page.getByRole('button',{name:'复制日志',exact:true}).isDisabled()).toBe(true)
    expect(page.url()).toContain('id=log-feedback')
    await page.screenshot({path:`${shots}/interaction-logs.png`})
  })

  it('历史记录重跑显示最新配置含义，拒绝入口定位记录，删除原工作流后禁止启动',async()=>{
    await add('历史状态课程','restart-feedback')
    const course=courses.list().courses[0]
    const flow=workflows.create({name:'历史任务',steps:[{id:'history',accountId, courseId:course.id,options:course.options}],schedule:null})
    const make=(id:string,state:WorkflowRun['state']):WorkflowRun=>({id,workflowId:flow.id,source:'manual',state,startedAt:'2026-10-01T00:00:00Z',finishedAt:'2026-10-01T00:30:00Z',message:'',snapshot:{workflow:flow,steps:flow.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course})),settings:settings.getAll()},steps:[]})
    runFixtures=[make('old-run','failed'),make('rejected-run','rejected')]
    startRejection={message:'请先保存登录账号和密码',runId:'rejected-run'}
    await page.getByRole('link',{name:'运行',exact:true}).click()
    await page.evaluate(()=>location.hash='/run?id=old-run')
    await page.getByRole('button',{name:'运行最新配置',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'请先保存登录账号和密码'}).waitFor()
    await page.getByRole('button',{name:'查看启动记录',exact:true}).click()
    expect(page.url()).toContain('id=rejected-run')
    workflows.remove(flow.id)
    await page.getByRole('button',{name:'运行最新配置',exact:true}).waitFor({state:'visible'})
    await page.waitForFunction(()=>document.querySelector('.run-detail')?.textContent?.includes('原工作流已删除'))
    expect(await page.getByRole('button',{name:'运行最新配置',exact:true}).isDisabled()).toBe(true)
    expect(await page.getByRole('heading',{name:'历史任务',exact:true}).isVisible()).toBe(true)
    await page.screenshot({path:`${shots}/interaction-deleted-flow.png`})
  })
})

describe('前端反馈细节',()=>{
  it('设置读取失败显示重试入口，未加载成功时不能保存或取消空基线',async()=>{
    failSettingsLoadOnce=true
    await page.getByRole('link',{name:'设置',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'fixture 设置读取失败'}).waitFor()
    expect(await page.getByRole('button',{name:'保存当前分类',exact:true}).count()).toBe(0)
    expect(await page.getByRole('button',{name:'外观',exact:true}).isDisabled()).toBe(true)
    await page.getByRole('button',{name:'重新加载',exact:true}).click()
    await page.getByRole('button',{name:'外观',exact:true}).click()
    expect(await page.getByRole('button',{name:'保存当前分类',exact:true}).isDisabled()).toBe(true)
    expect(await page.getByRole('radio',{name:'100%',exact:true}).getAttribute('aria-checked')).toBe('true')
  })
  it('定时方式直接切换并保留各自输入，单次时区解释清楚，保存提示与悬停说明可见',async()=>{
    await add('时间反馈课程','schedule-feedback')
    const build=page.getByRole('button',{name:'构建工作流',exact:true})
    await build.hover()
    expect(await build.getAttribute('title')).toContain('预填工作流')
    await build.click()
    await page.getByLabel('工作流名称',{exact:true}).fill('')
    expect(await page.getByText('请填写工作流名称',{exact:true}).isVisible()).toBe(true)
    expect(await page.getByRole('button',{name:'保存工作流',exact:true}).getAttribute('title')).toBe('请填写工作流名称')
    await page.getByLabel('工作流名称',{exact:true}).fill('时间反馈')
    await page.getByRole('button',{name:'仅手动',exact:true}).click()
    await choose(page,'触发方式','daily');await page.getByLabel('每日开始时间',{exact:true}).fill('18:35')
    await page.getByLabel('时区',{exact:true}).fill('Asia/Tokyo')
    await choose(page,'触发方式','once')
    const localInput=page.getByLabel('运行日期时间（本地）',{exact:true})
    const future=new Date(Date.now()+86400000*30).toISOString().slice(0,16)
    await localInput.fill(future)
    await page.getByLabel('显示时区',{exact:true}).fill('Europe/London')
    expect(await page.getByRole('region',{name:'定时配置'}).innerText()).toContain('修改显示时区不会移动触发时刻')
    await choose(page,'触发方式','daily')
    await page.getByRole('button',{name:'每日定时 · 启用',exact:true}).click()
    await page.getByRole('button',{name:'每日定时 · 启用',exact:true}).click()
    expect(await page.getByLabel('每日开始时间',{exact:true}).inputValue()).toBe('18:35')
    expect(await page.getByLabel('时区',{exact:true}).inputValue()).toBe('Asia/Tokyo')
    await choose(page,'触发方式','once')
    expect(await localInput.inputValue()).toBe(future)
    expect(await page.getByLabel('显示时区',{exact:true}).inputValue()).toBe('Europe/London')
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.list()[0].schedule?.timeZone).toBe('Europe/London')
    expect(starts).toBe(0)
  })
})

describe('条目导航连续性',()=>{
  it('往返页面保留浏览选择，构建入口只消费一次，运行详情定位对应工作流',async()=>{
    await add('导航课程 A','navigation-a');await add('导航课程 B','navigation-b')
    const a=courses.list().courses.find(c=>c.name==='导航课程 A')!,b=courses.list().courses.find(c=>c.name==='导航课程 B')!
    await page.locator('.course-row').filter({hasText:'导航课程 B'}).click()
    const selectedBefore=courses.list().selectedCourseId
    await page.getByRole('link',{name:'设置',exact:true}).click()
    await page.getByRole('link',{name:'课程',exact:true}).click()
    expect(await page.locator('.course-row[aria-pressed=true]').innerText()).toContain('导航课程 B')
    expect(courses.list().selectedCourseId).toBe(selectedBefore)
    const other=workflows.create({name:'较早工作流',steps:[{id:'other',accountId, courseId:a.id,options:a.options}],schedule:null})
    await page.getByRole('button',{name:'构建工作流',exact:true}).click()
    await page.getByRole('button',{name:'保存工作流',exact:true}).waitFor()
    expect(page.url()).not.toContain('courseId=')
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    const saved=workflows.list().find(flow=>flow.id!==other.id)!
    await page.reload()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(await page.getByLabel('工作流名称',{exact:true}).count()).toBe(0)
    expect(await page.locator('.workspace-list .tool-row[aria-pressed=true]').innerText()).toContain('导航课程 B')
    await page.getByRole('link',{name:'设置',exact:true}).click()
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'工作流',exact:true}).click()
    expect(await page.locator('.workspace-list .tool-row[aria-pressed=true]').innerText()).toContain('导航课程 B')
    runFixtures=[{id:'navigation-run',workflowId:saved.id,source:'manual',state:'failed',snapshot:{workflow:saved,steps:saved.steps.map(s=>({...s,account:accounts.get(s.accountId)!,course:b})),settings:settings.getAll()},startedAt:'2026-10-01T00:00:00Z',finishedAt:'2026-10-01T00:01:00Z',message:'',steps:[]}]
    await page.locator('.workspace-list .tool-row').filter({hasText:'较早工作流'}).click()
    await page.getByRole('link',{name:'运行',exact:true}).click()
    await page.getByRole('link',{name:'管理工作流',exact:true}).click()
    await page.getByRole('heading',{name:saved.name,exact:true}).waitFor()
    expect(await page.locator('.workspace-list .tool-row[aria-pressed=true]').innerText()).toContain(saved.name)
  })
})

describe('settings cache cleanup', () => {
  it('cleans immediately with progress feedback and prevents duplicate clicks', async () => {
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '缓存', exact: true }).click()
    await page.getByText('保留登录状态、账号设置、课程进度、题库、转录文件和已下载的转录模型。', { exact: true }).waitFor()
    actionDelay = 400
    await page.getByRole('button', { name: '清理缓存', exact: true }).click()
    expect(await page.getByRole('button', { name: '正在清理…', exact: true }).isDisabled()).toBe(true)
    await page.getByText('缓存清理完成，已清理临时文件和课程网页缓存 2.0 KiB', { exact: true }).waitFor()
    expect(cacheClears).toBe(1)
    expect(await page.getByRole('button', { name: '清理缓存', exact: true }).isEnabled()).toBe(true)
    expect(await page.getByRole('button', { name: '保存当前分类', exact: true }).count()).toBe(0)
    await page.screenshot({ path: `${shots}/settings-cache.png`, fullPage: true })
  })
  it('shows the backend rejection and allows retry after tasks have stopped', async () => {
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '缓存', exact: true }).click()
    failSave = true
    await page.getByRole('button', { name: '清理缓存', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '请先停止所有运行中的任务' }).waitFor()
    failSave = false
    await page.getByRole('button', { name: '清理缓存', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '缓存清理完成' }).waitFor()
    expect(cacheClears).toBe(2)
  })
})

vi.mock('electron', () => ({safeStorage:{isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString()}}))

describe('多账号界面',()=>{
  it('创建、编辑和删除账号，编辑时不回填密码',async()=>{
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'账号',exact:true}).click()
    await page.getByRole('button',{name:'添加账号',exact:true}).click()
    await page.getByLabel('账号名称',{exact:true}).fill('第二账号')
    await page.getByLabel('登录账号',{exact:true}).fill('second-user')
    await page.getByLabel('密码',{exact:true}).fill('second-password')
    await page.getByRole('button',{name:'保存账号',exact:true}).click()
    await page.getByRole('heading',{name:'第二账号',exact:true}).waitFor()
    expect(accounts.list()).toHaveLength(2)
    expect(JSON.stringify(accounts.list())).not.toContain('second-password')
    await page.getByRole('button',{name:'编辑',exact:true}).click()
    expect(await page.getByLabel('密码',{exact:true}).inputValue()).toBe('')
    await page.getByLabel('账号名称',{exact:true}).fill('已改名')
    await page.getByRole('button',{name:'保存账号',exact:true}).click()
    await page.getByRole('heading',{name:'已改名',exact:true}).waitFor()
    const second=accounts.list().find(a=>a.name==='已改名')!
    expect(accounts.credentials(second.id).password).toBe('second-password')
    page.once('dialog',dialog=>dialog.accept())
    await page.getByRole('button',{name:'删除',exact:true}).click()
    await page.getByRole('status').filter({hasText:'账号已删除'}).waitFor()
    expect(accounts.list()).toHaveLength(1)
    await page.setViewportSize({width:569,height:438})
    expect(await page.locator('.page').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
    await page.screenshot({path:`${shots}/accounts-narrow.png`})
    await page.setViewportSize({width:1180,height:780})
    await page.screenshot({path:`${shots}/accounts.png`})
  })
  it('多账号时每一步显式选择账号，保存后展示账号，课程详情按账号显示进度',async()=>{
    const second=accounts.create({name:'第二账号',username:'second-user',password:'second-password',loginMethod:'upc-institution',loggedUrl:''})
    await add('共享课程','multi-account')
    const course=courses.list().courses[0]
    accounts.saveProgress(accountId,course.id,'默认账号第二章');accounts.saveProgress(second.id,course.id,'第二账号第一章')
    await page.reload()
    await page.getByText('默认账号第二章',{exact:false}).waitFor();await page.getByText('第二账号第一章',{exact:false}).waitFor()
    await page.getByRole('button',{name:'构建工作流',exact:true}).click()
    const select=page.getByLabel('执行账号',{exact:true})
    await select.waitFor();expect(await select.inputValue()).toBe('')
    await select.selectOption(second.id)
    await page.getByText('此账号上次完成的位置：第二账号第一章',{exact:true}).waitFor()
    await page.getByRole('button',{name:'保存工作流',exact:true}).click()
    await page.getByRole('button',{name:'立即运行',exact:true}).waitFor()
    expect(workflows.list()[0].steps[0].accountId).toBe(second.id)
    await page.getByText('账号：第二账号',{exact:true}).waitFor()
    await page.screenshot({path:`${shots}/multi-account-workflow.png`})
    await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'账号',exact:true}).click()
    await page.getByRole('button').filter({hasText:'第二账号'}).click()
    expect(await page.getByRole('button',{name:'删除',exact:true}).isDisabled()).toBe(true)
  })
})
