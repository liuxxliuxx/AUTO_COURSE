# AUTO_COURSE v2 Electron Rewrite — Agent Handoff

> Status: Draft v0.1
> Target stack: **Electron + Vue 3 + TypeScript + Playwright**
> Legacy baseline: current `dev_beta`
> Rewrite branch: `rewrite/electron`

---

# 1. 项目背景

AUTO_COURSE 当前是一个以 Python 为核心的桌面应用，主要用于智慧树课程自动化。

当前 `dev_beta` 已经包含：

* PySide6 + QML 桌面 GUI
* Selenium + Chrome/ChromeDriver 浏览器自动化
* 智慧树账号密码登录
* 中国石油大学（华东）“数字石大”统一认证登录
* 传统课程自动刷课
* 新版知识图谱课程自动刷课
* 课程视频播放监控
* 弹题处理
* 验证码人工确认流程
* 自动调度
* 每日观看进度
* SQLite 持久化
* keyring 凭据存储
* SenseVoice/FunASR 语音转文字
* ffmpeg 音频处理
* Windows/macOS 打包

项目已经明显超过“Python Selenium 脚本”的规模。

v2 的目标是重新划分桌面 UI、业务编排和浏览器自动化的边界，使主要应用代码统一进入 TypeScript/Electron 技术栈。

---

# 2. 本次重构的核心目标

本次重构不是增加大量新功能，而是进行一次 **架构迁移 + 功能等价重写**。

目标架构：

```text
┌──────────────────────────────────────────┐
│               Electron App               │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Vue 3 Renderer                     │  │
│  │                                    │  │
│  │ Dashboard / Settings / Logs        │  │
│  └─────────────────┬──────────────────┘  │
│                    │ Typed IPC            │
│  ┌─────────────────▼──────────────────┐  │
│  │ Electron Main / Node.js            │  │
│  │                                    │  │
│  │ BotService                         │  │
│  │ SchedulerService                   │  │
│  │ StorageService                     │  │
│  │ CredentialService                  │  │
│  │ TranscriptionService               │  │
│  │ BrowserAutomation                  │  │
│  └─────────────────┬──────────────────┘  │
│                    │                     │
│              Playwright                  │
│                    │                     │
│              Chromium Page               │
└────────────────────┼─────────────────────┘
                     │
                     ▼
                 智慧树网页

Electron Main
      │
      └──── stdin/stdout NDJSON ────► Python STT Worker
                                      SenseVoice/FunASR
```

最终希望移除：

```text
PySide6
QML
Python GUI Bridge
Python Selenium
ChromeDriver
webdriver-manager
独立 Chrome for Testing
```

Python 在本次重构完成后的唯一预期职责是：

```text
WAV / audio
     ↓
SenseVoice
     ↓
transcription text
```

---

# 3. 已锁定技术栈

本次 v2 使用：

```text
Desktop:       Electron
Frontend:      Vue 3
Language:      TypeScript
Build:         Vite
Automation:    Playwright
Persistence:   SQLite
Credentials:   Electron safeStorage
IPC:           Electron preload + contextBridge
Audio tools:   ffmpeg
STT:           Python + FunASR/SenseVoice（暂时保留）
```

不引入 Flask。

不建立 localhost HTTP API。

Renderer 与 Main Process 之间只通过经过 preload 暴露的 typed IPC API 通信。

---

# 4. 一个必须首先验证的技术风险

**禁止在开始重构时直接删除 Selenium。**

首先必须完成 Playwright + Electron Chromium 的 PoC。

需要验证：

```text
Electron runtime
       ↓
Playwright
       ↓
课程网页
```

在实际目标网页中能够稳定完成：

* 页面导航
* iframe
* 元素定位
* click
* fill/input
* 动态 SPA 页面
* 视频元素读取
* 视频播放状态检测
* 弹题
* 验证码页面
* cookies/session
* 多页面/跳转
* download
* MediaRecorder 或媒体获取
* 传统课程页面
* 图谱课程页面
* UPC SSO 页面

Playwright 与 Electron 的具体连接方式 **不在本文档中提前锁死**。

Agent 应通过 PoC 决定采用：

```text
Playwright Electron API
```

还是：

```text
Playwright / CDP attachment
```

或其他合理的 Playwright + Electron Chromium 连接方式。

目标是最终使用 Playwright API，而不是在业务代码中大面积直接调用：

