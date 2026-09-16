# v1 → v2 迁移说明

> v1 基线：tag `v1-pyside-final`（`dev_beta` @ `ecde984`）
> v2 分支：`rewrite/electron`
> 对照物：`docs/V1_BASELINE.md`（v1 实际行为）、`docs/PLAYWRIGHT_POC.md`（技术验证）

本文档记录**每一处行为变化**（handoff §31 要求）。原则上「不因为旧代码结构差就随意
改变产品行为」；下面每一条都是有意为之，并注明了理由。

---

## 一、技术栈替换

| | v1 | v2 |
|---|---|---|
| 桌面外壳 | PySide6 + QML | Electron + Vue 3 |
| 语言 | Python | TypeScript |
| 浏览器自动化 | Selenium + ChromeDriver | Playwright（见 PLAYWRIGHT_POC） |
| 浏览器来源 | 系统 Chrome / bin/ 缓存 / 自动下载 / webdriver-manager | Electron 自带 Chromium |
| 凭据 | Python keyring | Electron safeStorage |
| 持久化 | sqlite3（Python） | better-sqlite3（Node） |
| STT | multiprocessing worker（同进程树） | 独立 Python 子进程 + NDJSON 协议 |
| 打包 | PyInstaller / py2app | electron-builder |

---

## 二、v1 已确认缺陷的修正

依据 `docs/V1_BASELINE.md` §7。每条都标注了对用户可见的差异。

### 1. 课程进度不再被转录流程劫持

**v1**：`course_progress` 只在**转录成功**时写入（`bot_core.py:376` → `bridge.py:363`）。
不开语音转文字时，「从上次进度继续」完全失效。
**v2**：进度写入在 `BotService.reportVideoCompleted()`，与转录完全无关。
**用户可见**：不开转录也能正确从上次进度继续。

### 2. 课程进度的键统一

**v1**：写入用 `sanitize_filename()` 之后的课程名，读取用原始 `course_note`。
含 `<>:"/\|?*`、连续 `_`/空格或超 100 字符的备注会写进一个永远查不到的主键。
**v2**：统一用原始 `course_note`；读取时额外回退试一次净化后的名字，
以命中从 v1 导入的历史行（`Database.getCourseProgress` 的 `legacyKey` 参数）。
**用户可见**：无 —— 修复后行为才符合预期。

### 3. 小章节标题不再被当成视频

**v1**：`item.find_elements(By.CSS_SELECTOR, '.small-lesson')` 只搜**后代**，
而 `.small-lesson` 这个 class 常常就在 `li` 自身 → 从未真正排除过小章节，
它们会被当作可播放视频去点击。
**v2**：元素自身与后代都检查（`navigator.ts::listVideos`）。
**用户可见**：刷课会跳过「第 N 章 章节导语」这类无内容条目，不再浪费一次点击与等待。

### 4. 弹题最后一题不再误报失败

**v1**：最后一题点「下一题」（此时是「提交」）后对话框自行关闭，
但 v1 仍去调 `_close()`，找不到关闭按钮就返回 `False` —— 明明答完了却记一次失败。
**v2**：把「对话框已消失」直接视为成功（`quiz.ts::handle` 的 `isGone`）。
**用户可见**：日志不再出现无意义的「未能关闭弹题对话框」。

### 5. 随机答题不再中途改选（handoff §28 点名）

**v1**：`_answer_current` 验证选中失败时会**再调一次** `select_option()`，
等于换了一个选项，同一道题的答案在重试之间来回跳。
**v2**：一道题只向策略询问一次，重试只重复点击同一个目标。
**用户可见**：同一道题的作答结果确定。

### 6. Classic 回环有显式终止条件（handoff §28 点名）

**v1**：循环靠 `get_next_video_after` 返回 `None` 结束；`skip_completed=false` 时
每一项都「可播放」，看完最后一个会环形回到第一个，无限刷到撞时长上限。
**v2**：显式记录本轮已处理过的列表下标，回到起点即终止（`classic-course-runner.ts`）。
**用户可见**：关闭「跳过已完成」时，跑完一轮就停，不会无限循环。

### 7. 图谱课 URL 解析结构化（handoff §28 点名）

