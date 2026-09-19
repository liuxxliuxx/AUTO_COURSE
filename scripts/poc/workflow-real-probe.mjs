/** Explicit real-site probe. Requires a disposable copy of the user's database and encrypted credentials. */
import { _electron as electron } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root=resolve(import.meta.dirname,'../..')
const profile=readFileSync('/tmp/ac-workflow-profile-path','utf8').trim()
const app=await electron.launch({args:[root,`--user-data-dir=${profile}`],cwd:root,env:{...process.env,NODE_ENV:'production'}})
let page
const report={startedAt:new Date().toISOString(),starts:[],samples:[],errors:[]}
try {
 page=await app.firstWindow();await page.locator('.brand').waitFor()
 await page.getByRole('heading',{name:'我的课程',exact:true}).waitFor()
 report.starts=await page.evaluate(async()=>{
   const library=await window.appApi.courses.list(),results=[]
   for(const course of library.courses.filter(c=>c.kind!=='unknown').slice(0,2)) {
     const flow=await window.appApi.workflows.create({name:`并行验收 · ${course.name}`,steps:[{id:crypto.randomUUID(),courseId:course.id,options:{...course.options,action:'learn',timeLimitMinutes:1}}],schedule:null})
     results.push({name:course.name,kind:course.kind,...await window.appApi.workflows.start(flow.id)})
   }
   return results
 })
 console.log(JSON.stringify({starts:report.starts}))
 for(let i=0;i<12;i++) {
   await new Promise(r=>setTimeout(r,5000))
   const sample=await page.evaluate(async()=> (await window.appApi.workflows.runs()).map(r=>({id:r.id,name:r.snapshot.workflow.name,state:r.state,steps:r.steps.map(s=>({state:s.state,phase:s.status?.phase,message:s.error??s.status?.message,intervention:s.status?.intervention?.kind,seconds:s.status?.watchedSeconds}))})))
   report.samples.push({at:new Date().toISOString(),runs:sample});console.log(JSON.stringify(report.samples.at(-1)))
   if(sample.every(r=>!['running','stopping'].includes(r.state)))break
 }
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'运行',exact:true}).click()
 await page.screenshot({path:'/tmp/workflow-real-runs.png',fullPage:true})
} catch(e){report.errors.push(String(e));console.error(String(e));process.exitCode=1}
finally {
 if(page)await page.evaluate(async()=>{const runs=await window.appApi.workflows.runs();await Promise.all(runs.filter(r=>['running','stopping'].includes(r.state)).map(r=>window.appApi.workflows.stop(r.id)))}).catch(e=>report.errors.push('stop: '+String(e)))
 await app.close().catch(e=>report.errors.push('close: '+String(e)))
 writeFileSync('/tmp/workflow-real-report.json',JSON.stringify(report,null,2))
}