```text
webContents.executeJavaScript(...)
```

---

# 5. 关于网站自动化检测

不要假设 Playwright、isolated world 或 Electron 对网站“不可检测”。

本项目不应把以下技术作为基础能力：

```text
浏览器指纹伪造
navigator API hook
stealth plugin
反自动化检测绕过
大量 prototype patch
伪造浏览器环境
```

目标是：

> 使用标准浏览器自动化能力完成正常页面交互。

如果 Electron/Playwright 在某个真实页面存在兼容性问题，应：

1. 记录具体问题。
2. 保留架构抽象。
3. 不通过不断增加反检测 hack 解决。

在 Playwright 兼容性验证完成前，Legacy Selenium 作为参考和临时 fallback 保留。

---

# 6. BrowserAutomation 抽象

课程业务逻辑不应直接依赖 Electron BrowserWindow 或 Playwright 的全局实例。

应建立统一自动化接口。

概念示例：

```ts
interface BrowserAutomation {
  navigate(url: string): Promise<void>

  getCurrentUrl(): Promise<string>

  locator(selector: string): Locator

  getCookies(): Promise<Cookie[]>

  waitForNavigation(...): Promise<void>

  onNavigation(...): void

  onDownload(...): void

  close(): Promise<void>
}
```

实际接口可根据 Playwright API 调整。

核心要求是：

```text
ClassicCourseRunner
MapCourseRunner
LoginService
CaptchaService
QuizService
```

不能自行管理 Chromium 生命周期。

浏览器生命周期由统一：

```text
BrowserService / BrowserAutomation
```

负责。

---

# 7. 浏览器页面安全要求

任何加载智慧树、UPC 或其他远程内容的 Electron WebContents 必须：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

远程网页不得获得：

```text
fs
child_process
ipcRenderer
SQLite
Python process
本地文件系统
Electron Main API
```

权限。

自动化控制必须由 Main Process / Playwright 侧完成。

Vue Renderer 同样不得直接访问：

```text
fs
SQLite
child_process
BrowserWindow
Python worker
```

Renderer 只能通过 preload 暴露的白名单 IPC API 工作。

---

# 8. v1 当前业务模型

当前存在两套明显不同的课程模式。

## 8.1 Classic Course

即传统智慧树课程。

当前主要实现对应：

```text
src/bot/course.py
src/bot/video.py
src/bot/quiz.py
src/bot/captcha.py
src/bot/login/*
src/bot/bot_core.py
```

概念流程：

```text
登录
 ↓
进入传统课程页面
 ↓
解析章节/视频
 ↓
选择未完成视频
 ↓
播放
 ↓
监控：
  ├─ pause
  ├─ progress
  ├─ captcha
  └─ quiz
 ↓
完成
 ↓
下一视频
```

v2 应明确建立：

```text
ClassicCourseRunner
ClassicCourseNavigator
VideoController
```

---

# 9. Map Course

新版图谱课程不是 Classic Course 的一个小变种。

它的页面模型是：

```text
知识图谱
 ↓
知识项
 ↓
必学资源
 ├─ 视频
 └─ 非视频资源
```

当前主要实现在：

```text
src/bot/map_course.py
```

v2 应独立建立：

```text
MapCourseRunner
MapCourseNavigator
```

不要继续：

```ts
if (mapMode) {
  ...
} else {
  ...
}
```

把两套业务长期塞进一个巨大 Bot 类。

---

# 10. 推荐核心架构

```text
BotService
│
├── ClassicCourseRunner
│   ├── ClassicCourseNavigator
│   ├── VideoController
│   ├── QuizService
│   └── CaptchaService
│
└── MapCourseRunner
    ├── MapCourseNavigator
    ├── VideoController
    └── CaptchaService
```

共享：

```text
BrowserService
LoginService
StorageService
CredentialService
EventBus
TranscriptionService
```

BotService 负责生命周期：

```text
idle
 ↓ start
starting
 ↓
running
 ↓
stopping
 ↓
idle
```

不要让 UI 自己维护 Bot 的真实生命周期。

---

# 11. 登录模块

需要保留两种登录方式：

```text
ZhihuishuLogin
UPCLogin
```

目标接口：

```ts
interface LoginProvider {
  login(session: BrowserAutomation): Promise<LoginResult>
}
```