**v1**：两条 `re.search`，不匹配就抛「无法从 URL 解析课程ID」。
**v2**：`new URL()` 按 host + path 形状分类，支持 `knowledgeStudy` /
`learnPage` / `abilityAgent` 三种形态；无法识别时给出**可操作**的提示，
列出正确写法（`map/url.ts`，含 15 个测试用例）。
另外：`abilityAgent` 入口页拿不到 `mapId`，v2 直接说明该复制哪种地址，
而不是静默失败。
**用户可见**：填错地址时能看懂该怎么改。

### 8. 图谱课生命周期只收尾一次（handoff §28 点名）

**v1**：`_run_map_mode` 在 `try` 与 `except` 里各调一次 `on_bot_stop()`，
`finally` 又关一次 driver。
**v2**：收尾全部由 `BotService.stop()` 统一负责且只执行一次；Runner 只返回结果。
**用户可见**：无（消除重复收尾的副作用）。

### 9. 临时 WAV 默认清理

**v1**：`TRANSCRIPTION_DEBUG_KEEP_WAV = True`，`_cleanup_temp` 直接 return，
每节课的 WAV（约 115MB/小时）永久留在 `.temp/`。
**v2**：处理完成即删除；退出时清空临时目录。
**用户可见**：磁盘不再被临时音频占满。**代价**：排查录音问题时没有现成 WAV 可听 ——
需要的话在 `transcription-service.ts::cleanupActive` 临时注释掉删除。

### 10. STT worker 可靠关闭

**v1**：`shutdown()` 里 `_current_recorder = None` 但不停 MediaRecorder/WASAPI 线程；
停止信号只中断等待、不中断推理，worker 仍在跑且结果无人消费。
**v2**：关闭走「先发 `{"type":"shutdown"}`、5s 未退再 SIGKILL」；
所有挂起任务被 reject（`stt-worker.ts::stop`）。
**用户可见**：退出应用后不再残留 Python 进程。

### 11. 图谱课 + 转录不再静默失效（handoff §28 点名）

**v1**：`_run_map_mode` 在建 transcriber 之前就 `return`，组合静默无效。
**v2**：图谱 Runner 与经典 Runner 都通过 `ctx.media`（`MediaPort`）接入转录，
视频资源会正常录音转写。
**用户可见**：图谱课也能转文字了。

---

## 三、有意的行为变化（非缺陷修正）

### A. 浏览器连接方式

Playwright 无法驱动 Electron 自带 Chromium（`Runtime` domain 不开放）。
改为**专用 Electron Browser Host 子进程** + Playwright `_electron.launch()`。
完整证据与取舍见 `docs/PLAYWRIGHT_POC.md`。

**用户可见**：课程网页仍显示在一个独立窗口里，与 v1 的独立 Chrome 窗口体验一致。

### B. 不再需要 Chrome / ChromeDriver 配置

v1 的 `chrome_binary` / `chromedriver_binary` 两个设置项在 v2 中**废弃**，
迁移时不再导入。设置页也不再显示。
**用户可见**：少了两项配置，也不会再遇到版本不匹配。

### C. 不做任何反检测处理

v1 注入了 `navigator.webdriver` 补丁与 `excludeSwitches`（`browser.py:229`）。
v2 按 handoff §5 **不打任何补丁**，只使用标准浏览器自动化能力。

### D. 界面从毛玻璃 QML 换成平铺 Vue

`bg_blur_radius` 设置项废弃（v2 界面没有毛玻璃）。
新增 `uiScale`（界面缩放 90%–130%）。

### E. 视频暂停恢复的阈值

**v1**：主循环每 10s 检查一次暂停（`elapsed % 10 == 0`），图谱循环 30s。
**v2**：主循环每 10s（`INTERVAL.autoplayGuard`），图谱循环 30s —— 与 v1 相同。

### F. 停止时不再「超时也算完成」

**v1**：`_monitor_single_video` 超时返回 False，但主循环里
「课程超时，仍计入完成」`completed_this_run += 1`。
**v2**：保留同样语义（超时仍计入完成），但日志文案明确写「视频监控未正常结束」。

---

## 四、数据迁移

### 数据库

首次启动时自动检测 v1 数据库（`~/Library/Application Support/zhihuishu_auto_course/course_progress.db`
等），**只读**打开并导入到 v2 的 `userData/auto_course.db`。
此后只使用 v2 数据库，不再依赖 v1 的目录结构。

导入内容与键映射：

| v1 表 | v2 目标 | 说明 |
|---|---|---|
| `settings` | `settings` | 键名改为 camelCase，见下表 |
| `url_history` | `url_history` | 原样搬运 |
| `daily_progress` | `daily_progress` | 原样搬运 |
| `course_progress` | `course_progress` | 原样搬运（键保持 v1 的净化形式，读取时兼容） |

