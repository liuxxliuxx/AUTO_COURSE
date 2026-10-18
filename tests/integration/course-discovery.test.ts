import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { CourseDiscoveryNavigator } from '../../src/main/automation/course-discovery'
import { DEFAULT_LOGGED_URL } from '../../src/main/automation/constants'

let browser: Browser
const pages: Page[] = []
beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }) })
afterEach(async () => { await Promise.all(pages.splice(0).map(p => p.context().close())) })
afterAll(async () => { await browser?.close() })
async function page(): Promise<Page> { const p = await browser.newPage(); pages.push(p); return p }
const term = '2026年秋冬学期'
const classic = (id: string): string => `https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=${id}`
const map = (id: string): string => `https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/${id}/9`

describe('课程主页与学习进度', () => {
  it('首门已完成，返回主页的学期选项延迟到达时仍能继续找到其余三门课', async () => {
    const p = await page()
    let visits = 0
    const pageErrors: string[] = []
    p.on('pageerror', error => pageErrors.push(error.message))
    const cards = [
      { name: '已完成图谱', tag: '图谱', url: map('1'), term },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `其他课${i}`, tag: 'AI智课', url: '', term })),
      { name: '计算机网络', tag: '共享课', url: classic('network'), term: '' },
      { name: '天文漫谈', tag: '共享课', url: classic('astronomy'), term: '' },
      { name: 'test', tag: '图谱', url: map('2'), term }
    ]
    await p.route('**/*', async route => {
      const url = route.request().url()
      let html: string
      if (url === DEFAULT_LOGGED_URL) {
        const visit = ++visits
        html = `<div class="el-select__wrapper" style="position:relative;width:240px;height:40px" onclick="openTerm()">
          <input readonly role="combobox" aria-controls="semester-${visit}" aria-expanded="false" style="position:absolute;inset:0;width:100%;height:100%">
          <div class="el-select__placeholder" style="position:absolute;inset:0;background:white">全部学期</div></div>
          <div role="listbox" id="stale-list" hidden><div role="option">${term}</div></div>
          <div role="listbox" id="other-list"><div role="option" onclick="throw Error('点到了其他菜单')">${term}</div></div>
          <div role="listbox" id="semester-${visit}" hidden><div role="option">全部学期</div></div><div id="cards"></div>
          <script>
            const combo=document.querySelector('[role=combobox]'), list=document.getElementById('semester-${visit}');
            const courses=${JSON.stringify(cards)};
            function openTerm(){combo.setAttribute('aria-expanded','true');list.hidden=false;
              setTimeout(()=>{const option=document.createElement('div');option.setAttribute('role','option');
                option.textContent='${term}';option.onclick=pick;list.append(option)},${visit === 1 ? 10 : 650})}
            function pick(){combo.setAttribute('aria-expanded','false');list.hidden=true;
              document.getElementById('cards').innerHTML=courses.map(c=>'<div class="course-card" data-url="'+c.url+'"><div class="course-tag">'+c.tag+'</div><div class="course-term">'+c.term+'</div><h4>'+c.name+'</h4></div>').join('')+'<p>~ 到底了 ~</p>'}
            document.getElementById('cards').onclick=event=>{const card=event.target.closest('.course-card');if(card&&card.dataset.url)location.href=card.dataset.url};
          </script>`
      } else if (url.includes('stuStudy')) html = '<li class="video"><span class="catalogue_title">未完成视频</span></li>'
      else html = `<div id="knowledgeId-1">学习进度 ${url.includes('/1/9') ? '100' : '0'} %</div>`
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    })
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 3000)
    const result = await nav.scan('2026-2027学年第一学期')
    expect(result).toMatchObject({ scanned: 4, completed: 1, unsupported: 8, warnings: [] })
    expect(result.courses.map(course => [course.name, course.kind])).toEqual([
      ['计算机网络', 'classic'], ['天文漫谈', 'classic'], ['test', 'map']
    ])
    expect(visits).toBe(4)
    expect(pageErrors).toEqual([])
  })
  it('当前菜单始终没有目标学期时报告已加载选项，不误选旁边菜单的同名项', async () => {
    const p = await page()
    await p.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <button role="combobox" aria-expanded="true" aria-controls="semester">全部学期</button>
      <div role="listbox"><div role="option">${term}</div></div>
      <div id="semester" role="listbox"><div role="option">全部学期</div><div role="option">2025年秋冬学期</div></div>` }))
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 700)
    await expect(nav.loadCurrentTerm('2026-2027学年第一学期')).rejects.toThrow('当前下拉框选项：全部学期、2025年秋冬学期')
  })
  it.each(['el-select__wrapper', 'el-select'])('点击 %s 外层打开学期选择，避开覆盖只读输入框的文字', async wrapperClass => {
    const p = await page()
    await p.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <div class="${wrapperClass}" style="position:relative;width:240px;height:40px" onclick="toggle()">
        <input readonly role="combobox" aria-expanded="false" style="position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box">
        <div class="el-select__selected-item el-select__placeholder" style="position:absolute;inset:0;z-index:1;background:white"><span>全部学期</span></div>
      </div>
      <div role="listbox" hidden><div role="option" onclick="selectTerm()">${term}</div></div>
      <div id="result"></div>
      <script>
        const combo=document.querySelector('[role=combobox]'),list=document.querySelector('[role=listbox]');
        function toggle(){const open=combo.getAttribute('aria-expanded')!=='true';combo.setAttribute('aria-expanded',String(open));list.hidden=!open}
        function selectTerm(){combo.setAttribute('aria-expanded','false');list.hidden=true;document.querySelector('span').textContent='${term}';document.getElementById('result').textContent='暂无课程'}
      </script>` }))
    await p.goto(DEFAULT_LOGGED_URL)
    // 先证明该结构确实能重现用户的 pointer-events 遮挡错误。
    await expect(p.getByRole('combobox').click({ timeout: 250 })).rejects.toThrow('intercepts pointer events')
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 3000)
    expect(await nav.loadCurrentTerm('2026-2027学年第一学期')).toEqual([])
    expect(await p.locator('.el-select__placeholder').innerText()).toBe(term)
    expect(await p.getByRole('combobox').getAttribute('aria-expanded')).toBe('false')
  })
  it('采集从 agent-course-hike 中间页继续等待，不重复导航打断启动', async () => {
    const p = await page()
    const parent = 'https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike'
    const requests: string[] = []
    await p.route('**/*', route => {
      requests.push(route.request().url())
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div>页面加载中</div><script>
        setTimeout(()=>{history.replaceState({},'', '${new URL(DEFAULT_LOGGED_URL).pathname}');
          document.body.innerHTML='<button role="combobox">全部学期</button><div role="option">${term}</div><p>暂无课程</p>'},600)
        </script>` })
    })
    await p.goto(parent)
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 3000)
    expect(await nav.loadCurrentTerm('2026-2027学年第一学期')).toEqual([])
    expect(requests).toEqual([parent])
    expect(p.url()).toBe(DEFAULT_LOGGED_URL)
  })
  it('筛选学期、加载第二批课程、按标签识别，排除已完成课并保留逐课失败', async () => {
    const p = await page()
    const cards = [
      { name: '图谱同名', tag: 'AI智课', url: '', term },
      { name: '未学共享', tag: '共享课', url: classic('pending'), term: '' },
      { name: '已学共享', tag: '共享课', url: classic('done'), term: '' },
      { name: '图谱同名', tag: '图谱', url: map('1'), term },
      { name: '已学图谱', tag: '图谱', url: map('2'), term },
      { name: '进度缺失', tag: '图谱', url: map('3'), term }
    ]
    await p.route('**/*', async route => {
      const url = route.request().url()
      let html = ''
      if (url === DEFAULT_LOGGED_URL) html = `<button role="combobox" onclick="document.querySelector('[role=option]').hidden=false">全部学期</button>
        <div role="option" hidden onclick="this.hidden=true;show()">${term}</div><div id="list" style="height:120px;overflow:auto"></div>
        <script>const cards=${JSON.stringify(cards)};const list=document.getElementById('list');let added=false;
        list.onclick=event=>{const card=event.target.closest('.course-card');if(card&&card.dataset.url)location.href=card.dataset.url};
        function render(c){return '<div class="course-card" style="height:90px" data-url="'+c.url+'"><div class="course-tag">'+c.tag+'</div><div class="course-term">'+c.term+'</div><h4>'+c.name+'</h4></div>'}
        function show(){list.innerHTML=cards.slice(0,2).map(render).join('');list.onscroll=()=>{if(added)return;added=true;setTimeout(()=>{list.insertAdjacentHTML('beforeend',cards.slice(2).map(render).join('')+'<p>~ 到底了 ~</p>')},80)}}
        </script>`
      else if (url.includes('stuStudy')) html = `<li class="video small-lesson"><span class="catalogue_title">章节</span></li>
        <li class="video"><span class="catalogue_title">视频</span>${url.includes('done') ? '<b class="time_icofinish"></b>' : ''}</li>`
      else html = `<div id="knowledgeId-1">掌握度 100% 学习进度 ${url.includes('/1/9') ? '99.5' : '100'} %</div>` +
        (url.includes('/3/9') ? '<div id="knowledgeId-2">学习进度加载中</div>' : '')
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    })
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 3000)
    const result = await nav.scan('2026-2027学年第一学期')
    expect(result.courses.map(c => [c.name, c.kind])).toEqual([['未学共享', 'classic'], ['图谱同名', 'map']])
    expect(result).toMatchObject({ scanned: 5, completed: 2, unsupported: 1 })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('进度缺失')
  })
  it('缺少到底标记不返回不完整课程列表', async () => {
    const p = await page()
    await p.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<button role="combobox">全部学期</button><div role="option">${term}</div><div class="course-card"><h4>未加载完整</h4></div>` }))
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 250)
    await expect(nav.loadCurrentTerm(term)).rejects.toThrow()
  })
  it('不把缺失学习进度的图谱当成未学，也不读取掌握度作为学习进度', async () => {
    const p = await page()
    await p.setContent('<div id="knowledgeId-1">掌握度 100%</div>')
    const nav = new CourseDiscoveryNavigator(p, () => false, () => {}, 600)
    await expect(nav.completion('map')).rejects.toThrow('学习进度未完整加载')
  })
  it('终止请求不继续访问课程', async () => {
    const nav = new CourseDiscoveryNavigator(await page(), () => true, () => {})
    await expect(nav.scan(term)).rejects.toThrow('取消')
  })
})