不要将不同登录方式写成大量：

```ts
if (loginType === ...)
```

散落在 Runner 中。

---

# 12. Captcha

验证码继续采用：

> 自动检测 + 用户人工处理 + 程序继续。

不要尝试增加验证码自动破解功能。

目标事件：

```text
CaptchaService
      ↓
captcha-required
      ↓
EventBus
      ↓
IPC
      ↓
Vue
```

用户确认：

```text
Vue
 ↓
captcha.confirm()
 ↓
IPC
 ↓
CaptchaService
 ↓
resume
```

---

# 13. Quiz

保留当前基本行为。

本次重构不增加：

```text
AI 答题
OCR 搜题
联网搜答案
题库系统
```

QuizService 只需要迁移现有能力。

如果当前行为本身存在明显 bug，可以修复，但必须：

```text
单独 commit
+
在 migration notes 中记录
```

---

# 14. Vue Renderer 边界

Vue 只负责展示和用户输入。

推荐主要页面：

```text
Dashboard
Settings
```

Dashboard 负责：

```text
当前状态
课程选择
模式选择
启动 / 停止
今日进度
日志
验证码提示
转录状态
```

Settings 负责：

```text
账号
登录方式
课程配置
刷课配置
浏览器/自动化相关必要配置
转录
自动调度
外观
```

不要在 Renderer 中实现业务状态机。

---

# 15. Typed IPC

建议 preload 暴露类似：

```ts
window.appApi = {
  bot: {
    start(),
    stop(),
    status()
  },

  settings: {
    getAll(),
    update(...)
  },

  courses: {
    list(),
    select(...)
  },

  captcha: {
    confirm()
  },

  browser: {
    openCourseWindow()
  },

  events: {
    onBotStatus(...),
    onLog(...),
    onCaptchaRequired(...),
    onTranscriptionStatus(...)
  }
}
```

不要直接暴露：

```text
ipcRenderer
```

给 Vue。

所有 IPC channel 统一定义 TypeScript 类型。

---

# 16. EventBus

当前 Python Bridge 使用多个 Queue + QTimer。

v2 改成：

```text
Core Service
 ↓
EventBus
 ↓
Electron Main
 ↓ IPC
Renderer
```

事件至少包括：

```text
bot-status
log
progress
course-changed
captcha-required
transcription-status
scheduler-status
error
```

Bot/Runner 不应该直接 import Vue 或 Electron Renderer 代码。

---

# 17. SQLite

现有数据包括：

```text
settings
url_history
daily_progress
course_progress
```

v2 需要有明确迁移逻辑。

推荐：

```text
第一次启动 v2
      ↓
检测 v1 DB
      ↓
复制 / migrate
      ↓
写入 v2 userData
      ↓
此后仅使用 v2 database
```

不要长期让 v2 直接依赖 v1 的平台目录结构。

本次重构不主动大改数据库业务模型。

如果确实需要 schema 变化，必须：

```text
migration
+
version
+
测试
```

---

# 18. Credentials

v1 使用 Python keyring。

v2 使用 Electron：

```text
safeStorage
```

允许升级到 v2 后要求用户重新输入一次：

```text
username
password
```

**不要求自动迁移 v1 keyring 凭据。**

这不是本次重构验收条件。

---

# 19. Scheduler

自动调度迁到 Node。

SchedulerService 独立于 Vue。

它需要负责：

```text
开启/关闭自动模式
允许时间段
跨午夜时间段
每日目标分钟数
今日累计进度
自动启动
达到目标自动停止
```

UI 关闭或页面切换不能影响调度状态。

---

# 20. Transcription 边界

本次重构 **保留 SenseVoice Python Worker**。

不要同时把 FunASR/SenseVoice 重写成 native runtime。

Node 负责：

```text
媒体获取
下载
音频录制
ffmpeg
WAV 文件管理
任务编排
输出文件管理
```

Python 负责：

```text
load SenseVoice model
receive transcription job
run inference
return text/result
```

目标协议建议使用 stdin/stdout NDJSON。

例如 Node → Python：

```json
{"id":"job-123","input":"/tmp/course.wav"}
```

Python → Node：

```json
{"id":"job-123","success":true,"text":"..."}
```

错误：

```json
{
  "id":"job-123",
  "success":false,
  "error":"..."
}
```

Python Worker 应保持常驻，以避免每节视频重新加载模型。