settings 键映射：

```
login_method        → loginMethod
video_url           → videoUrl
course_note         → courseNote
logged_url          → loggedUrl
brush_enabled       → brushEnabled
map_mode            → mapMode
skip_completed      → skipCompleted
from_last_progress  → fromLastProgress
time_limit          → timeLimitMinutes
transcribe_enabled  → transcribeEnabled
transcribe_base_dir → transcribeBaseDir
auto_mode           → autoMode
auto_start_time     → autoStartTime
auto_end_time       → autoEndTime
auto_allday         → autoAllDay
auto_limit          → autoLimitMinutes（缺失时回退到 time_limit，与 v1 同语义）

bg_blur_radius / chrome_binary / chromedriver_binary → 不导入（v2 已废弃）
```

导入只在 v2 数据库**为空**时执行一次；已有数据绝不覆盖。

### 凭据

**不迁移。** handoff §18 明确不要求自动迁移 v1 keyring 凭据。
升级后需要在设置页重新输入一次账号密码（之后由 safeStorage 保存）。
v1 的 keyring 数据保持不动，可随时回退到 v1。

### 转录输出

输出目录（`<baseDir>/课程录音/<课程名>/<课时名>.txt`）与 txt 文件头
**逐字保持一致**，用户已有的转录结果不会被重建或覆盖到别处。

---

## 五、功能对照（handoff §26 的 DoD）

| 要求 | 状态 |
|---|---|
| Electron + Vue 可独立启动 | ✅ |
| PySide6/QML 不再进入运行链路 | ✅ |
| 智慧树账号密码登录 | ⚠️ 已迁移，**未经真实账号验证** |
| UPC SSO 登录 | ⚠️ 已迁移，**未经真实账号验证**；主路径已改成智慧树「机构登录」（见第七节），真实站点结构核对通过 |
| 传统课程完整刷课 | ⚠️ 已迁移，夹具级验证通过 |
| 图谱课程完整刷课 | ⚠️ 已迁移，夹具级验证通过 |
| 跳过已完成课程 | ✅ 夹具验证 |
| 上次进度继续 | ✅ 夹具 + 单测验证 |
| 视频暂停后恢复 | ✅ 夹具验证 |
| 弹题流程 | ✅ 夹具验证 |
| 验证码人工处理 | ✅ 夹具验证（三条检测路径） |
| 用户停止操作可靠 | ✅ 单测验证 |
| 每日观看时长正确 | ✅ 单测验证 |
| 自动调度正确 | ✅ 单测验证（含跨午夜） |
| SQLite 数据正常持久化 | ✅ 单测验证 |
| v1 SQLite 有明确迁移路径 | ✅ 单测验证 + 真实数据实测 |
| 课程历史正常 | ✅ 单测验证 |
| 刷课 + 转录 | ✅ 端到端验证（假 worker） |
| 仅转录 | ✅ 端到端验证（假 worker） |
| STT Worker 可启动、复用、关闭 | ✅ 端到端验证 |
| 退出不留 Chrome/Electron/Python 子进程 | ✅ 打包产物实测无残留 |
| Windows 构建可运行 | ⚠️ 配置就绪，**未在 Windows 上实测** |
| macOS 构建可运行 | ⚠️ 配置就绪，见打包说明 |
| Playwright 成为最终浏览器自动化 API | ✅ |
| Legacy Selenium 可删除 | ⏳ 见下 |

**⚠️ 标记的项需要在有真实账号与对应平台的机器上补验。**

自动化测试目前 177 项全绿，覆盖到夹具层与协议层：
- 单元测试（调度决策、设置往返、DB CRUD、v1 导入映射、图谱/URL 解析、文件名净化、媒体下载）
- DOM 夹具测试（用真实 Chromium 驱动 Navigator / VideoController / QuizService / CaptchaService）
- Runner 主循环端到端（点击 → 监控 → 记账 → 终止，含 handoff §28 的回环修正）
- 转录链路端到端（假 Python worker，协议与 worker.py 完全一致）
- 打包产物验证（真的启动打包后的应用并拉起 Browser Host）

真实站点的页面结构、滑块验证码、真实视频直链下载、真实 SenseVoice 推理
必须人工冒烟（步骤见 `docs/PLAYWRIGHT_POC.md` §2.3）。

---

## 六、Legacy 已删除

