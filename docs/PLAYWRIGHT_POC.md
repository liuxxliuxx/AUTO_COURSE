# Playwright PoC 报告

> Phase 2 验收物（`docs/v2_handoff.md` §25）
> 结论：**Gate 通过**，但连接方式与 handoff 的默认假设不同 —— 见 §1。
> 复现：`node scripts/poc/02-host-full-matrix.mjs`（离线夹具）/ 去掉 `--offline` 加跑真实站点。

---

## 1. 连接方式（本 PoC 的最重要结论）

### 1.1 结论先行

**Playwright 无法接管 Electron 自带的 Chromium。**

handoff §4 假设可以在「Playwright Electron API」与「Playwright / CDP attachment」之间二选一。
实测表明：**两者对 Electron 自身的 BrowserWindow 都不可行**，必须另起一个专用的
Browser Host 进程。

### 1.2 证据

三个独立实验，结论一致。脚本保留在 `scripts/poc/`。

| 实验 | 做法 | 结果 |
|---|---|---|
| `01-cdp-connect.mjs` | `chromium.connectOverCDP()` 打 Electron 的 **browser** 端点 | WebSocket 连上了，随后**握手卡死**，30s 超时 |
| `01b-cdp-page-target.mjs` | `connectOverCDP()` 打 `/json/list` 里的**页面级**端点 | 连接"成功"，但 `contexts()[0].pages()` 返回 **0 个页面** |
| `01c-raw-cdp-probe.mjs` | 裸 CDP 探针，不用 Playwright | `Target.getTargets` ✅、`Target.setAutoAttach` ✅（能收到 `attachedToTarget`）、`Target.attachToTarget(flatten)` ✅ —— 但 session 上发 `Runtime.enable` / `Runtime.evaluate` **全部超时** |
| `01d-session-routing.mjs` | 把所有路由变体都试一遍 | flatten session / 非 flatten / 直连页面级 ws —— **`Runtime.*` 一律不回应** |

补充观察：

- Electron 的 `/json/list` 里 `url` 与 `title` **恒为空字符串**，不能按 URL 匹配 target。
- 页面级 ws 上 `Target.getTargetInfo` 与 `Page.getNavigationHistory` **是正常返回的** ——
  说明不是网络或协议问题，而**只有 `Runtime` domain 被 Electron 拿掉了**。

### 1.3 为什么这是致命的

Playwright 的 `locator()` / `click()` / `fill()` / `waitFor()` / `evaluate()`
**全部**建立在 `Runtime.evaluate` 之上。`Runtime` 不可用 ⇒ Playwright 在这条通道上
一行都跑不了。这不是配置问题，没有绕过的余地。

### 1.4 采用的方案：专用 Electron Browser Host

同一个 Electron 二进制，加 `--browser-host` 标志再起一个进程：

```
Electron Main (应用本体)
   │  IPC / in-process
   ▼
BrowserService  ─── Playwright _electron.launch() ───►  Electron Browser Host 进程
                                                          └─ 只有一个 BrowserWindow
                                                             （课程网页）
```

- 分流发生在 `src/main/index.ts`，早于任何重模块加载 —— 应用本体要抢
  userData 排他锁，宿主不能跟着抢；宿主也不该加载 SQLite / BotService / IPC。
- 宿主代码：`src/main/automation/browser-host.ts`（**只有**窗口 + 下载落盘，无业务）。
- 宿主用独立的 `userData`（`<tmpdir>/auto-course-browser-host`），避免与主应用抢锁。
- 课程业务代码只与 `BrowserService` / `BrowserSession` 交互，**不直接持有 Playwright 对象**。

这个方案同时满足 handoff §4（最终使用 Playwright API）与 §7（远程内容跑在
Electron WebContents 里、且 `nodeIntegration:false` / `contextIsolation:true` / `sandbox:true`）。

---

## 2. 已通过场景（31/31）

复现结果：`===== 31/31 通过 =====`

### 2.1 本地夹具（`tests/fixtures/`，经 http 提供）

夹具刻意复刻真实 DOM 结构，而不是简化版；检测逻辑（验证码关键字表、图谱资源
类型判定）直接从 `src/constants.py` / `map_course.py` 搬过来验证。

