import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, type Browser, type Page } from 'playwright-core'
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { BotService } from '../../src/main/services/bot-service'
import { Database } from '../../src/main/storage/database'
import { SettingsService } from '../../src/main/services/settings-service'
import { CourseService } from '../../src/main/services/course-service'
import { EventBus } from '../../src/main/services/event-bus'
import { BrowserSession } from '../../src/main/automation/browser-session'
import { DEFAULT_COURSE_OPTIONS, settingsForCourse } from '../../src/shared/courses'
import type { BrowserService } from '../../src/main/automation/browser-service'

let browser:Browser,page:Page,directory:string,db:Database
beforeAll(async()=>{browser=await chromium.launch()})
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'ac-bot-evidence-'));page=await browser.newPage();await page.setContent('<p>现场页面</p>');db=new Database(':memory:')})
afterEach(async()=>{await page.close();db.close();await rm(directory,{recursive:true,force:true})})
afterAll(async()=>{await browser.close()})

describe('terminal diagnostics before workflow browser cleanup',()=>{
  it.each(['login-result','runner-throws','media-throws','launch-throws','already-captured','stale-reference','closed-page','user-stop'])('%s',async kind=>{
    const settings=new SettingsService(db),courses=new CourseService(db,settings,()=>[])
    const created=courses.create({name:'fixture',url:'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=fixture',options:{...DEFAULT_COURSE_OPTIONS}})
    if(!created.ok)throw new Error(created.message)
    const course=courses.get(created.courseId!)!
    const session=new BrowserSession(page,()=>{})
    const host={openSession:async()=>{if(kind==='launch-throws')throw new Error('launch failed');return session}} as unknown as BrowserService
    const bot=new BotService(db,{get:()=>({username:'fixture',password:'password'})},settings,new EventBus(),host,()=>({mode:'classic',run:async ctx=>{
      if(kind==='runner-throws')throw new Error('unexpected runner failure')
      if(kind==='closed-page'){await page.close();throw new Error('page closed unexpectedly')}
      if(kind==='user-stop')return {reason:'user',completedCount:0,watchedSeconds:0}
      const path=kind==='already-captured'?await ctx.diagnostics!.capture(page,{reason:'login rejected'}):kind==='stale-reference'?'diagnostics/nonexistent':null
      return {reason:'error',completedCount:0,watchedSeconds:0,error:{stage:'login',code:'login',message:'login rejected'+(path?`（现场：${path}）`:'')}}
    }}),async()=>{if(kind==='media-throws')throw new Error('media failed');return null},courses,undefined,directory)
    const status=await bot.execute({id:'snapshot',course,settings:settingsForCourse(settings.getAll(),course),source:'manual',startedAt:new Date().toISOString()},{username:'fixture',password:'password'})
    expect(page.isClosed()).toBe(kind==='closed-page')
    if(kind==='user-stop'){expect(await readdir(directory)).toEqual([]);return}
    const folders=await readdir(directory)
    expect(folders).toHaveLength(1)
    const folder=join(directory,folders[0]),state=JSON.parse(await readFile(join(folder,'state.json'),'utf8'))
    expect(state).toMatchObject({runId:'snapshot',courseId:course.id,captureStatus:['launch-throws','closed-page'].includes(kind)?'partial':'complete'})
    expect(status.error?.message).toContain('现场：diagnostics')
    if(!['launch-throws','closed-page'].includes(kind))expect((await readFile(join(folder,'screen.png'))).length).toBeGreaterThan(0)
    // Closing/disposing the failed step must preserve its evidence.
    await bot.dispose();await page.close()
    expect(await readdir(directory)).toEqual(folders)
  })
})