按 handoff §24/§25：v1 先与 v2 并存，**核心功能在真实账号上验证通过后**再删。
2026-09-15 用户确认 mac / win 构建、传统课、图谱课、数字石大登录均正常
（智慧树账号密码登录因站点改版失效，但按用户要求「先不管」，反正要按新 UI 重写），
删除条件达成，v1 已从工作区移除：

```
删除  src/bot/ src/transcriber/ src/ui/ src/utils/ src/db/ src/constants.py src/__init__.py
      gui/  main.py  database.py  config.py  main_tkinter.py.bak
      scripts/build_win.ps1  scripts/build_mac.sh  scripts/create_installer.ps1
      scripts/generate_nsi.py  scripts/setup_mac.py  scripts/download_chrome.py
      scripts/fix_ps1_encoding.py  requirements.txt
      app/ init/ page/ proxy/ sql/ events/（只剩 __pycache__ 的空壳目录）
保留  python/transcriber/  —— v2 唯一保留的 Python runtime（SenseVoice worker）
```

删掉的是**代码**，v1 的行为对照仍可随时取回：

```bash
git worktree add /tmp/v1 v1-pyside-final     # v1 冻结 tag
```

v1 的 keyring 凭据与 `~/Library/Application Support/zhihuishu_auto_course/` 下的
数据库没有被 v2 改动，回退到 v1 仍然可用。

**未删除**：`dist/`、`build/`（v1 的 py2app / PyInstaller 产物，已在 `.gitignore` 里）
与仓库根目录的 `course_progress.db`。它们是本机遗留物、不入版本控制，
如需清理直接删即可；`course_progress.db` 是数据不是代码，故保留待确认。

---

## 七、人工测试发现的回归（已修）

### 验证码误报：休眠容器被当成"弹出的验证码"

**现象**（用户人工测试报告）：
切换课程时弹出「切换课程「XXX」时出现验证码，请完成验证」，
但浏览器里根本没有验证码。

**原因**：目标站点长期在 DOM 里挂着一个休眠的验证码容器
（v1 的 `captcha.py` 注释里写的 `#captchaYidun`）。
v1 用的是 Selenium 的 `is_displayed()`，它会跳过这类容器；
我迁移时把「是否可见」简化成了 `getBoundingClientRect()` 尺寸判断 ——
而这个容器是用 `visibility:hidden` / `opacity:0` / 被祖先 `overflow` 裁掉
这类**不影响 bounding rect** 的方式藏起来的，尺寸完全正常，
于是被判成"可见"，误报给用户。

**修复**（`automation/captcha.ts`）：`isDisplayed()` 改为对齐 Selenium
`bot.dom.isShown` 的语义，逐级向上检查：

1. 自身与所有祖先的 `display` / `visibility` / `opacity`
2. 尺寸
3. 是否被祖先的 `overflow:hidden` 完全裁掉
4. 是否完全落在视口之外

第 4 条是 v2 额外加的：站点也常用 `left:-9999px` 停放休眠容器，
而且从产品语义上讲，**用户根本看不到的东西就不该弹提示让他去处理**。
只在"完全不重叠"时才判为不可见，部分露出（例如需要滚动）仍算可见。

**测试**：夹具里补了五种隐藏方式（visibility / opacity / 裁剪 / 视口外 / display），
并断言它们是被**判为不可见而排除**的，而不是压根没匹配上 ——
以及真的弹出验证码时仍然检得出来（确认没修成漏报）。

**排查辅助**：`detect()` 现在会把「命中关键字但被判为不可见」的候选
连同**具体原因与被谁藏起来的**一起记进 debug 日志。
如果再遇到误报，把日志发我即可定位。

**已知局限**：真实站点的课程页需要登录才能到达，
所以这次修复**没有在你的实际场景里复现验证过**，
依据是"对齐 v1 已验证过的 `is_displayed()` 语义"。

### 2026-09-15 传统课实测

- 旧 macOS 应用包尚未包含上述可见性修复；Chrome 实测腾讯验证码容器
  `#tcaptcha_transform_dy` 为 `opacity:0; top:-1000000px`。重新打包后，
  同一课程已通过初始化并进入视频监控，没有再因休眠容器暂停。
- 传统课监控内部按毫秒累计等待时间，但 `elapsedSeconds` 原样返回该值，
  导致每日进度与单次时长限制放大 1000 倍。现在在返回及日志显示时换算成秒。
  停止测试新增「上报秒数不得大于实际运行秒数」断言。
