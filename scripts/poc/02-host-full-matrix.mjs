/**
 * PoC 实验 2：专用 Electron browser-host + Playwright 的完整能力矩阵。
 *
 * 这是 Phase 2 的主验收脚本。逐项验证 docs/v2_handoff.md §4 列出的场景，
 * 结果同时写入 docs/PLAYWRIGHT_POC.md。
 *
 * 用法：
 *   node scripts/poc/02-host-full-matrix.mjs            # fixture 全跑 + 真实站点联网检查
 *   node scripts/poc/02-host-full-matrix.mjs --offline  # 只跑本地 fixture
 */

import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { startFixtureServer } from './fixture-server.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const offline = process.argv.includes('--offline')
const shotDir = join(root, 'tests', '.tmp', 'poc')
mkdirSync(shotDir, { recursive: true })

// 夹具经 http 提供（见 fixture-server.mjs 注释）
const server = await startFixtureServer(join(root, 'tests', 'fixtures'))
const fx = (name) => `${server.origin}/${name}`

// 宿主把页面下载落到这里（Playwright 的 download 事件在 Electron 下不可用）
const downloadDir = join(shotDir, 'downloads')
rmSync(downloadDir, { recursive: true, force: true })
mkdirSync(downloadDir, { recursive: true })

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 每项检查都包一层，单项失败不中断整轮 */
async function check(name, fn) {
  try {
    const detail = await fn()
    record(name, true, typeof detail === 'string' ? detail : '')
  } catch (error) {
    record(name, false, error instanceof Error ? error.message.split('\n')[0] : String(error))
  }
}

const localAppPath = root
const electronApp = await electron.launch({
  executablePath: require('electron'),
  args: [localAppPath, '--browser-host', `--download-dir=${downloadDir}`],
  cwd: root,
  env: { ...process.env }
})

