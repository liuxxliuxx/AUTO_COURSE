import { randomUUID } from 'node:crypto'
import { join, relative } from 'node:path'
import { mkdir, writeFile, readdir, lstat, rm } from 'node:fs/promises'
import type { Page } from 'playwright-core'
import type { Logger } from './logger'
import { redactSecrets } from './logger'

export interface DiagnosticDetails { reason: string; layer?: { kind: string; description: string }; attempts?: number }
export interface CourseDiagnosticPort {
  capture(page: Page, details: DiagnosticDetails): Promise<string|null>
  finish(): Promise<void>
}
const active = new Set<string>()
let rotation: Promise<void> = Promise.resolve()

/** Exception-only evidence. Credentials and browser storage are never serialized. */
export class CourseDiagnostics implements CourseDiagnosticPort {
  private readonly prefix = randomUUID()
  constructor(private readonly directory: string, private readonly context: {runId:string;stepId?:string|null;accountId?:string;courseId:string}, private readonly log:Logger) { active.add(this.prefix) }
  async capture(page:Page,details:DiagnosticDetails):Promise<string|null>{
    const folder=join(this.directory,`${this.prefix}-${randomUUID()}`)
    try{
      await mkdir(folder,{recursive:true,mode:0o700})
      const data=await page.locator('html').evaluate(root=>{
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
      },undefined,{timeout:3000})
      const mask=page.frames().map(frame=>frame.locator('input,textarea,[contenteditable]'))
      await page.screenshot({path:join(folder,'screen.png'),timeout:3000,mask})
      await writeFile(join(folder,'dom.html'),redactSecrets(data.html),{mode:0o600})
      await writeFile(join(folder,'state.json'),redactSecrets(JSON.stringify({time:new Date().toISOString(),...this.context,...details,url:data.url,video:data.video},null,2)),{mode:0o600})
      const path=join('diagnostics',relative(this.directory,folder))
      this.log.warn(`异常现场已保存：${path}`)
      return path
    }catch(error){
      this.log.warn(`无法保存异常现场：${redactSecrets(String(error))}`)
      await rm(folder,{recursive:true,force:true}).catch(()=>{})
      return null
    }
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
