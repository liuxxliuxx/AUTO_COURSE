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
| UPC SSO 登录 | ⚠️ 已迁移，**未经真实账号验证** |
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

## 六、Legacy 保留与删除

按 handoff §24，v1 实现**暂时全部保留**：

```
src/                      Python 业务层（Selenium）
gui/                      PySide6 + QML
main.py / database.py / config.py
src/transcriber/          旧转录三件套（1600+ 行）
scripts/build_win.ps1     PyInstaller / NSIS
scripts/build_mac.sh      py2app
```

删除条件（handoff §25 Phase 9）：上面表格中标 ⚠️ 的项全部通过端到端验证之后，
执行 `refactor: remove selenium browser backend` 与
`refactor: remove pyside and qml application` 两个提交。

**唯一确定可以删除的是 `src/transcriber/`** —— v2 的转录链路已端到端跑通，
它的行为已被 `python/transcriber/worker.py` + `services/media.ts` +
`services/transcription-service.ts` 取代。之所以留着，是因为
`audio_capture.py` 里记着 v1 踩过的坑（MediaRecorder 不传 mimeType/timeslice、
WASAPI 回环设备选择），在打包环境复验之前仍是有价值的参考。

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