| # | 场景 | 结果 |
|---|---|---|
| 1 | `_electron.launch()` 拉起 browser-host | ✅ |
| 2 | 页面导航与加载 | ✅ |
| 3 | 元素定位 `locator()` | ✅ |
| 4 | `click()` | ✅ |
| 5 | `fill()` / 输入回读 | ✅ |
| 6 | 动态 SPA 元素（延迟插入后出现） | ✅ |
| 7 | iframe 内定位与输入 | ✅ |
| 8 | iframe 内注入 `#app.__vue__` 并调用组件方法（UPC `passwordLogin`） | ✅ |
| 9 | 读取 `<video>` 播放状态（`duration` 真实可用） | ✅ `duration=1.94s` |
| 10 | 驱动 video 播放/暂停并读回状态 | ✅ `currentTime` 确实前进 |
| 11 | 弹题对话框检测与选项点击（`.el-dialog[aria-label*="弹题"]` + `.topic-option-item.active`） | ✅ |
| 12 | 验证码弹窗检测（`.yidun_popup`） | ✅ |
| 13 | 验证码人工确认后检测自动消失 | ✅ |
| 14 | 验证码 iframe 关键字检测 | ✅ 命中 `cstaticdun` |
| 15 | cookies 读写 | ✅ |
| 16 | cookie 随请求带回（会话保持基础） | ✅ |
| 17 | `localStorage` / `sessionStorage` | ✅ |
| 18 | 多页面跳转与 `goBack()` | ✅ |
| 19 | 导航事件可订阅（`framenavigated`） | ✅ |
| 20 | download：HTTP 附件经宿主 `will-download` 落盘 | ✅ `course-material.pdf` |
| 21 | download：blob 下载不触发（已确认限制，见 §3.2） | ✅ 符合预期 |
| 22 | `captureStream()` 能取到音轨 | ✅ `audioTracks=1` |
| 23 | `MediaRecorder` 录制音轨并产出 WebM | ✅ `audio/webm;codecs=opus`，14786 bytes |
| 24 | `screenshot()` 取证 | ✅ |
| 25 | 传统课程列表解析（`li.video` / `.small-lesson` / `.catalogue_title` / `.time_icofinish`） | ✅ 6 项，可播放 6，已完成 2 |
| 26 | 图谱课程知识项解析（`[id*='knowledgeId-']`） | ✅ 3 个知识项 |
| 27 | 宿主窗口可正常关闭并被回收 | ✅ |

### 2.2 真实目标站点（联网）

| # | 场景 | 结果 |
|---|---|---|
| 28 | 智慧树登录页可达并渲染 | ✅ 页面有 1 个 `input[type=password]` |
| 29 | 智慧树登录页选择器命中（v1 `constants.py` 迁移核对） | ⚠️ 命中 `input[placeholder*="手机号"]`，即**第 3 个候选** |
| 30 | UPC 统一认证页可达 + CAS iframe 检测 | ✅ 命中 `login-normal` iframe |
| 31 | 图谱课程站可达 | ✅ 重定向到「登录中心」 |

> **第 29 项需要留意**：v1 的 `LOGIN_USERNAME_CSS` 首选 `#lUsername`，实测该 id 已不在页面上，
> 靠第 3 候选 `input[placeholder*="手机号"]` 才命中。迁到 v2 时必须保留**多候选依次尝试**
> 的策略，不能只留一个选择器。

### 2.3 尚未验证的场景（无凭据，PoC 覆盖不到）

以下需要真实账号才能进入登录后的页面，本 PoC **未能验证**，必须在 Phase 4/5 的
端到端测试中补：

- 登录后的课程列表 / 视频播放器真实页面结构
- 真实弹题（本 PoC 用的是结构等价的夹具）
- 真实滑块验证码
- 真实图谱课学习页的资源卡片
- 视频真实直链下载（`视频URL` 提取，仅转录模式依赖）
- SenseVoice 转录端到端

---

## 3. Electron 特有问题

### 3.1 `Runtime` domain 缺失（致命，已通过 Host 方案规避）

见 §1.2/§1.3。**这是本次重构最关键的架构约束。**

### 3.2 blob 下载不触发 `will-download`

| 下载来源 | Playwright `download` 事件 | 宿主 `session.on('will-download')` |
|---|---|---|
| HTTP 附件（`Content-Disposition: attachment`） | ❌ 不触发 | ✅ 触发，可 `setSavePath` 落盘 |
| `blob:` URL + `<a download>` 点击 | ❌ 不触发 | ❌ **不触发** |

**影响**：v1 的实时录音模式靠「`MediaRecorder` 录完 → 造 blob → `<a download>` 点击 →
文件落到 CDP 指定的下载目录」（`audio_capture.py::_STOP_AND_DOWNLOAD_JS`）。
这条路在 v2 **走不通**。

**v2 采用的替代方案**：
- 录音产物**不经浏览器下载**，改为页面内 `ondataavailable` 攒块 → Node 侧
  `page.evaluate()` 分批取走并 append 到文件（顺带解决长录音一次性搬运 100MB+ 的问题）。
- 仅转录模式本来就该走 Node 侧 `fetch` + cookies（v1 用的是 Python `requests`），
  根本不经过浏览器下载。