---

# 21. Python Worker 不允许知道什么

完成重构以后 Python STT 模块不能依赖：

```text
Selenium
智慧树 URL
课程标题 DOM
验证码
Quiz
SQLite
Scheduler
Electron
Vue
账号密码
Chrome
```

它只能是通用：

```text
audio → text
```

Worker。

未来才能方便地：

```text
Python SenseVoice
       ↓
Native/GGUF SenseVoice
```

而不影响其余代码。

---

# 22. 两种转录模式必须保留

v1 支持：

```text
刷课 + 转录
```

以及：

```text
仅转录 / 快速获取媒体后转录
```

v2 均需保留。

最终流程应调整为：

```text
Playwright / Chromium
       ↓
媒体获取
       ↓
Node
       ↓
ffmpeg
       ↓
WAV
       ↓
Python STT Worker
       ↓
TXT
```

不要因为旧转录代码在 Python，就把 Selenium 一起留在 Python。

---

# 23. 仓库和分支策略

当前 `dev_beta` 作为 v1 最终参考实现。

开始大规模修改前：

```bash
git switch dev_beta

git tag v1-pyside-final
git push origin v1-pyside-final

git switch -c rewrite/electron
git push -u origin rewrite/electron
```

所有 v2 工作都在：

```text
rewrite/electron
```

进行。

`dev_beta` 在 v2 开发期间原则上冻结。

Electron 功能追平以后再进入：

```text
main
```

---

# 24. 不允许一次性删除 Legacy

重构初期应同时存在：

```text
new Electron implementation
+
legacy Python implementation
```

目的不是长期维护两套，而是：

```text
行为对照
回归测试
兼容性验证
```

只有对应模块在 v2 中通过验证后才能删除旧实现。

---

# 25. 推荐迁移顺序

## Phase 0 — Baseline

完成：

```text
v1-pyside-final tag
rewrite/electron branch
记录当前 v1 功能
记录当前配置和 DB schema
```

禁止修改业务行为。

---

## Phase 1 — Electron Skeleton

建立：

```text
Electron
Vue 3
TypeScript
Vite
preload
typed IPC
```

实现最小页面：

```text
Dashboard
Settings
```

要求：

```text
Electron app 可以启动
Renderer 与 Main IPC 可用
```

暂时不接刷课。

---

## Phase 2 — Playwright PoC

这是整个重构最重要的 Gate。

验证：

```text
智慧树直接登录
UPC 登录
传统课程页面
图谱课程页面
iframe
课程列表
视频播放器
quiz
captcha
cookies
download
MediaRecorder / media access
```

并编写：

```text
PLAYWRIGHT_POC.md
```

记录：

```text
连接方式
已通过场景
失败场景
Electron 特有问题
Legacy Selenium 对比
```

PoC 未通过之前：

> 不删除 Selenium。

---

## Phase 3 — Core Services

迁移：

```text
StorageService
CredentialService
EventBus
SchedulerService
BotService skeleton
```

完成 v1 SQLite migration。

---

## Phase 4 — Classic Course

迁移：

```text
ZhihuishuLogin
UPCLogin
ClassicCourseNavigator
VideoController
QuizService
CaptchaService
ClassicCourseRunner
```

完成传统课程端到端测试。

---

## Phase 5 — Map Course

迁移：

```text
MapCourseNavigator
MapCourseRunner
```

完成图谱课程端到端测试。

不要强行与 Classic Course 合并业务逻辑。

---

## Phase 6 — Transcription

建立：

```text
TranscriptionService
Python STT Worker
ffmpeg pipeline
```

完成：

```text
刷课 + 转录
仅转录
```

---

## Phase 7 — Scheduler / Persistence

完成：

```text
每日进度
自动调度
课程历史
上次课程进度
应用重启恢复
```

---

## Phase 8 — Packaging

完成：

```text
Windows
macOS
```

需要验证：

```text
Electron
Playwright
Python Worker
ffmpeg
SenseVoice dependencies
```

在打包环境中全部正常。

---

## Phase 9 — Legacy Removal

仅当所有核心功能通过后删除：

```text
PySide6
QML
gui/bridge.py
Python Selenium
ChromeDriver
webdriver-manager
Chrome for Testing
旧 build scripts
```

保留：

```text
Python STT Worker
```

---