- 验证：传统课 DOM 与主循环共 38 项通过；计时修复后的停止回归单独通过，
  类型检查及 arm64 应用打包通过。两次线上运行均在短暂启动播放后跳回
  `https://www.zhihuishu.com/`，持续播放尚未通过 —— 跳转原因已定位并修复，
  见下一节。

### 传统课跳回首页：「检测到异常脚本」（已定位并修复）

**现象**：真实课程点进去、播放几秒后弹出
「检测到异常脚本，为保证您的正常学习进度，请您关闭插件后，回到学堂重新进入视频学习页正常学习」，
再过 3 秒页面 `location.replace('https://www.zhihuishu.com')` 跳回学堂首页，刷课中断。

**站点侧的依据**：把线上 bundle（`studyvideoh5` 的
`app.<hash>.js` / `stuStudy.<hash>.js`，javascript-obfuscator 混淆，字符串数组
解码后）读出来，会跳首页的只有三条路径，两条与播放有关：

```js
// ① 播放器容器上的守卫：任何**不可信**（合成）点击
document.getElementById('container').addEventListener('click', function (e) {
  e.preventDefault()
  if (e instanceof Event && !e.isTrusted) {
    $alert('检测到异常脚本，…', '提示', { showConfirmButton: false, … })
    ablePlayerX('container').pause()
    setTimeout(function () { window.location.replace('https://www.zhihuishu.com') }, 3000)
  }
})

// ② Vue 的 videoClick：最后一个参数是事件对象
if (lastArg instanceof PointerEvent && false === lastArg.isTrusted) this['notTrustScript']()

// ③ onTime：倍速播放
if (1.8 < document.querySelector('#container video').playbackRate) { …同上… }
```

另外还有一个每 60s 跑一次的 `checkout()`，检查
`XMLHttpRequest`、`XMLHttpRequest.prototype.open`、
`Element.prototype.addEventListener` 是否原生、`window.OCS` 是否存在。
四项在 v2 的 Electron 宿主里**实测全部通过**，所以它不是本次的原因；
③ 也不适用（v2 从不碰 `playbackRate`）。

**根因**：点击被遮罩挡住时，v2 的 `VideoController.tryClick()` 退回了
`element.click()`（`page.evaluate` 里的合成点击）。合成点击的
`isTrusted === false`，正好命中 ① / ② —— 于是弹框、暂停、3 秒后跳首页，
表现就是「刚开始播放就跳回去」。
v1 的 4 级播放策略全是真实的 WebDriver 点击（ActionChains / `element.click()`），
没有合成点击，所以 v1 时代踩不到这条守卫。

**验证**（都不依赖真实账号）：

| 检查 | 结果 |
|---|---|
| 打包产物（Electron 宿主）四项信任条件 | `xhrNative`/`xhrOpenNative`/`addELNative` 全为 `true`，`window.OCS` 不存在 → `checkout()` 不成立 |
| 宿主其它指纹（记录备查） | `navigator.webdriver === true`、UA 带 `Electron/44.3.0`（站点侧当前未检查这两项） |
| 夹具 `tests/fixtures/anti-script-guard.html` | 复刻 ① 的守卫 + 播放器点击捕获层（播放按钮被压住，普通 click 必然失败） |
| `tests/integration/anti-script-guard.test.ts` | `play()` 全程无不可信点击；把 `tryClick` 改回旧的 JS 兜底时该用例失败（`scriptDetected === true`），改回修复版即通过 |

**修复**：自动化代码不再派发任何合成点击。

- `locators.ts::safeClick`：`click()` → `click({ force: true })`。`force` 跳过的只是
  「遮挡 / 可见性 / 稳定性」这些前置检查，点击仍由浏览器输入管线发出，
  `isTrusted === true`，与真人点击等价。
- `video-controller.ts::tryClick`、`quiz.ts` 选项兜底、`map/navigator.ts::openResource`
  统一走 `safeClick`。
- `classic/navigator.ts`：学习进度卡片的关闭按钮改为「evaluate 里取按钮中心坐标 →
  `page.mouse.click()`」；没有可点的关闭按钮时仍然直接移除节点（不派发事件）。
  「学前必读」弹窗在找不到可见关闭按钮时改为移除 DOM，不再 JS 点击。

**用户可见**：不再弹「检测到异常脚本」，视频连续播放，不再跳回首页。

### 恢复播放 / 点击"反应很慢"（已修）

