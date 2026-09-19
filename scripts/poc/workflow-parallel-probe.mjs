/** Real Electron hosts + production workflow manager; only the course runner uses local fixture content. */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'../..'),profile=mkdtempSync(join(tmpdir(),'ac-parallel-'))
const app=await electron.launch({args:[root,`--user-data-dir=${profile}`],cwd:root,env:{...process.env,NODE_ENV:'production'}})
let page
try {
 page=await app.firstWindow();await page.getByRole('heading',{name:'我的课程',exact:true}).waitFor()
 await app.evaluate((_,root)=>{
   const fs=process.getBuiltinModule('fs'),require=process.getBuiltinModule('module').createRequire(root+'/package.json')
   const chunk=fs.readdirSync(root+'/out/main/chunks').find(f=>f.startsWith('app-main-'))
   const c=require(root+'/out/main/chunks/'+chunk).getContainer()
   globalThis.__probeContexts=new Map()
   c.setRunnerFactory(()=>({mode:'classic',async run(ctx){
     const name=ctx.settings.courseNote
     await ctx.session.page.setContent('<label>Fixture<input id="value"></label>')
     await ctx.session.page.locator('#value').fill(name)
     await ctx.session.page.context().addCookies([{name:'workflow',value:name,domain:'workflow.test',path:'/'}])
     globalThis.__probeContexts.set(name,ctx)
     ctx.reportPhase('executing');ctx.log.info('fixture '+name)
     if(name==='parallel-A')await ctx.requestCaptcha('login','local fixture intervention','manual-login')
     while(!ctx.shouldStop()){await new Promise(r=>setTimeout(r,100));ctx.reportVideoWatched(.1)}
     return {reason:'user',completedCount:0,watchedSeconds:ctx.sessionWatchedSeconds()}
   }}))
 },root)
 const results=await page.evaluate(async()=>{
   await window.appApi.credentials.set({username:'local-fixture',password:'local-fixture'})
   await window.appApi.settings.update({loginMethod:'zhihuishu',transcribeEnabled:false})
   const results=[]
   for(const name of ['parallel-A','parallel-B']){
     const result=await window.appApi.courses.create({name,url:'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId='+name,options:{action:'learn',startPosition:'resume',skipCompleted:true,timeLimitMinutes:0}})
     if(!result.ok)throw Error(result.message)
     const flow=await window.appApi.workflows.create({name,steps:[{id:crypto.randomUUID(),courseId:result.courseId,options:{action:'learn',startPosition:'resume',skipCompleted:true,timeLimitMinutes:0}}],schedule:null})
     results.push(await window.appApi.workflows.start(flow.id))
   }
   return results
 })
 assert(results.every(r=>r.ok))
 await page.waitForFunction(async()=>{
   const runs=await window.appApi.workflows.runs()
   return runs.filter(r=>r.state==='running').length===2&&runs.some(r=>r.steps[0].status?.intervention)&&runs.some(r=>(r.steps[0].status?.watchedSeconds??0)>.2)
 },null,{timeout:60000})
 const data=await app.evaluate(async()=>Promise.all([...globalThis.__probeContexts.entries()].map(async([name,ctx])=>({name,value:await ctx.session.page.locator('#value').inputValue(),cookies:(await ctx.session.page.context().cookies('https://workflow.test')).map(c=>c.value)}))))
 assert.equal(data.length,2)
 for(const row of data){assert.equal(row.value,row.name);assert.deepEqual(row.cookies,[row.name])}
 console.log('PASS: two actual browser hosts execute in parallel; inputs and cookies are isolated')
 const runs=await page.evaluate(()=>window.appApi.workflows.runs()),a=runs.find(r=>r.snapshot.workflow.name==='parallel-A'),b=runs.find(r=>r.snapshot.workflow.name==='parallel-B')
 const before=b.steps[0].status.watchedSeconds
 await page.evaluate(async a=>{const step=a.steps[0];await window.appApi.workflows.confirm(a.id,step.stepId,step.status.intervention.id)},a)
 await page.waitForFunction(async id=>!(await window.appApi.workflows.run(id)).steps[0].status?.intervention,a.id)
 await page.evaluate(id=>window.appApi.workflows.stop(id),a.id)
 await page.waitForFunction(async({id,before})=>{const run=await window.appApi.workflows.run(id);return run.state==='running'&&run.steps[0].status.watchedSeconds>before},{id:b.id,before})
 console.log('PASS: intervention and stopping A leave B running')
 for(const run of [a,b]){
   const logs=await page.evaluate(id=>window.appApi.workflows.logs(id),run.id)
   assert(logs.some(l=>l.message==='fixture '+run.snapshot.workflow.name));assert(logs.every(l=>l.runId===run.id))
 }
 await page.evaluate(id=>window.appApi.workflows.stop(id),b.id)
 const after=await page.evaluate(()=>window.appApi.workflows.runs());assert(after.filter(r=>['running','stopping'].includes(r.state)).length===0)
 console.log('PASS: scoped logs persisted and both hosts stopped')
}finally{
 if(page)await page.evaluate(async()=>{for(const r of await window.appApi.workflows.runs())if(['running','stopping'].includes(r.state))await window.appApi.workflows.stop(r.id)}).catch(()=>{})
 await app.close();rmSync(profile,{recursive:true,force:true})
}