# 26. 功能追平 Definition of Done

v2 必须满足：

* Electron + Vue 可独立启动。
* PySide6/QML 不再进入运行链路。
* 智慧树账号密码登录可用。
* UPC SSO 登录可用。
* 传统课程完整刷课可用。
* 图谱课程完整刷课可用。
* 跳过已完成课程可用。
* 上次进度继续可用。
* 视频暂停后恢复逻辑可用。
* 弹题流程可用。
* 验证码人工处理流程可用。
* 用户停止操作可靠。
* 每日观看时长正确。
* 自动调度正确。
* SQLite 数据正常持久化。
* v1 SQLite 有明确迁移路径。
* 课程历史正常。
* 刷课 + 转录可用。
* 仅转录可用。
* STT Worker 可正常启动、复用和关闭。
* 应用退出不会遗留 Chrome/Electron/Python 子进程。
* Windows 构建可运行。
* macOS 构建可运行。
* Playwright 成为最终浏览器自动化 API。
* Legacy Selenium 在验证完成后可删除。

---

# 27. 本次明确 Non-goals

本次重构不负责：

```text
替换 SenseVoice Python runtime
GGUF/native SenseVoice
支持其他学习平台
插件系统
云端服务
账号系统
远程控制
云同步
AI 自动答题
验证码自动破解
浏览器反检测/stealth
Linux
自动更新
大规模 UI 功能扩展
彻底最小化安装包
```

这些应作为未来独立任务。

---

# 28. 已知 v1 问题

迁移时不要盲目复制所有现有行为。

目前已经观察到一些值得重新验证的问题。

### 普通模式课程进度

`course_progress` 的更新目前与转录流程存在较强耦合。

需要验证：

```text
不开转录的普通刷课
```

是否能够正确更新“从上次进度继续”。

v2 应确保：

```text
课程完成
→ progress persistence
```

与是否启用转录无关。

---

### Map + Transcription

当前 MapCourseBot 与转录模块没有真正完成业务集成。

v2 应明确：

```text
map mode + transcription
```

是否属于支持场景。

默认建议：

> 支持，并通过统一 Video/TranscriptionService 接入。

如果阶段性不支持，UI 必须明确禁止该组合，而不是静默失效。

---

### Map 模式生命周期

当前 Map 模式存在重复 stop/cleanup 的风险。

v2 应保证：

```text
start
→ running
→ stop/finish
→ cleanup once
```

生命周期只能收尾一次。

---

### Classic Course 回环

当前在：

```text
skip_completed = false
```

时可能存在结束后重新回到前面视频的风险。

v2 应显式定义任务终止条件。

不要依赖 DOM 偶然变化结束循环。

---

### Quiz Random Strategy

当前随机选项失败重试时可能重新随机另一个选项。

v2 重写时保证一次题目选择结果明确。

---

### Map URL Parsing

图谱课程存在多种 URL 结构。

重写 URL parser 时必须使用明确的 URL 解析和测试用例，不要仅依赖脆弱 regex。

---

# 29. 测试策略

不要只依赖真实智慧树网站做测试。

自动化逻辑建议分成：

```text
Unit Tests
DOM Fixture Tests
Live Smoke Tests
```

例如建立：

```text
tests/fixtures/classic-course.html
tests/fixtures/map-course.html
tests/fixtures/quiz-dialog.html
tests/fixtures/login.html
```

使用固定 HTML fixture 测试：

```text
selector
parser
navigator
progress extraction
resource classification
```

真实网站只用于：

```text
集成验证
smoke test
```

不要把账号密码写入测试代码或仓库。

---

# 30. 推荐目录结构

