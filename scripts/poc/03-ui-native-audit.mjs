/** Native-window visual audit with isolated, disposable data and no task execution. */
import { _electron as electron } from 'playwright-core'
import SQLite from 'better-sqlite3'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const userData = mkdtempSync(join(tmpdir(), 'auto-course-ui-native-'))
const output = resolve(root, 'output/playwright/frontend-refinement/native')
mkdirSync(output, { recursive: true })
// A populated settings table prevents legacy migration from reading the user's library.
const db = new SQLite(join(userData, 'auto_course.db'))
db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('uiScale', '1')
db.close()
const results = []
async function activate(locator, scale) {
  if (scale === 1) return locator.click()
  await locator.evaluate(el=>el.scrollIntoView({block:'nearest'}))
  const hit = await locator.evaluate(el => { const r=el.getBoundingClientRect(); const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {matches:!!target&&el.contains(target),rectangle:{x:r.x,y:r.y,width:r.width,height:r.height}} })
  if (!hit.matches) throw Error(`DOM hit test failed: ${JSON.stringify(hit)}`)
  // Keyboard activation avoids Electron's automation-coordinate mismatch at native zoom.
  await locator.focus()
  await locator.press('Enter')
}
const env = { ...process.env, NODE_ENV: 'production' }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [root, `--user-data-dir=${userData}`], cwd: root, env })
async function capture(filename) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(filename, Buffer.from(data, 'base64'))
}
async function probeNativePointer(page, scale) {
  const link = page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'设置',exact:true})
  const point = await link.evaluate(el => {
    window.__nativePointerProbe = null
    document.addEventListener('click',event => {
      window.__nativePointerProbe = {href:event.target.closest('a')?.getAttribute('href')??'',x:event.clientX,y:event.clientY}
    },{once:true,capture:true})
    const r=el.getBoundingClientRect()
    return {x:r.x+r.width/2,y:r.y+r.height/2}
  })
  await app.evaluate(({BrowserWindow},{point,scale}) => {
    const win=BrowserWindow.getAllWindows()[0]
    win.focus()
    const coordinates={x:Math.round(point.x*scale),y:Math.round(point.y*scale),button:'left',clickCount:1}
    for (const type of ['mouseMove','mouseDown','mouseUp']) win.webContents.sendInputEvent({...coordinates,type})
  },{point,scale})
  await page.waitForFunction(()=>!!window.__nativePointerProbe,{},{timeout:3000})
  const result=await page.evaluate(()=>window.__nativePointerProbe)
  if(result.href!=='#/settings') throw Error(`Native pointer missed settings: ${JSON.stringify({point,scale,result})}`)
  await page.getByRole('heading',{name:'设置',exact:true}).waitFor()
  return {check:'native-pointer',scale,point,result}
}
try {
  const path = await app.evaluate(({ app }) => app.getPath('userData'))
  if (realpathSync(path) !== realpathSync(userData)) throw Error(`Unexpected userData: ${path}`)
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '我的课程', exact: true }).waitFor()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.evaluate(async () => {
    const names = ['艺术与审美', '高等数学', '计算机网络', '中国近现代史纲要', '大学英语', '数据库系统', '概率论与数理统计', '现代管理学', '工程伦理', '社会学概论', '人工智能导论', '信息安全', '大学物理', '线性代数', '操作系统', '软件工程', '哲学与人生', '沟通与表达', '职业发展', '创新创业']
    const defaults = (await window.appApi.courses.list()).defaults
    for (const [i, name] of names.entries()) {
      const kind = i % 7 === 0 ? 'mastery' : i % 5 === 0 ? 'map' : 'classic'
      const url = kind === 'mastery' ? `https://studywisdomh5.zhihuishu.com/study/mastery?recruitAndCourseId=native-${i}`
        : kind === 'map' ? `https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/${i+1}/${i+101}?mapUid=native-${i}`
        : `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=native-${i}`
      await window.appApi.courses.create({ name, url, options: { ...defaults, action: kind !== 'mastery' && i % 3 === 0 ? 'learn-transcribe' : 'learn' } })
    }
    const library = await window.appApi.courses.list()
    await window.appApi.courses.select(library.courses[0].id)
    for (const [i, name] of ['每日学习', '周末复习', '英语与艺术'].entries()) await window.appApi.workflows.create({ name, steps: library.courses.slice(i, i + (i ? 3 : 10)).map(c => ({ id: crypto.randomUUID(), courseId: c.id, options: { ...c.options } })), schedule: i === 0 ? { kind: 'daily', enabled: false, time: '09:00', timeZone: 'Asia/Shanghai', nextAt: null } : null })
  })
  const fixture = await page.evaluate(async () => ({ flows: await window.appApi.workflows.list(), library: await window.appApi.courses.list(), settings: await window.appApi.settings.getAll() }))
  const history = new SQLite(join(userData, 'auto_course.db'))
  history.pragma('foreign_keys = ON')
  for (const [i, state] of ['succeeded', 'partial', 'interrupted', 'cancelled'].entries()) {
    const workflow = fixture.flows[i % fixture.flows.length]
    const id = `native-history-${i}`
    const run = { id, workflowId: workflow.id, source: i % 2 ? 'schedule' : 'manual', state,
      startedAt: `2026-10-01T0${i}:00:00Z`, finishedAt: `2026-10-01T0${i}:30:00Z`, message: state === 'partial' ? '部分步骤失败，可查看日志后重新运行。' : '',
      snapshot: { workflow, steps: workflow.steps.map(step => ({ ...step, course: fixture.library.courses.find(c => c.id === step.courseId) })), settings: fixture.settings },
      steps: workflow.steps.map((step, j) => ({ stepId: step.id, state: state === 'succeeded' || j < 2 ? 'succeeded' : state === 'partial' ? 'failed' : state, startedAt: null, finishedAt: null,
        status: { state:'idle', phase:'finished', mode:'classic', currentTitle:'第二章：课程内容与实践', completedCount:3, watchedSeconds:420, stoppedReason:'completed', message:'已完成', tone:'neutral' },
        transcription: step.options.action === 'learn-transcribe' ? { phase:'done', title:'第二章', completed:3, failed:0, message:'转录已完成', tone:'success', percent:null } : null,
        error: state === 'partial' && j >= 2 ? '测试历史记录：课程加载失败' : null })) }
    history.prepare('INSERT INTO workflow_runs VALUES(?,?,?,?,?)').run(id, workflow.id, state, run.startedAt, JSON.stringify(run))
    const event = history.prepare('INSERT INTO workflow_run_events(run_id,data) VALUES(?,?)')
    for (let n=0;n<120;n++) event.run(id, JSON.stringify({time:Date.now()+n,level:n%9===0?'warning':'info',message:`${id} 历史日志 ${n}：课程列表读取完成，准备处理下一个内容。`,workflowId:workflow.id,runId:id,stepId:workflow.steps[0].id}))
  }
  history.close()
  await page.reload()
  for (const size of [{ width: 1180, height: 780 }, { width: 960, height: 640 }]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), size)
    for (const scale of [1, 1.3]) {
      await page.evaluate(scale => window.appApi.settings.update({ uiScale: scale }), scale)
      await page.waitForTimeout(150)
      const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
      if (Math.abs(zoom - scale) > .01) throw Error(`Unexpected zoom ${zoom}`)
      const content = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
      await page.waitForFunction(({scale,content})=>Math.abs(innerWidth*scale-content[0])<=2&&Math.abs(innerHeight*scale-content[1])<=2,{scale,content})
      if(scale===1.3) results.push({...await probeNativePointer(page,scale),size})
      for (const [route, heading] of [['课程', '我的课程'], ['工作流', '工作流'], ['运行', '运行'], ['设置', '设置']]) {
        await activate(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: route, exact: true }), scale)
        await page.getByRole('heading', { name: heading, exact: true }).waitFor()
        if(route === '工作流') await activate(page.getByRole('button', { name: /每日学习/ }), scale)
        if(route === '运行') {
          await page.evaluate(() => { location.hash = '/run?id=native-history-1' })
          await page.locator('.logs pre').filter({hasText:'native-history-1 历史日志'}).waitFor()
          const selectedRow = page.locator('.workspace-list .tool-row[aria-pressed=true]')
          const selectedName = await selectedRow.locator('strong').innerText()
          const detailName = await page.getByRole('region',{name:'运行详情'}).getByRole('heading').first().innerText()
          if(selectedName !== detailName) throw Error(`Run selection mismatch: ${selectedName} / ${detailName}`)
          const selectedStyle = await selectedRow.evaluate(el => ({className:el.className, background:getComputedStyle(el).backgroundColor}))
          results.push({check:'run-selection', size, scale, selectedName, detailName, selectedStyle})
        }
        const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, pageOverflow: document.querySelector('.page').scrollWidth > document.querySelector('.page').clientWidth }))
        if (geometry.horizontalOverflow || geometry.pageOverflow) throw Error(`Overflow on ${route} at ${JSON.stringify({ size, scale, geometry })}`)
        results.push({ route, size, scale, zoom, geometry, activation: scale === 1 ? 'pointer' : 'keyboard-with-DOM-hit-test' })
        // Wait for compositor frames as well as DOM updates before visual evidence.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.waitForTimeout(100)
        await capture(join(output, `${route}-${size.width}-${size.height}-${scale}.png`))
        if (route === '设置') {
          for (const section of ['课程默认配置','转录','外观']) {
            await activate(page.getByRole('button',{name:section,exact:true}),scale)
            await page.locator('.settings-panel h2').filter({hasText:section}).waitFor()
            const footer = page.locator('.settings-footer')
            await footer.evaluate(el=>el.scrollIntoView({block:'end'}))
            const overflow = await page.locator('.page').evaluate(el=>el.scrollWidth>el.clientWidth)
            if (overflow) throw Error(`Overflow in settings ${section}`)
            const footerGeometry = await footer.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}})
            const reachable = footerGeometry.top>=0&&footerGeometry.bottom<=footerGeometry.height+1
            if (!reachable) throw Error(`Settings footer unreachable in ${section}: ${JSON.stringify({size,scale,footerGeometry})}`)
            results.push({check:'settings-section',section,size,scale,footerReachable:reachable})
            await capture(join(output,`设置-${section}-${size.width}-${size.height}-${scale}.png`))
          }
        }
      }
      await activate(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工作流', exact: true }), scale)
      await activate(page.getByRole('button', { name: /每日学习/ }), scale)
      await activate(page.getByRole('button', { name: '编辑', exact: true }), scale)
      const save = page.getByRole('button', { name: '保存工作流', exact: true })
      const reachable = await save.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
      if (!reachable) throw Error('Editor save is outside the viewport')
      await capture(join(output, `editor-${size.width}-${size.height}-${scale}.png`))
      await activate(page.getByRole('button',{name:'每日定时 · 停用',exact:true}),scale)
      await page.getByLabel('时区',{exact:true}).waitFor()
      const scheduleSave = await save.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})
      if (!scheduleSave) throw Error('Schedule pushes editor save outside viewport')
      results.push({check:'editor-schedule',size,scale,saveReachable:scheduleSave})
      await capture(join(output,`editor-schedule-${size.width}-${size.height}-${scale}.png`))
      await activate(page.getByRole('button', { name: '返回', exact: true }), scale)
    }
  }
  if (errors.length) throw Error(errors.join('\n'))
  writeFileSync(join(output, 'audit.json'), JSON.stringify({ userData, taskExecution: false, results, pageErrors: errors }, null, 2))
  console.log(JSON.stringify({ output, userData, checks: results.length, pageErrors: errors }))
} finally { await app.close() }