**现象**（用户反馈）：
- 视频暂停后（刚开始播放时、或刚关掉一个弹窗后）再次开播，中间要等很久；
- 其它有些点击也半天没反应。

**实测基线**（DOM 夹具，`VideoController.play()` 端到端耗时）：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 大播放按钮可见，首次开播 | 3 065 ms | 43 ms |
| 视频播过一段被暂停，恢复播放 | **18 044 ms** | 29 ms |
| 大播放按钮被遮罩挡住 | 7 053 ms | 1 323 ms |

**原因**（三处叠加）：
1. `play()` 开头固定 `SLEEP.long`（2 秒）；
2. `firstVisible(page, PLAY_BTN_CSS, TIMEOUT.medium)` 是**每个候选各等一个超时**：
   3 个候选 × 5 秒 = 15 秒，只因为播放器在暂停时把大播放按钮藏了起来；
3. 每级策略点完固定睡 1 秒再读状态；被遮罩挡住时 Playwright 的 `click()`
   还会先重试到超时才失败。

**修复**：
- `video-controller.ts` 增加**策略 0：原生恢复** —— 视频已经播过一段
  （`currentTime > 0`）又被暂停时直接调 `video.play()`，毫秒级返回，
  且完全**不产生点击事件**（顺带绕开上一节的防脚本守卫）。
- 可见性探测改成 `firstVisibleWithin(..., 预算)`：预算是整个策略共享的，
  预算内轮询、命中即返回（`PLAY_PROBE`，`constants.ts`）。
- 点击后的等待改成 `waitForPlaying()` 自适应轮询，不再固定睡 1 秒。
- `locators.ts` 的 `safeClick` 先做一次 `elementFromPoint` 遮挡判断：
  被遮住就直接按坐标点击，不再先白等一个 timeout。

**回归测试**：`classic-dom.test.ts`「暂停后恢复走原生快路径，1 秒内完成」、
`anti-script-guard.test.ts` 里 `safeClick` 的"被遮挡时 500 ms 内返回"断言。

### 第一个课程被跳过（已修）

**现象**（用户反馈）：多个课时从第二个开始播放，第一个永远不刷。

**原因**：课程页一加载，站点就把列表**第一项**标成 `current_play`（自动选中并载入
播放器）。而起点用的是 `firstPlayable()` = `nextVideoAfter(null)` ——
`nextVideoAfter` 的语义是"当前项**之后**的下一项"，于是直接跳过了第一个视频。
（v1 的 `_run` 也是这么取起点的，属于同源缺陷。）

**修复**（`classic/navigator.ts::firstPlayable`）：起点只看列表顺序，
取第一个"可播放"（有标题、非小章节、按配置跳过已完成）的项，**不看 `current_play`**。
`nextVideoAfter()` 保持原语义不动（循环里靠它推进）。

**回归测试**：`classic-dom.test.ts` 三条 —— `firstPlayable` 在
`current_play` 指向当前项时不跳到下一项；跳过已完成的 1.1 但不越到 1.3；
`skipCompleted=false` 时从列表第一项开始。

**连带修掉的第二处**（同一根因）：`nextVideoAfter()` 定位"当前位置"的顺序
从「`current_play` 优先」改成「**传入标题优先**，找不到再退回 `current_play`」。
v1 是前者，而站点一加载就把第一项标成 `current_play`，于是「从上次进度继续」
也会被带跑 —— 明明该从上次那节之后开始，却从第一项之后开始。
循环里机器人自己知道刚处理完哪一节，标题比 DOM 可信；`current_play` 保留为兜底
（列表改版、标题被改写时仍能找到位置）。这是**有意偏离 v1** 的一处，
`runner-loop.test.ts` 的「从上次进度继续」用例现在真的走 lastVideoTitle 这条路径。

### 登录会话复用与持久化（新增）

**现象**（用户反馈）：课程窗口里已经是登录状态，一点开始还是跳回登录页重登一次；
每次开课都要重新登录。

**原因**：
1. 两个登录提供方的 `alreadyLoggedIn()` 都是"导航到站点首页，然后判断当前 URL
   是否包含 `settings.loggedUrl`" —— 首页 URL 永远不会包含那个工作台地址，
   所以检查恒为 false，等于每次必登；v1 的 `check_already_logged_in()` 同病。
2. Browser Host 的 profile 放在系统临时目录（`<tmpdir>/auto-course-browser-host`），
   macOS 会定期清理，会话根本留不住。