```text
AUTO_COURSE/
│
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   │
│   │   ├── automation/
│   │   │   ├── browser-service.ts
│   │   │   ├── browser-session.ts
│   │   │   │
│   │   │   ├── classic/
│   │   │   │   ├── classic-course-runner.ts
│   │   │   │   ├── navigator.ts
│   │   │   │   └── video-controller.ts
│   │   │   │
│   │   │   ├── map/
│   │   │   │   ├── map-course-runner.ts
│   │   │   │   └── navigator.ts
│   │   │   │
│   │   │   ├── login/
│   │   │   │   ├── provider.ts
│   │   │   │   ├── zhihuishu.ts
│   │   │   │   └── upc.ts
│   │   │   │
│   │   │   ├── captcha.ts
│   │   │   └── quiz.ts
│   │   │
│   │   ├── services/
│   │   │   ├── bot-service.ts
│   │   │   ├── scheduler-service.ts
│   │   │   ├── transcription-service.ts
│   │   │   └── event-bus.ts
│   │   │
│   │   ├── storage/
│   │   │   ├── database.ts
│   │   │   ├── migrations/
│   │   │   └── credentials.ts
│   │   │
│   │   └── ipc/
│   │       ├── bot.ts
│   │       ├── settings.ts
│   │       └── events.ts
│   │
│   ├── preload/
│   │   ├── index.ts
│   │   └── api.ts
│   │
│   └── renderer/
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── stores/
│       │   └── types/
│       └── index.html
│
├── python/
│   └── transcriber/
│       ├── worker.py
│       └── requirements.txt
│
├── tests/
│   ├── fixtures/
│   ├── unit/
│   └── integration/
│
├── docs/
│   ├── PLAYWRIGHT_POC.md
│   └── MIGRATION.md
│
├── scripts/
│   └── ...
│
├── package.json
├── tsconfig.json
└── electron-builder.yml
```

具体构建工具可以根据项目实际选择，不要求目录完全一致。

但必须维持：

```text
main
preload
renderer
python worker
```

四个边界。

---

# 31. Commit 策略

避免出现：

```text
rewrite entire project
+50000 -40000
```

推荐：

```text
chore: scaffold electron vue application

feat(ipc): add typed renderer-main bridge

spike(playwright): validate electron browser automation

feat(storage): migrate sqlite persistence

feat(auth): migrate zhihuishu login

feat(auth): migrate UPC login

feat(course): migrate classic course runner

feat(quiz): migrate quiz handling

feat(captcha): migrate captcha workflow

feat(course): migrate map course runner

feat(scheduler): migrate automatic scheduler

feat(transcription): add python STT worker bridge

feat(transcription): migrate media acquisition pipeline

feat(migration): import legacy database

build: add windows electron packaging

build: add macOS electron packaging

refactor: remove selenium browser backend

refactor: remove pyside and qml application
```

每个阶段应尽量保持仓库可运行。

---

# 32. Agent 工作原则

Agent 开始修改之前，应先阅读和理解：

```text
src/bot/bot_core.py
src/bot/browser.py
src/bot/course.py
src/bot/map_course.py
src/bot/video.py
src/bot/quiz.py
src/bot/captcha.py
src/bot/login/
src/transcriber/
gui/bridge.py
database.py
config.py
src/constants.py
```

重构时遵守：

1. 先理解现有行为，再迁移。
2. 不因为旧代码结构差就随意改变产品行为。
3. 不同时重构无关模块。
4. 任何行为变化单独记录。
5. 不提前删除能够作为对照的 legacy 实现。
6. 不在 Vue Renderer 中加入业务核心。
7. 不给远程课程网页 Node 权限。
8. 不引入 stealth / anti-detection hacks。
9. 所有后台任务必须支持可靠取消。
10. 应用退出必须清理所有 child process 和浏览器资源。
11. Playwright PoC 是正式迁移的 Gate。
12. 不擅自扩大 v2 功能范围。

---

# 33. 最终目标

最终 AUTO_COURSE v2 应形成：

```text
Vue
 ↓
Typed IPC
 ↓
Electron Main
 ↓
BotService
 ├── ClassicCourseRunner
 ├── MapCourseRunner
 ├── SchedulerService
 ├── StorageService
 └── TranscriptionService
          │
          ▼
   Python SenseVoice Worker

Browser automation
       ↓
   Playwright
       ↓
Electron/Chromium
```

Python 不再承担桌面应用后端职责。

Selenium 不再承担最终浏览器自动化职责。

Electron Main 是应用真正的 backend/runtime。

Playwright 是页面自动化抽象层。

Vue 只负责 UI。

SenseVoice Python Worker 是 v2 唯一保留的 Python runtime。

---

# 34. 重构完成后的后续方向

以下内容明确留到 v2 完成之后：

```text
Python STT
   ↓
Native SenseVoice / GGUF

        ↓

完全移除 Python runtime
```

以及：

```text
Updater
更好的任务系统
进一步数据库重构
新的课程平台
插件化 Provider
```

不要在本次 rewrite 中提前实现。