- 宿主仍保留 `will-download` 处理，作为页面自发下载的兜底。

### 3.3 `/json/list` 的 `url` / `title` 恒为空

Electron 不填充这两个字段。任何按 URL 匹配 target 的逻辑都会失败
（本 PoC 因此先按 `type === 'page'` 匹配）。Phase 4 起由 Host 方案规避：
窗口句柄由 Playwright 的 `firstWindow()` / `waitForEvent('window')` 直接给出。

### 3.4 宿主必须使用独立 userData

Electron 对 `userData` 目录有排他锁。若宿主沿用主应用的目录，宿主进程起不来。
已固定为 `<tmpdir>/auto-course-browser-host`。

---

## 4. 与 Legacy Selenium 的对比

| 维度 | v1（Selenium + ChromeDriver） | v2（Playwright + Electron Host） |
|---|---|---|
| 驱动匹配 | ChromeDriver 必须与 Chrome 版本严格对应，v1 为此写了 3 级查找 + 自动下载（`browser.py` 258 行） | Playwright 与 Electron 由本仓库锁定版本，**无需驱动匹配** |
| 浏览器来源 | 系统 Chrome / `bin/` 缓存 / 下载 / `webdriver-manager` 四级回退 | Electron 自带 Chromium，**零额外下载** |
| 元素定位 | `find_element(By.CSS_SELECTOR, ...)`，多候选要手写循环（`utils/element_finder.py`） | `locator()` 自带 auto-wait 与严格模式 |
| 等待 | 显式 `time.sleep()` 遍布全文（v1 `constants.py` 有 8 个 sleep 常量） | `waitFor()` / 断言式等待，逐步替换固定 sleep |
| iframe | `switch_to.frame()` 之后**必须记得切回来**（v1 `upc.py` 里有 `switch_to.default_content()`） | `frameLocator()` 无状态，不存在"忘记切回"的类 bug |
| 下载 | CDP `Browser.setDownloadBehavior` + 轮询目录（`audio_capture.py::_wait_for_download`，含 3 次稳定大小判定） | 宿主 `will-download` + 索引文件（HTTP 附件可用；blob 需绕开，见 §3.2） |
| 反检测 | v1 打了 `navigator.webdriver` 补丁 + `excludeSwitches` 等（`browser.py:229`） | **不打任何补丁**（handoff §5 要求） |
| 多窗口 | 单一 driver 句柄 | `electronApp.windows()` 显式管理 |

**结论**：Playwright 在可靠性上是净收益，最大的收益是彻底消除了
ChromeDriver 版本匹配这一 v1 的历史包袱
（git log 里 `优化 chromedriver 查找路径问题`、`chrome 和 chromedriver 的选择逻辑` 两条提交即为此）。

**代价**：多一个 Electron 进程；Playwright 的 Electron 支持标记为实验性，
升级 Electron / Playwright 版本时需重跑本 PoC 脚本。
`package.json` 因此对 `electron` 与 `playwright-core` 的版本要谨慎升级。

---

## 5. 对后续 Phase 的约束

1. **Phase 3 起**：`BrowserService` 必须独占 Host 进程与 Playwright 句柄；
   业务代码只拿 `BrowserAutomation` 接口，不得自行 `launch` 或 `close`。
2. **Phase 4**：登录选型必须保留多候选选择器（§2.2 第 29 项）。
3. **Phase 6**：录音产物走 Node 侧分批取块，**不得**依赖浏览器下载。
4. **Phase 6**：仅转录的媒体获取走 Node `fetch` + `context.cookies()`，不经过浏览器。
5. **Phase 8**：打包需验证「应用本体 + Host 子进程」在 packaged 模式下能正确分流
   （`app.isPackaged` 时 `_electron.launch` 的 `args` 不再需要 app 路径）。
6. **任何 Electron / Playwright 版本升级**：重跑 `scripts/poc/02-host-full-matrix.mjs`。

---

## 6. 复现方式

```bash
# 只跑本地夹具（无需网络）
node scripts/poc/02-host-full-matrix.mjs --offline

# 夹具 + 真实站点联网检查
node scripts/poc/02-host-full-matrix.mjs

# 架构决策的原始证据
node scripts/poc/01-cdp-connect.mjs        # browser 端点 CDP 挂死
node scripts/poc/01b-cdp-page-target.mjs   # 页面端点拿到 0 个 page
node scripts/poc/01c-raw-cdp-probe.mjs     # Runtime.* 超时
node scripts/poc/01d-session-routing.mjs   # 所有 session 路由变体
```

结果同时写入 `tests/.tmp/poc/results.json`，截图写入 `tests/.tmp/poc/`。