**修复**：
- 新增 `automation/login/session-check.ts`：
  - `checkCourseSession()`：**直接导航到课程页**看最终落在哪。
    智慧树学习页是 SPA，未登录时 HTTP 依然 200、没有 `Location` 头，
    跳登录页是前端 JS 干的（实测 `page.request` 拿不到信号），所以只能用最终 URL 判断；
    会话里连该站点的 cookie 都没有时先短路，省掉这次导航。
  - `isUpcPortalSessionAlive()`：这个**纯请求**就能判断（实测未登录时
    `i.upc.edu.cn` 302 到 `cas.upc.edu.cn/cas/login`），走 `page.request`（浏览器自身的
    请求能力，与页面共享 cookie）。
  - `isLoginUrl()`：认智慧树 `login./passport.` 与 CAS `/cas/login` 等形态。
- 两个登录提供方都改成：**课程页会话还在 → 直接复用，一步都不多做**；
  数字石大再退一步：门户会话还在就不必再注入账号密码（CAS 表单根本不会出现，
  旧实现在这里会弹"请手动登录"并干等用户）。
- Host profile 落到 `<userData>/browser-profile`（`browser-host.ts` 的
  `--profile-dir`），**跨应用重启保留**；首次启动会把旧临时目录里的会话搬过来。
- `ClassicCourseNavigator.navigate()` 在已经在目标 URL 时跳过重复导航
  （登录态检查刚把我们带过去）。

**回归测试**：`tests/unit/session-check.test.ts`（`isLoginUrl` 的正反例、
`hasCookiesFor` 的父域/空会话）。

**实测**（打包产物，`--profile-dir` 指向新目录）：

| 步骤 | 结果 |
|---|---|
| 宿主 A：打开 `www.zhihuishu.com` | 写入 4 个 cookie，`Cookies` 文件落盘 |
| 宿主 B：**同一个 profile 目录重新启动宿主进程** | cookie 仍在（会话跨进程/跨重启保留） |

（应用层"是否真的把 `--profile-dir` 指向 `<userData>/browser-profile`"一处
只做了代码核对：验证时本机已有一个 dev 实例占着单实例锁，起不来第二个；
宿主侧对 `--profile-dir` 的行为已由上面两步实测确认。）

### 顺带修掉：下载取消时的未捕获异常

全量测试偶发以 1 退出，报 `Unhandled Errors: ENOENT .../cancel.bin`：
`media.ts::downloadMedia` 在 `shouldStop` 取消时用 `stream.close()` 关掉 fd，
但缓冲里还可能残留写入，之后以 ENOENT 冒成未捕获异常带崩进程/测试。
另外写入期间一旦 stream 报错，主循环里没有 error 监听，同样会变成未捕获异常。

**修复**：常驻一个 `error` 监听并把错误记下来，循环里检查；
等落盘改成 `once('finish')` / `once('error')`；取消时用 `stream.destroy()`
而不是 `close()`。`tests/unit/media.test.ts` 连跑 3 次都是 11/11 通过。

### 智慧树登录：被弹到登录页之后登不进去、也不重试（已修）

**现象**（用户反馈）：课程页一旦把未登录的会话重定向到登录页，程序就卡住 ——
不会自动重新登录，也没有任何提示，不会重试。

**两个原因**：
1. **登录页换了。** 2026-09 智慧树把登录搬到独立的「登录中心」
   `https://login.zhihuishu.com/`（Element UI 单页应用，被重定向去的也是这里）；
   我们的流程还在打 v1 的老入口 `onlineweb.zhihuishu.com` + 老选择器
   （`#lUsername` / `.wall-sub-btn`）—— 那边表单已经藏进弹窗、**不可见**，
   所有候选都等超时也命中不到（实测：老页面上 4 个 input 全部 `visible=false`）。
2. **兜底提示用错了 API。** `captcha.checkAndHandle()` 在屏幕上没有验证码时
   立刻返回 false，而"找不到输入框就请人工登录"这条兜底用的正是它 ——
   所以既不弹提示也不等待，直接返回失败：用户看到的就是"停在登录页不动了"。

**修复**：