let page
try {
  page = await electronApp.firstWindow({ timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
  record('_electron.launch() 拉起 browser-host', true, `page.url()=${page.url()}`)

  // ================= 基础：导航 / 定位 / 交互 =================
  await page.goto(fx('classic-course.html'))
  await check('页面导航与加载', async () => {
    const title = await page.title()
    if (!title.includes('传统课程')) throw new Error(`title=${title}`)
    return title
  })

  await check('元素定位 locator()', async () => {
    const text = await page.locator('.catalogue_title').first().textContent()
    if (!text?.trim()) throw new Error('空文本')
    return text.trim()
  })

  await check('click()', async () => {
    await page.locator('li.video').nth(1).click()
    const cls = await page.locator('li.video').nth(1).getAttribute('class')
    if (!cls?.includes('current_play')) throw new Error(`class=${cls}`)
    return '点击后 current_play 生效'
  })

  await check('fill() / input', async () => {
    await page.goto(fx('login.html'))
    await page.locator('#lUsername').fill('13800000000')
    await page.locator('#lPassword').fill('secret')
    const u = await page.inputValue('#lUsername')
    if (u !== '13800000000') throw new Error(`回读=${u}`)
    return '输入框可写入并回读'
  })

  // ================= 动态 SPA =================
  await check('动态 SPA 元素（等待后出现）', async () => {
    await page.goto(fx('classic-course.html'))
    await page.locator('#load-more').click()
    await page.locator('.late-item').first().waitFor({ timeout: 5_000 })
    return `${await page.locator('.late-item').count()} 个延迟元素`
  })

  // ================= iframe（UPC CAS / 验证码） =================
  await check('iframe 内定位与输入', async () => {
    await page.goto(fx('upc-cas.html'))
    await page.frameLocator('#loginFrame').locator('#username').fill('upc-user')
    const v = await page.frameLocator('#loginFrame').locator('#username').inputValue()
    if (v !== 'upc-user') throw new Error(`iframe 回读=${v}`)
    return 'frameLocator 可定位并可写入'
  })

  await check('iframe 内执行 Vue 组件方法（UPC passwordLogin）', async () => {
    const out = await page
      .frameLocator('#loginFrame')
      .locator('body')
      .evaluate(() => {
        const app = document.querySelector('#app').__vue__
        app.username = 'upc-user'
        app.password = 'upc-pass'
        app.passwordLogin()
        return document.querySelector('#state').textContent
      })
    if (!out.includes('submitted')) throw new Error(`结果=${out}`)
    return '注入 __vue__ 并调用组件方法成功'
  })

  // ================= 视频元素与播放状态 =================
  /** 夹具用 MediaRecorder 现场合成媒体，等它就绪再断言 duration */
  const waitForMedia = async () => {
    await page.waitForFunction(() => window.__mediaReady === true || window.__mediaError, null, {
      timeout: 15_000
    })
    const err = await page.evaluate(() => window.__mediaError ?? '')
    if (err) throw new Error(`夹具合成媒体失败: ${err}`)
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#courseVideo')
        return v && Number.isFinite(v.duration) && v.duration > 0
      },
      null,
      { timeout: 10_000 }
    )
  }

  await check('读取 <video> 播放状态（duration 真实可用）', async () => {
    await page.goto(fx('classic-course.html'))
    await waitForMedia()
    const info = await page.locator('#courseVideo').evaluate((v) => ({
      duration: v.duration,
      paused: v.paused,
      ended: v.ended,
      currentTime: v.currentTime
    }))
    if (!(info.duration > 0)) throw new Error(JSON.stringify(info))
    return `duration=${info.duration.toFixed(2)}s paused=${info.paused}`
  })

  await check('驱动 video 播放/暂停并读回状态', async () => {
    await page.locator('#courseVideo').evaluate((v) => v.play().catch(() => {}))
    await page.waitForTimeout(600)
    const playing = await page.locator('#courseVideo').evaluate((v) => !v.paused)
    const advanced = await page.locator('#courseVideo').evaluate((v) => v.currentTime > 0)
    await page.locator('#courseVideo').evaluate((v) => v.pause())
    const paused = await page.locator('#courseVideo').evaluate((v) => v.paused)
    if (!playing || !paused) throw new Error(`playing=${playing} paused=${paused}`)
    return `playing=${playing} currentTime 前进=${advanced} paused=${paused}`
  })

  // ================= 弹题 =================
  await check('弹题对话框检测与选项点击', async () => {
    await page.goto(fx('quiz-dialog.html'))
    const dialog = page.locator('div.el-dialog[aria-label*="弹题"]')
    await dialog.waitFor({ timeout: 5_000 })
    await dialog.locator('.topic-item').first().click()
    const active = await dialog.locator('.topic-option-item.active').count()
    if (active === 0) throw new Error('选项未进入 active 状态')
    await dialog.locator('.btn-next').click()
    return `${active} 个选项被选中，下一题按钮可点`
  })

  // ================= 验证码 =================
  // 直接复刻 v1 CaptchaHandler 的三条检测路径（constants.py），
  // 而不是自造一个简化的选择器 —— 要验证的正是这套检测逻辑本身能否迁移。
  const detectCaptcha = () =>
    page.evaluate(() => {
      const KEYWORDS = ['captcha', 'yidun', 'turing', 'cstaticdun', 'necaptcha', 'verify']
      const POPUPS = [
        '.yidun_popup',
        '.yidun_modal',
        '.yidun_popup__content',
        '#tcaptcha_transform_dy',
        '#lPwdError'
      ]

      for (const frame of document.querySelectorAll('iframe')) {
        const src = (frame.getAttribute('src') || '').toLowerCase()
        if (KEYWORDS.some((k) => src.includes(k))) {
          const r = frame.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return { kind: 'iframe', detail: src }
        }
      }
      for (const sel of POPUPS) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect()
          if (r.width > 10 && r.height > 0) return { kind: 'popup', detail: sel }
        }
      }
      const img = document.querySelector('#j-captcha-mobile')
      if (img && img.getBoundingClientRect().width > 0) return { kind: 'image-input', detail: '#j-captcha-mobile' }
      return null
    })

  await check('验证码：弹窗检测（.yidun_popup）', async () => {
    await page.goto(fx('captcha.html'))
    if (await detectCaptcha()) throw new Error('触发前不应检出验证码')
    await page.locator('#trigger').click()
    const hit = await detectCaptcha()
    if (!hit) throw new Error('触发后未检出')
    if (hit.kind !== 'popup') throw new Error(`检出类型=${hit.kind}`)
    return `${hit.kind} → ${hit.detail}`
  })

  await check('验证码：人工确认后检测自动消失', async () => {
    await page.locator('#clear').click()
    const hit = await detectCaptcha()
    if (hit) throw new Error(`清除后仍检出 ${hit.kind}`)
    return '清除后不再检出'
  })

  await check('验证码：iframe 关键字检测', async () => {
    await page.goto(fx('login.html'))
    await page.locator('#submitBtn').click()
    await page.waitForTimeout(300)
    const hit = await detectCaptcha()
    if (!hit) throw new Error('未检出验证码 iframe')
    if (hit.kind !== 'iframe') throw new Error(`检出类型=${hit.kind}`)
    return `${hit.kind} → ${hit.detail}`
  })

  // ================= cookies / session =================
  await check('cookies 读写', async () => {
    await page.goto(fx('classic-course.html'))
    const ctx = page.context()
    await ctx.addCookies([{ name: 'SESSION', value: 'abc123', url: server.origin }])
    const cookies = await ctx.cookies()
    const hit = cookies.find((c) => c.name === 'SESSION')
    if (!hit) throw new Error(`写入后读不到，共 ${cookies.length} 个`)
    return `写入并回读 SESSION=${hit.value}`
  })

  await check('cookie 随请求带回（会话保持基础）', async () => {
    const echoed = await page.evaluate(async (origin) => {
      const res = await fetch(`${origin}/classic-course.html`, { credentials: 'same-origin' })
      return res.status
    }, server.origin)
    if (echoed !== 200) throw new Error(`同源请求状态=${echoed}`)
    return '同源 fetch 携带 cookie 正常'
  })

  await check('sessionStorage / localStorage 可用', async () => {
    await page.goto(fx('classic-course.html'))
    await page.evaluate(() => {
      localStorage.setItem('k', 'v')
      sessionStorage.setItem('s', 'v2')
    })
    const out = await page.evaluate(() => ({
      l: localStorage.getItem('k'),
      s: sessionStorage.getItem('s')
    }))
    if (out.l !== 'v' || out.s !== 'v2') throw new Error(JSON.stringify(out))
    return 'localStorage + sessionStorage 正常'
  })

  // ================= 多页面 / 跳转 =================
  await check('多页面跳转与 history 返回', async () => {
    await page.goto(fx('classic-course.html'))
    await page.goto(fx('quiz-dialog.html'))
    await page.goBack()
    const title = await page.title()
    if (!title.includes('传统课程')) throw new Error(`返回后 title=${title}`)
    return 'goBack 回到上一页'
  })

  await check('导航事件可订阅', async () => {
    let fired = 0
    const handler = () => (fired += 1)
    page.on('framenavigated', handler)
    await page.goto(fx('classic-course.html'))
    page.off('framenavigated', handler)
    if (fired === 0) throw new Error('未收到事件')
    return `${fired} 次导航事件`
  })

  // ================= download =================
  // 注意：这里**不用** page.waitForEvent('download') —— 实测在 Electron 下永不触发
  // （详见 docs/PLAYWRIGHT_POC.md）。下载由宿主的 session.on('will-download') 接住并落盘，
  // 通过索引文件回传。
  const readDownloadIndex = () => {
    const index = join(downloadDir, '_index.jsonl')
    if (!existsSync(index)) return []
    return readFileSync(index, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  }

  const waitForDownload = async (filename, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = readDownloadIndex().find(
        (r) => r.state === 'completed' && r.filename === filename
      )
      if (hit) return hit
      await page.waitForTimeout(200)
    }
    return null
  }

  await check('download：HTTP 附件经宿主落盘', async () => {
    await page.goto(fx('classic-course.html'))
    await page.locator('#http-download-link').click()
    const rec = await waitForDownload('course-material.pdf')
    if (!rec) throw new Error(`未落盘，索引=${JSON.stringify(readDownloadIndex())}`)
    if (!existsSync(rec.path)) throw new Error('索引有记录但文件不存在')
    return `${rec.filename} (${rec.bytes} bytes)`
  })

  await check('download：blob 下载不触发 will-download（已确认限制）', async () => {
    await page.goto(fx('classic-course.html'))
    let playwrightFired = false
    const probe = () => (playwrightFired = true)
    page.on('download', probe)
    await page.locator('#download-link').click()
    await page.waitForTimeout(2500)
    page.off('download', probe)

    const hostSaw = readDownloadIndex().some((r) => r.filename === 'poc-download.txt')
    if (playwrightFired) throw new Error('Playwright 事件居然触发了 —— 结论需重新评估')
    if (hostSaw) throw new Error('宿主居然收到了 blob 下载 —— 结论需重新评估')
    return 'Playwright 事件与宿主 will-download 均无反应；音轨必须走 Node 侧流式落盘'
  })

  // ================= MediaRecorder / captureStream =================
  // 这是「实时录音」转录模式的全部基础：video.captureStream() → 只留音轨
  // → MediaRecorder → WebM。v1 在 audio_capture.py 里做的就是这样事。
  await check('captureStream 能取到音轨', async () => {
    await page.goto(fx('classic-course.html'))
    await waitForMedia()
    await page.locator('#courseVideo').evaluate((v) => v.play().catch(() => {}))
    const out = await page.locator('#courseVideo').evaluate(async (v) => {
      if (typeof v.captureStream !== 'function') return { ok: false, why: 'captureStream 不存在' }
      const stream = v.captureStream()
      const audio = stream.getAudioTracks()
      const video = stream.getVideoTracks()
      return { ok: true, audio: audio.length, video: video.length, state: audio[0]?.readyState ?? '-' }
    })
    if (!out.ok) throw new Error(out.why)
    if (out.audio === 0) throw new Error('captureStream 返回 0 条音轨')
    return `audioTracks=${out.audio} videoTracks=${out.video} trackState=${out.state}`
  })

  await check('MediaRecorder 录制音轨并产出 WebM', async () => {
    const out = await page.locator('#courseVideo').evaluate(async (v) => {
      const stream = v.captureStream()
      const audioOnly = new MediaStream(stream.getAudioTracks())
      let rec
      try {
        // 与 v1 一致：不传 mimeType、不传 timeslice（传了会 NotSupportedError）
        rec = new MediaRecorder(audioOnly)
      } catch (e) {
        return { ok: false, why: `构造失败: ${e.name}` }
      }
      const chunks = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.start()
      await new Promise((r) => setTimeout(r, 900))
      await new Promise((r) => {
        rec.onstop = r
        rec.stop()
      })
      const blob = new Blob(chunks, { type: 'audio/webm' })
      return { ok: true, mime: rec.mimeType, chunks: chunks.length, bytes: blob.size }
    })
    if (!out.ok) throw new Error(out.why)
    if (out.bytes === 0) throw new Error('录到的 WebM 为空')
    return `mime=${out.mime} chunks=${out.chunks} bytes=${out.bytes}`
  })

  // ================= 截图取证 =================
  await check('screenshot 取证', async () => {
    await page.goto(fx('classic-course.html'))
    const file = join(shotDir, 'classic-course.png')
    await page.screenshot({ path: file })
    writeFileSync(join(shotDir, 'ok'), file)
    return file
  })

  // ================= 本地 DOM 夹具 → 解析能力 =================
  await check('传统课程列表解析（fixture）', async () => {
    await page.goto(fx('classic-course.html'))
    const items = await page.locator('li.video').evaluateAll((nodes) =>
      nodes.map((n) => ({
        title: n.querySelector('.catalogue_title')?.textContent?.trim() ?? '',
        finished: !!n.querySelector('.time_icofinish'),
        smallLesson: !!n.querySelector('.small-lesson'),
        current: n.classList.contains('current_play')
      }))
    )
    const playable = items.filter((i) => i.title && !i.smallLesson)
    if (playable.length < 3) throw new Error(`只解析出 ${playable.length} 项`)
    return `${items.length} 项，其中可播放 ${playable.length} 项，已完成 ${playable.filter((i) => i.finished).length} 项`
  })

  await check('图谱课程资源分类（fixture）', async () => {
    await page.goto(fx('map-course.html'))
    const knowledgeItems = await page.locator("[id*='knowledgeId-']").evaluateAll((nodes) =>
      nodes.map((n) => ({
        id: n.id,
        text: (n.textContent ?? '').replace(/\s+/g, ' ').trim()
      }))
    )
    if (knowledgeItems.length < 2) throw new Error(`知识项仅 ${knowledgeItems.length} 个`)
    return `${knowledgeItems.length} 个知识项: ${knowledgeItems.map((k) => k.id).join(', ')}`
  })

  // ================= 真实站点（联网） =================
  if (!offline) {
    console.log('\n--- 真实目标站点 ---')

    await check('智慧树登录页可达并渲染', async () => {
      await page.goto('https://onlineweb.zhihuishu.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000
      })
      const title = await page.title()
      const hasPassword = await page.locator('input[type="password"]').count()
      return `title=${title} passwordInputs=${hasPassword}`
    })

    await check('智慧树登录页选择器命中（v1 constants 迁移）', async () => {
      const hit = await page.evaluate(() => {
        const sels = ['#lUsername', 'input[name="username"]', 'input[placeholder*="手机号"]']
        for (const s of sels) if (document.querySelector(s)) return s
        return ''
      })
      return hit ? `命中 ${hit}` : '未命中（页面结构可能已变化，需人工核对）'
    })

    await check('UPC 统一认证页可达 + CAS iframe 检测', async () => {
      await page.goto('https://i.upc.edu.cn/', { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(2500)
      const frames = page.frames().map((f) => f.url()).filter(Boolean)
      const casFrame = frames.find((u) => u.includes('login-normal'))
      return `frames=${frames.length}${casFrame ? `，命中 CAS iframe` : '，未出现 CAS iframe'}`
    })

    await check('图谱课程站可达', async () => {
      await page.goto('https://ai-smart-course-student-pro.zhihuishu.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000
      })
      return `title=${await page.title()}`
    })
  }

  // ================= 收尾：窗口与进程清理 =================
  await check('宿主窗口可正常关闭并被回收', async () => {
    const before = electronApp.windows().length
    await electronApp.close()
    return `关闭前 ${before} 个窗口`
  })
} catch (error) {
  record('PoC 主流程', false, error instanceof Error ? error.message : String(error))
  try {
    await electronApp.close()
  } catch {
    /* ignore */
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`)
}

await server.close()
writeFileSync(join(shotDir, 'results.json'), JSON.stringify(results, null, 2))
process.exitCode = failed.length ? 1 : 0
