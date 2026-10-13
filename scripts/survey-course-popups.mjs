/** Live DOM survey with no CourseRunner or automatic popup dismissal.
 * node scripts/survey-course-popups.mjs <private-config.json>
 * Send commands via command.json (see docs/POPUP_SURVEY.md).
 * Keep output under output/playwright; credentials, headers and response values are never recorded.
 */
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if(!process.argv[2]){
  console.error('Usage: node scripts/survey-course-popups.mjs <private-config.json>')
  process.exit(2)
}
const configPath = resolve(process.argv[2])
const config = JSON.parse(readFileSync(configPath,'utf8'))
if(!config.profile||!config.course?.url||!/^https?:/.test(config.course.url))throw new Error('Provide a temporary profile and an HTTP(S) course URL')
const output = dirname(configPath)
const commandFile = join(output,'command.json')
mkdirSync(output,{recursive:true,mode:0o700})
const cleanUrl = value => { try { const u=new URL(value); return u.origin+u.pathname+(u.search ? '?'+[...new Set(u.searchParams.keys())].map(k=>encodeURIComponent(k)+'=[redacted]').join('&') : '') } catch { return '[non-http URL]' } }
const schema = (value,depth=0) => depth>3 ? typeof value : Array.isArray(value) ? {array:value.length,item:value.length?schema(value[0],depth+1):null} : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).slice(0,80).map(([k,v])=>[k,schema(v,depth+1)])) : typeof value
const event = data => appendFileSync(join(output,'events.jsonl'),JSON.stringify({time:new Date().toISOString(),...data})+'\n',{mode:0o600})
const app = await _electron.launch({executablePath:require('electron'),args:[root,'--browser-host',`--profile-dir=${config.profile}`,`--download-dir=${join(output,'downloads')}`],cwd:root,env:{...process.env}})
let page,serial=Math.max(0,...readdirSync(output).filter(name=>/^\d+-/.test(name)).map(name=>Number(name.split('-')[0]))),stopped=false
const seen = new Set()
const inspect = () => {
  const visible = el => {
    const r=el.getBoundingClientRect()
    if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false
    for(let n=el;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false}
    return true
  }
  const rect = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
  const describe = el => ({tag:el.tagName.toLowerCase(),id:el.id,class:typeof el.className==='string'?el.className:'',role:el.getAttribute('role'),label:el.getAttribute('aria-label'),text:(el.innerText||'').trim().slice(0,1800),rect:rect(el),zIndex:getComputedStyle(el).zIndex,position:getComputedStyle(el).position})
  const known='[role="dialog"],[aria-modal="true"],.el-dialog,.el-message-box,.dialog-read,.ss2077-msg-custom,.ss2077-msg-bg,.yidun_popup,.yidun_modal,#tcaptcha_transform_dy,#lPwdError,[class*="captcha" i],.ai-draggable-dialog,.aiMsg,.exploreTip,.classmsgDialog,iframe'
  const candidates=[...document.querySelectorAll(known)].filter(visible)
  for(const el of document.querySelectorAll('body *')){
    if(el.closest('.video-topic')||!['DIV','SECTION','ASIDE'].includes(el.tagName)||!visible(el))continue
    const s=getComputedStyle(el),r=el.getBoundingClientRect()
    if(['fixed','absolute'].includes(s.position)&&r.width>=120&&r.height>=60&&+s.zIndex>=10&&/提示|欢迎|学习时间|考试时间|考核比|学习进度|验证码|测验|学前必读/.test(el.innerText||''))candidates.push(el)
  }
  const panels=[...new Set(candidates)].map(el=>({...describe(el),controls:[...el.querySelectorAll('button,a,i,[role="button"],[class*="close" i],[class*="btn" i]')].filter(visible).slice(0,30).map(describe)}))
  const v=document.querySelector('video')
  const controls=[...document.querySelectorAll('button,[role="button"],li.video,.vjs-big-play-button,.el-dialog__headerbtn')].filter(visible).slice(0,100).map(describe)
  const obstruction=[]
  for(const el of document.querySelectorAll('video,li.video.current_play')){
    const r=el.getBoundingClientRect(),points=[]
    for(const [px,py] of [[.5,.5],[.1,.1],[.9,.9]]){const x=r.x+r.width*px,y=r.y+r.height*py,hit=document.elementFromPoint(x,y);points.push({x,y,hit:hit?describe(hit):null})}
    obstruction.push({target:describe(el),points})
  }
  const inventory=[...document.querySelectorAll(known)].map(el=>({...describe(el),visible:visible(el)}))
  return {title:document.title,panels,inventory,controls,obstruction,video:v?{current:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ended:v.ended}:null}
}
const capture = async label => {
  try {
  const state=await page.evaluate(inspect)
  const id=String(++serial).padStart(3,'0')+'-'+label.replace(/[^a-zA-Z0-9-]/g,'-').slice(0,50)
  const folder=join(output,id);mkdirSync(folder,{mode:0o700})
  await page.screenshot({path:join(folder,'screen.png'),timeout:10000})
  // Clone the DOM: strip embedded script/state, form contents and sensitive attributes.
  const html=await page.evaluate(()=>{
    const clone=document.documentElement.cloneNode(true)
    clone.querySelectorAll('script,noscript,.video-topic').forEach(el=>el.remove())
    for(const el of clone.querySelectorAll('*')){
      for(const attr of [...el.attributes]){
        if(/value|token|secret|password|authorization|cookie|^on/i.test(attr.name))el.removeAttribute(attr.name)
        else if(/^(href|src|action)$/i.test(attr.name)&&attr.value.includes('?'))el.setAttribute(attr.name,attr.value.split('?')[0]+'?[redacted]')
      }
      if(el.matches('input,textarea')){el.textContent='';el.removeAttribute('value')}
    }
    return '<!doctype html>\n'+clone.outerHTML
  })
  // Keep HTML evidence only in the sanitized DOM copy.
  state.frames=[]
  for(const frame of page.frames().filter(f=>f!==page.mainFrame())){
    try{state.frames.push({url:cleanUrl(frame.url()),state:await frame.evaluate(inspect)})}catch{state.frames.push({url:cleanUrl(frame.url()),unavailable:true})}
  }
  writeFileSync(join(folder,'state.json'),JSON.stringify({...state,url:cleanUrl(page.url())},null,2),{mode:0o600})
  writeFileSync(join(folder,'dom.html'),html,{mode:0o600})
  writeFileSync(join(output,'latest.json'),JSON.stringify({...state,sample:id,url:cleanUrl(page.url())},null,2),{mode:0o600})
  event({type:'sample',id,panels:state.panels.length,video:state.video})
  console.log(JSON.stringify({sample:id,panels:state.panels.map(p=>({class:p.class,text:p.text.slice(0,140)})),video:state.video}))
  } catch { event({type:'capture-deferred',reason:'page changed during capture',label}) }
}
try {
  page=await app.firstWindow({timeout:30000})
  page.on('response',async response=>{
    const request=response.request(),url=request.url()
    if(!/^https?:/.test(url))return
    const relevant=/captcha|yidun|turing|cstaticdun|necaptcha|verify|quiz|question|topic|popup|dialog|progress|study|learn|save|heartbeat/i.test(url)
    const data={type:'network',url:cleanUrl(url),method:request.method(),status:response.status(),resource:request.resourceType()}
    if(relevant){
      try {const body=request.postData();if(body){try{data.requestSchema=schema(JSON.parse(body))}catch{
        data.requestFields=/application\/x-www-form-urlencoded/i.test(request.headers()['content-type']??'')?[...new URLSearchParams(body).keys()].filter(key=>/^[a-zA-Z_][a-zA-Z0-9_.-]{0,79}$/.test(key)):['[unparsed-body]']
      }}}catch{}
      if(/json/i.test(response.headers()['content-type']||'')){try{data.responseSchema=schema(await response.json())}catch{}}
    }
    event(data)
  })
  page.on('requestfailed',request=>event({type:'requestfailed',url:cleanUrl(request.url()),error:request.failure()?.errorText}))
  page.on('pageerror',error=>event({type:'pageerror',name:error.name}))
  page.on('dialog',async dialog=>{event({type:'native-dialog',kind:dialog.type(),message:dialog.message().slice(0,500)});console.log('Native dialog awaiting manual handling')})
  await page.goto(config.course.url,{waitUntil:'domcontentloaded',timeout:60000})
  await capture('initial')
  const deadline=Date.now()+25*60*1000
  while(!stopped&&Date.now()<deadline){
    if(existsSync(commandFile)){
      const command=JSON.parse(readFileSync(commandFile,'utf8'));unlinkSync(commandFile)
      try{
        if(command.action==='stop')stopped=true
        else if(command.action==='login'){
          const service=new URL('http://upcsso.zhihuishu.com/authorize')
          for(const [k,v] of Object.entries({portal:'14',response_type:'code',scope:'read',client_id:'zhihuishuupc',redirect_uri:'http://oc.zhihuishu.com/oauth/callback/upc',state:'09876999'}))service.searchParams.set(k,v)
          const cas=new URL('https://cas.upc.edu.cn/cas/login');cas.searchParams.set('service',service.toString())
          await page.goto(cas.toString(),{waitUntil:'domcontentloaded',timeout:60000})
          if(new URL(page.url()).hostname==='cas.upc.edu.cn'){
            const credentials=await app.evaluate(({safeStorage},file)=>JSON.parse(safeStorage.decryptString(process.getBuiltinModule('fs').readFileSync(file))),config.credentialFile)
            await page.locator('form#loginForm').waitFor({state:'attached',timeout:10000})
            await page.locator('form#loginForm').evaluate((form,c)=>{form.elements.namedItem('username').value=c.username;form.elements.namedItem('password').value=c.password;form.requestSubmit(form.querySelector('input[type="submit"]')??undefined)},credentials)
            credentials.username='';credentials.password=''
            await page.waitForTimeout(5000)
          }
          await capture('after-institution-login')
          if(!['cas.upc.edu.cn','login.zhihuishu.com'].includes(new URL(page.url()).hostname)){
            await page.goto(config.course.url,{waitUntil:'domcontentloaded',timeout:60000})
            await capture('course-after-login')
          }
        }
        else if(command.action==='capture')await capture('manual')
        else if(command.action==='runtime'){
          const runtime=await page.evaluate(()=>{
            const vm=document.querySelector('.video-study')?.__vue__
            if(!vm)return {found:false}
            const symbols=typeof window.a1_0x4489==='function'?Object.fromEntries([0x4404,0x3eed,0xa7d,0x30a1,0x4fcf,0x26f7,0x3edf,0x429c].map(key=>[key.toString(16),window.a1_0x4489(key)])):null
            return {found:true,symbols,methods:Object.keys(vm.$options.methods??{}),state:Object.fromEntries(Object.entries(vm.$data??{}).filter(([key])=>/dialog|popup|captcha|yidun|topic|question|read|show|msg/i.test(key)).map(([key,value])=>[key,typeof value==='boolean'||typeof value==='number'?value:typeof value]))}
          })
          writeFileSync(join(output,'runtime.json'),JSON.stringify(runtime,null,2),{mode:0o600})
        }
        else if(command.action==='captcha-once'){
          const marker=join(output,'captcha-observation-triggered')
          if(existsSync(marker))throw new Error('Only one explicit captcha observation is allowed per survey')
          writeFileSync(marker,new Date().toISOString(),{mode:0o600})
          await capture('before-captcha-trigger')
          const result=await page.evaluate(async()=>{
            const vm=document.querySelector('.video-study')?.__vue__
            if(!vm||typeof vm.popupYidunInstance!=='function'){
              if(typeof window.initAbleYidunFallback!=='function')return {triggered:false,reason:'site SDK unavailable'}
              // Same public integration and capType as the observed course bundle.
              // Observe one challenge only; no automatic solution or token submission.
              return Promise.race([new Promise(resolve=>window.initAbleYidunFallback({showPop:true,enableClose:1,capType:'space',captchaIns:instance=>{instance.popUp();resolve({triggered:true,via:'site SDK'})},onSuccessAble:()=>{}})),new Promise(resolve=>setTimeout(()=>resolve({triggered:false,reason:'initialization timed out'}),20000))])
            }
            if(!vm.yidunInstance){
              if(typeof vm.capinitAbleYidunFallback!=='function')return {triggered:false}
              const created=await Promise.race([vm.capinitAbleYidunFallback(),new Promise(resolve=>setTimeout(()=>resolve(null),20000))])
              if(!created?.instance)return {triggered:false,reason:'instance initialization timed out'}
              vm.yidunInstance=created.instance;vm.logInstance=created.logFn
            }
            vm.popupYidunInstance();return {triggered:true}
          })
          event({type:'explicit-captcha-observation',...result})
          await capture('after-captcha-trigger')
        }
        else if(command.action==='fail-next-progress'){
          await capture('before-progress-fault')
          await page.route('**/learning/save*',async route=>{
            event({type:'local-fault-injected',url:cleanUrl(route.request().url()),response:{code:-1,message:'Local diagnostic response'}})
            await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:-1,message:'Local diagnostic response',data:null})})
          },{times:1})
          event({type:'local-fault-armed',target:'/learning/save*',count:1})
        }
        else if(command.action==='hover'){await page.locator(command.selector).hover({timeout:5000});await capture('after-hover')}
        else if(command.action==='click'){await capture('before-click');await page.locator(command.selector).click({timeout:5000});await capture('after-click')}
        else if(command.action==='play'){await page.locator('video').evaluate(v=>v.play());await capture('after-play')}
        else if(command.action==='seek'){await capture('before-seek');await page.locator('video').evaluate((v,t)=>{v.currentTime=t},command.seconds);await capture('after-seek')}
        else if(command.action==='reload'){await capture('before-reload');await page.reload({waitUntil:'domcontentloaded'});await capture('after-reload')}
      }catch(error){event({type:'command-error',action:command.action,message:command.action==='login'?'Login failed; sensitive exception omitted':String(error).slice(0,300)});console.log('Command failed:',command.action)}
    }
    const state=await page.evaluate(inspect).catch(()=>null)
    if(!state){await page.waitForTimeout(1000).catch(()=>{});continue}
    const key=createHash('sha256').update(JSON.stringify(state.panels.map(p=>({tag:p.tag,class:p.class,text:p.text,controls:p.controls.map(c=>c.text)})))).digest('hex')
    if(!seen.has(key)&&seen.size<60){seen.add(key);await capture('layer-change')}
    await page.waitForTimeout(1500)
  }
  await capture('final')
} finally { await app.close().catch(()=>{}) }
