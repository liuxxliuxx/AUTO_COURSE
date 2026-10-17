import { randomUUID } from 'node:crypto'
import { join, relative } from 'node:path'
import { mkdir, writeFile, readdir, lstat, rm } from 'node:fs/promises'
import type { Page } from 'playwright-core'
import type { Logger } from './logger'
import { redactSecrets } from './logger'

export interface DiagnosticDetails { reason: string; phase?: string; layer?: { kind: string; description: string }; attempts?: number }
export interface CourseDiagnosticPort {
  capture(page: Page, details: DiagnosticDetails): Promise<string|null>
  finish(): Promise<void>
}
const active = new Set<string>()
let rotation: Promise<void> = Promise.resolve()

async function bounded<T>(work:()=>Promise<T>,timeout:number):Promise<T>{
  let timer:NodeJS.Timeout|undefined
  try{return await Promise.race([Promise.resolve().then(work),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`采集超过 ${timeout}ms`)),timeout)})])}
  finally{clearTimeout(timer)}
}

/** Exception-only evidence. Credentials and browser storage are never serialized. */
export class CourseDiagnostics implements CourseDiagnosticPort {
  private readonly prefix = randomUUID()
  private readonly savedPaths = new Set<string>()
  constructor(private readonly directory: string, private readonly context: {runId:string;stepId?:string|null;accountId?:string;courseId:string}, private readonly log:Logger, private readonly timeouts:{dom?:number;screenshot?:number}={}) { active.add(this.prefix) }
  hasEvidenceIn(message:string):boolean{return [...this.savedPaths].some(path=>message.includes(`（现场：${path}）`))}
  async capture(page:Page|null,details:DiagnosticDetails):Promise<string|null>{
    const folder=join(this.directory,`${this.prefix}-${randomUUID()}`)
    try{await mkdir(folder,{recursive:true,mode:0o700})}
    catch(error){this.log.warn(`无法创建异常现场目录 ${folder}：${redactSecrets(String(error))}`);return null}
    const state={time:new Date().toISOString(),...this.context,...details,url:null as string|null,video:null as unknown,
      captureStatus:'capturing',artifacts:{dom:'pending',screenshot:'pending'},domError:undefined as string|undefined,screenshotError:undefined as string|undefined}
    let saved=false
    const saveState=async():Promise<void>=>{
      try{await writeFile(join(folder,'state.json'),redactSecrets(JSON.stringify(state,null,2)),{mode:0o600});saved=true}
      catch(error){this.log.warn(`异常摘要写入失败 ${folder}：${redactSecrets(String(error))}`)}
    }
    // Write durable metadata before touching the renderer. A closed/hung page must
    // not erase the original error, run identity or the evidence directory.
    await saveState()
    const domTimeout=this.timeouts.dom??3500,screenshotTimeout=this.timeouts.screenshot??5500
    const results=await Promise.allSettled([
      bounded(async()=>{
        if(!page||page.isClosed())throw new Error('课程页面不可用或已关闭')
        return page.locator('html').evaluate(root=>{
        const copy=root.cloneNode(true) as HTMLElement
        copy.querySelectorAll('script,noscript,.video-topic').forEach(el=>el.remove())
        for(const el of Array.from(copy.querySelectorAll('*'))){
          if(el.matches('input,textarea,[contenteditable]')){el.textContent='';el.setAttribute('value','[redacted]')}
          for(const a of Array.from(el.attributes)){
            if(/^on|value|token|secret|password|cookie|authorization|session|username|user-id/i.test(a.name))el.removeAttribute(a.name)
            else if(/^(src|href|action|poster|srcset)$/i.test(a.name))el.removeAttribute(a.name) // offline evidence, no authenticated subresources
          }
        }
        const video=document.querySelector('video')
        const cleanUrl=new URL(location.href);cleanUrl.search='';cleanUrl.hash='';cleanUrl.username='';cleanUrl.password=''
        return {html:'<!doctype html>\n'+copy.outerHTML,url:cleanUrl.toString(),video:video?{current:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null,paused:video.paused,ended:video.ended}:null}
        },undefined,{timeout:Math.min(3000,domTimeout)})
      },domTimeout),
      bounded(async()=>{
        if(!page||page.isClosed())throw new Error('课程页面不可用或已关闭')
        const mask=page.frames().map(frame=>frame.locator('input,textarea,[contenteditable]'))
        // Return bytes first, so a late screenshot cannot write after capture/rotation ends.
        return page.screenshot({timeout:Math.min(5000,screenshotTimeout),mask,animations:'disabled',caret:'hide'})
      },screenshotTimeout)
    ])
    const [dom,screenshot]=results
    try{
      if(dom.status==='rejected')throw dom.reason
      state.url=dom.value.url;state.video=dom.value.video
      await writeFile(join(folder,'dom.html'),redactSecrets(dom.value.html),{mode:0o600})
      state.artifacts.dom='saved';saved=true
    }catch(error){state.artifacts.dom='failed';state.domError=redactSecrets(String(error));this.log.warn(`异常 DOM 采集失败，保留已有文件：${state.domError}`)}
    try{
      if(screenshot.status==='rejected')throw screenshot.reason
      await writeFile(join(folder,'screen.png'),screenshot.value,{mode:0o600})
      state.artifacts.screenshot='saved';saved=true
    }catch(error){state.artifacts.screenshot='failed';state.screenshotError=redactSecrets(String(error));this.log.warn(`异常截图采集失败，保留已有文件：${state.screenshotError}`)}
    state.captureStatus=state.artifacts.dom==='saved'&&state.artifacts.screenshot==='saved'?'complete':'partial'
    await saveState()
    if(!saved){this.log.warn(`异常现场未能写入文件：${folder}`);return null}
    const path=join('diagnostics',relative(this.directory,folder))
    this.savedPaths.add(path)
    this.log.warn(`异常现场${state.captureStatus==='partial'?'部分已保存':'已保存'}：${path}（完整目录：${folder}）`)
    return path
  }
  async finish():Promise<void>{
    active.delete(this.prefix)
    rotation=rotation.catch(()=>{}).then(async()=>{
      await mkdir(this.directory,{recursive:true,mode:0o700})
      const entries=[] as Array<{name:string;time:number}>
      for(const name of await readdir(this.directory)){
        if(!/^[a-f0-9-]{73}$/.test(name))continue
        const info=await lstat(join(this.directory,name))
        if(info.isDirectory()&&!info.isSymbolicLink())entries.push({name,time:info.mtimeMs})
      }
      entries.sort((a,b)=>a.time-b.time)
      let excess=entries.length-100
      for(const entry of entries){
        if(excess<=0)break
        if([...active].some(prefix=>entry.name.startsWith(prefix+'-')))continue
        await rm(join(this.directory,entry.name),{recursive:true,force:true});excess--
      }
    })
    await rotation.catch(error=>this.log.warn(`异常现场轮转失败：${String(error)}`))
  }
}
