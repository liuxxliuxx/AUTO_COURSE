import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountService } from '../../src/main/services/account-service'
import { CourseService } from '../../src/main/services/course-service'
import { SettingsService } from '../../src/main/services/settings-service'
import { addLogSink } from '../../src/main/services/logger'
import { Database } from '../../src/main/storage/database'
import { WorkflowService } from '../../src/main/workflows/workflow-service'
import { WorkflowRunManager } from '../../src/main/workflows/workflow-run-manager'
import { RunRepository } from '../../src/main/workflows/run-repository'
import { createWorkflowRuntime } from '../../src/main/workflows/workflow-runtime'
import { DEFAULT_COURSE_OPTIONS } from '../../src/shared/courses'
import type { RunnerContext, RunOutcome } from '../../src/main/automation/runner'
import type { SttWorkerOptions } from '../../src/main/services/stt-worker'
const fixture = vi.hoisted(()=>({
  browsers:[] as Array<{profile:string;closed:boolean}>,
  sequence:[] as string[],
  folders:[] as string[],
  cleanup:null as null|(()=>Promise<void>)
}))
vi.mock('electron',()=>({safeStorage:{isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(value:Buffer)=>value.toString()}}))
vi.mock('../../src/main/automation/browser-service',()=>({BrowserService:class {
  record:{profile:string;closed:boolean}
  constructor(options:{profileDir:string}){this.record={profile:options.profileDir,closed:false};fixture.browsers.push(this.record)}
  async openSession(){fixture.sequence.push(`open:${this.record.profile}`);return {}}
  async close(){fixture.sequence.push(`close:${this.record.profile}`);this.record.closed=true}
  dispose(){}
  async ensureSession(){}
  async focusCourseWindow(){}
}}))
vi.mock('../../src/main/services/transcription-service',()=>({TranscriptionService:class {
  async configure(_settings:unknown,_only:boolean,folder:string){fixture.folders.push(folder);return true}
  async dispose(){await fixture.cleanup?.()}
  getStatus(){return {message:'fixture'}}
}}))
let dir:string, db:Database, accounts:AccountService, courses:CourseService, settings:SettingsService, flows:WorkflowService, manager:WorkflowRunManager
let work:(ctx:RunnerContext)=>Promise<RunOutcome>
const contexts:RunnerContext[]=[]
beforeEach(()=>{
  dir=mkdtempSync(join(tmpdir(),'ac-runtime-'));db=new Database(':memory:');settings=new SettingsService(db)
  accounts=new AccountService(db,dir,()=>manager?.occupiedAccounts()??[])
  courses=new CourseService(db,settings,()=>manager?.occupiedCourses()??[])
  flows=new WorkflowService(db,courses,id=>manager?.isActive(id)??false,accounts)
  fixture.browsers=[];fixture.sequence=[];fixture.folders=[];fixture.cleanup=null;contexts.length=0
  work=async()=>({reason:'completed',completedCount:1,watchedSeconds:0})
  manager=new WorkflowRunManager(flows,courses,settings,accounts,new RunRepository(db),(run,report)=>createWorkflowRuntime(run,report,{
    db,accounts,courses,settingsService:settings,userData:dir,worker:{} as SttWorkerOptions,
    runnerFactory:()=>()=>({mode:'classic',run:async ctx=>{contexts.push(ctx);return work(ctx)}})
  }))
})
afterEach(async()=>{fixture.cleanup=null;await manager.dispose();db.close();rmSync(dir,{recursive:true,force:true})})
function account(name:string,loginMethod:'zhihuishu'|'upc-institution'='zhihuishu') {return accounts.create({name,username:name,password:`password-${name}`,loginMethod,loggedUrl:''})}
function course(){const result=courses.create({name:'共享课',url:'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=shared',options:{...DEFAULT_COURSE_OPTIONS}});if(!result.ok)throw Error(result.message);return result.courseId!}
const done=async()=>vi.waitFor(()=>expect(manager.occupiedAccounts()).toEqual([]))
describe('multi-account execution',()=>{
  it('获取课程占用账号直到释放，期间禁止同账号任务和清理缓存', async () => {
    const a = account('discovery'), courseId = course()
    const flow = flows.create({ name: 'discover', steps: [{ id: 'step', accountId: a.id, courseId, options: DEFAULT_COURSE_OPTIONS }], schedule: null })
    const release = manager.reserveAccount(a.id)
    expect(() => manager.reserveAccount(a.id)).toThrow('账号正在运行')
    expect(manager.start(flow.id).ok).toBe(false)
    await expect(manager.withMaintenance(async () => {})).rejects.toThrow('课程获取')
    release()
    expect(manager.start(flow.id).ok).toBe(true)
    await done()
  })
  it('runs the same course concurrently for different accounts, isolates profiles and progress, and rejects account overlap',async()=>{
    const a=account('A'),b=account('B'),courseId=course(),release:Array<()=>void>=[]
    work=async ctx=>{ctx.reportVideoCompleted(`${ctx.credentials.username} chapter`);await new Promise<void>(r=>release.push(r));return {reason:'completed',completedCount:1,watchedSeconds:0}}
    const flow=(accountId:string)=>flows.create({name:accountId,steps:[{id:'step',accountId,courseId,options:DEFAULT_COURSE_OPTIONS}],schedule:null})
    const first=flow(a.id),second=flow(b.id)
    expect(manager.start(first.id).ok).toBe(true);expect(manager.start(second.id).ok).toBe(true)
    expect(manager.start(flow(a.id).id)).toMatchObject({ok:false,message:expect.stringContaining('账号')})
    await vi.waitFor(()=>expect(release).toHaveLength(2))
    expect(fixture.browsers.map(b=>b.profile)).toEqual(expect.arrayContaining([accounts.profileDir(a.id),accounts.profileDir(b.id)]))
    expect(accounts.continuation(a.id,courseId)).toBe('A chapter');expect(accounts.continuation(b.id,courseId)).toBe('B chapter')
    expect(new Set(fixture.folders).size).toBe(2)
    release.forEach(r=>r());await done();expect(fixture.browsers.every(b=>b.closed)).toBe(true)
    expect(JSON.stringify(manager.repository.list())).not.toContain('password-')
  })
  it('switches account credentials and login method in order, closes prior resources and reads pair progress at execution time',async()=>{
    const a=account('A'),b=account('B','upc-institution'),courseId=course()
    work=async ctx=>{ctx.reportVideoCompleted(`${ctx.credentials.username} chapter`);return {reason:'completed',completedCount:1,watchedSeconds:0}}
    const flow=flows.create({name:'切换',steps:[a,b,a].map((account,index)=>({id:`step-${index}`,accountId:account.id,courseId,options:{...DEFAULT_COURSE_OPTIONS,startPosition:'resume'}})),schedule:null})
    expect(manager.start(flow.id).ok).toBe(true);await done()
    expect(contexts.map(c=>c.credentials.username)).toEqual(['A','B','A'])
    expect(contexts.map(c=>c.settings.loginMethod)).toEqual(['zhihuishu','upc-institution','zhihuishu'])
    expect(contexts.map(c=>c.lastVideoTitle)).toEqual(['','','A chapter'])
    expect(fixture.sequence).toEqual([`open:${accounts.profileDir(a.id)}`,`close:${accounts.profileDir(a.id)}`,`open:${accounts.profileDir(b.id)}`,`close:${accounts.profileDir(b.id)}`,`open:${accounts.profileDir(a.id)}`,`close:${accounts.profileDir(a.id)}`])
  })
  it('reserves all accounts and freezes their configuration and credentials before the first step starts',async()=>{
    const a=account('A'),b=account('B'),courseId=course()
    const flow=flows.create({name:'冻结',steps:[a,b].map((account,i)=>({id:`s${i}`,accountId:account.id,courseId,options:DEFAULT_COURSE_OPTIONS})),schedule:null})
    const mutable={username:'B',password:'frozen-password'}
    const original=accounts.credentials.bind(accounts)
    vi.spyOn(accounts,'credentials').mockImplementation(id=>id===b.id?mutable:original(id))
    expect(manager.start(flow.id).ok).toBe(true)
    expect(manager.occupiedAccounts().sort()).toEqual([a.id,b.id].sort())
    expect(()=>accounts.update(b.id,{...b,name:'改变'})).toThrow('正在运行')
    mutable.password='new-password';db.raw().prepare("UPDATE accounts SET login_method='upc-institution' WHERE id=?").run(b.id)
    await done()
    expect(contexts[1].credentials.password).toBe('frozen-password');expect(contexts[1].settings.loginMethod).toBe('zhihuishu')
  })
  it('holds accounts through shutdown and releases them only after media and browser cleanup completes',async()=>{
    const a=account('A'),courseId=course()
    work=async ctx=>{await ctx.requestCaptcha('login','fixture','manual-login');return {reason:ctx.shouldStop()?'user':'completed',completedCount:0,watchedSeconds:0}}
    const flow=flows.create({name:'停止',steps:[{id:'step',accountId:a.id,courseId,options:DEFAULT_COURSE_OPTIONS}],schedule:null})
    const result=manager.start(flow.id);if(!result.ok)throw Error(result.message)
    await vi.waitFor(()=>expect(manager.repository.get(result.runId)?.steps[0].status?.intervention).toBeTruthy())
    let release!:()=>void
    fixture.cleanup=()=>new Promise<void>(resolve=>{release=resolve})
    const stopping=manager.stop(result.runId)
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
    expect(manager.occupiedAccounts()).toContain(a.id);expect(manager.start(flow.id).ok).toBe(false)
    release();await stopping;expect(manager.occupiedAccounts()).toEqual([]);expect(fixture.browsers[0].closed).toBe(true)
  })
  it('releases reservations after factory failure and failed step cleanup still closes its browser',async()=>{
    const a=account('A'),courseId=course(),flow=flows.create({name:'失败',steps:[{id:'step',accountId:a.id,courseId,options:DEFAULT_COURSE_OPTIONS}],schedule:null})
    const broken=new WorkflowRunManager(flows,courses,settings,accounts,new RunRepository(db),()=>{throw Error('factory failed')})
    expect(broken.start(flow.id)).toMatchObject({ok:false});expect(broken.occupiedAccounts()).toEqual([])
    fixture.cleanup=async()=>{throw Error('media cleanup failed')}
    expect(manager.start(flow.id).ok).toBe(true);await done()
    expect(fixture.browsers[0].closed).toBe(true);expect(manager.repository.list().some(r=>r.state==='failed')).toBe(true)
  })
  it('redacts passwords from automation exceptions, emitted logs and persisted status',async()=>{
    const a=account('A'),courseId=course(),logs:string[]=[]
    const off=addLogSink((_level,message,context)=>logs.push(JSON.stringify({message,context})))
    const stderr=vi.spyOn(process.stderr,'write').mockReturnValue(true)
    try {
      work=async ctx=>{ctx.log.error(`locator.fill("${ctx.credentials.password}") failed`);throw Error(`Playwright input: ${ctx.credentials.password}`)}
      const flow=flows.create({name:'脱敏',steps:[{id:'step',accountId:a.id,courseId,options:DEFAULT_COURSE_OPTIONS}],schedule:null})
      expect(manager.start(flow.id).ok).toBe(true);await done()
      expect(JSON.stringify(manager.repository.list())).not.toContain('password-A')
      expect(logs.join('')).not.toContain('password-A');expect(logs.join('')).toContain('[已隐藏]')
      expect(JSON.stringify(stderr.mock.calls)).not.toContain('password-A')
      expect(manager.repository.list()[0].steps[0].error).toContain('[已隐藏]')
    } finally {off();stderr.mockRestore()}
  })

})