| 位置 | 改动 |
|---|---|
| `constants.ts` | 登录入口 → `ZHIHUISHU_LOGIN_URL = https://login.zhihuishu.com/`；选择器换成新 UI：`input[name=mobile]`、`input[type=password]`、`[class*="btn-block__grandient_login"]`、`.el-tabs__item`（老选择器保留为后续候选） |
| `zhihuishu.ts` | 登录改成**最多 3 轮**，每轮重新进登录页；成功判据从"URL 含 `loggedUrl`"（那是数字石大工作台，智慧树登录永远跳不过去）改成"**离开登录页**"；滑块只在最后一轮请人工 |
| `captcha.ts` | 新增 `requestManualHelp()`（不检测验证码，直接请求人工），`checkAndHandle()` 复用它 |
| `upc.ts` | "CAS 表单注入失败"的兜底同样改用 `requestManualHelp` |

**验证**（局部，未跑全量）：真实登录中心上四个主选择器全部命中**可见**元素
（`input[name=mobile]` / `input[type=password]` / `.btn-block__grandient_login`（文本"登录"）
/ `//div[contains(@class,'el-tabs__item')][contains(text(),'账号登录')]`）；
新夹具 `tests/fixtures/login/center.html` + `tests/integration/zhs-login.test.ts`
三条用例：填表并判定成功、第一轮没表单会重来第二轮成功、点了登录仍停在登录页时
重试用完才请人工。

### 数字石大登录：新旧流程拆分，机构 SSO 直达 CAS（行为变化）

Chrome 实测确认两条链路共享同一个 UPC CAS 表单，但服务目标不同：

- 旧门户：`i.upc.edu.cn → CAS(service=i.upc.edu.cn/dcp/index.jsp) → 数字石大门户`
- 机构 SSO：`CAS(service=upcsso.zhihuishu.com/authorize) → oc.zhihuishu.com/oauth/callback/upc → 智慧树`

CAS 外层页面包含标准 POST 表单，字段为 `username`、`password`、`type`、
动态 `execution` 与 `_eventId=submit`。因此新流程无需进入智慧树登录中心、搜索学校、
点击「去登录」，也无需访问 iframe 内部的 Vue 实例。新流程直接打开构造好的 CAS
service URL，再通过 `form#loginForm.requestSubmit()` 提交标准字段，由浏览器原生处理
CAS/OAuth 重定向和 Cookie。纯 `page.request` 方案尚未通过真实账号完整验证；早期夹具
存在未实际提交表单的问题，不能据此认定 Electron/Playwright 的 Cookie 共享失效。

新旧模块现在完全分开：

| 设置项 | 实现 | 行为 |
|---|---|---|
| 数字石大 · 机构 SSO（新） | `upc-institution.ts` + `upc-cas.ts` | 直达 CAS 并等待授权落地；超时保留现场，检测到可见验证码才提示处理 |
| 数字石大 · 旧门户（兼容） | `upc-legacy.ts` | 保留原 iframe/Vue 注入与工作台跳转 |

旧设置值 `upc` 继续映射旧门户；新流程使用 `upc-institution`。两者不会互相自动回退，
避免一条链失败后又绕进另一条链。新流程不要求“登录跳转 URL”，旧门户仍要求。

验证：Chrome 逐页确认了两条真实 service URL 与 CAS POST 字段；本地集成测试验证
表单登录会跟随 302、Cookie 会进入页面上下文、新旧 provider 按设置独立选择。
真实凭据提交未由测试代码执行；这些测试通过不代表真实账号登录已经通过。

登录态复用现在还要求导航后仍位于原课程入口的同一 origin 与 pathname。
失效会话会短暂经过 `onlineh5.zhihuishu.com/onlineWeb.html#/studentIndex`，此前只排除
`login.*` 会把这个中间页误判为登录成功；现在会继续执行所选登录模块。

### 2026-09-16 登录异步跳转与失败中止

用户日志确认 `wxTransit/3` 仍处于授权链路，旧实现等待 500ms 就按域名判失败。
新机构流程最多等待 45 秒，只接受明确的工作台/课程中心落点，之后重新验证课程会话；
传统课还必须出现课程目录，不能仅凭 URL 与 Cookie 判成功。若一直停留在中转页，
报告授权超时并保留现场，不导航课程页。`state=09876999` 是浏览器观察到的参数，
没有证据证明先前随机 state 就是实际故障根因。

旧门户在调用 Vue 登录方法后，等待实际到达 `i.upc.edu.cn/dcp/index.jsp`，再跳工作台。
两个课程运行器在 `LoginResult.ok=false` 时返回 error（用户停止则返回 user），不继续运行。
回归覆盖延迟中转、持续中转超时、门户延迟认证、停止等待及两个运行器的失败分支。
