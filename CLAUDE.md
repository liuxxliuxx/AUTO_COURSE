# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## 当前状态

本仓库是 **v2**（v1 → v2 迁移已完成），分支 `rewrite/electron`。

- **v2（当前唯一入口）**：Electron + Vue 3 + TypeScript + Playwright
- **v1（已删除，只留在 git 历史里）**：PySide6 + QML + Selenium，tag `v1-pyside-final`

需要对照 v1 行为时用 git 取出来，不要往工作区里拷：

```bash
git worktree add /tmp/v1 v1-pyside-final
```

仓库里**唯一**保留的 Python runtime 是 `python/transcriber/`（SenseVoice STT worker）。
- v1 → v2 的每一处行为变化 → 见 `docs/MIGRATION.md`

## 运行

```bash
npm install        # postinstall 会为新 Electron 重建 better-sqlite3
npm run dev        # 开发模式
npm run build      # 类型检查 + 三段构建
npm start          # 预览构建产物
```

## 测试

```bash
npm test                     # 单元 + DOM 夹具（169 项）
npx vitest run tests/unit    # 只跑单元测试（不需要浏览器）
```

三层测试，见 `docs/MIGRATION.md` 与 handoff §29：

| 层 | 位置 | 需要 |
|---|---|---|
| 单元 | `tests/unit/` | 无 |
| DOM 夹具 | `tests/integration/` | `npx playwright install chromium` |
| 端到端冒烟 | `scripts/` | Electron / Python / ffmpeg |

其他验证脚本：

```bash
node scripts/smoke-electron.mjs                      # Electron 启动 + typed IPC + 渲染层隔离
node scripts/poc/02-host-full-matrix.mjs --offline   # 浏览器自动化能力矩阵（27 项）
node scripts/verify-package.mjs <打包产物路径>        # 打包产物真的能跑
node scripts/screenshot.mjs                          # 界面走查截图
```

## 架构

```
src/main/             Electron 主进程（v2 的 backend）
├── index.ts          分流：--browser-host → 宿主，否则 → 应用本体
├── app-main.ts       应用本体启动、窗口、退出清理
├── automation/       浏览器自动化（只认 Playwright，不碰 Electron）
│   ├── browser-service.ts   浏览器生命周期唯一管理者
│   ├── browser-session.ts   BrowserAutomation 抽象（handoff §6）
│   ├── browser-host.ts      Playwright 驱动的纯窗口子进程
│   ├── constants.ts         所有选择器 / 超时（对应 v1 src/constants.py）
│   ├── login/               LoginProvider：zhihuishu / upc
│   ├── classic/             传统课程 Runner / Navigator / VideoController
│   ├── map/                 图谱课程 Runner / Navigator / URL 解析
│   ├── captcha.ts quiz.ts   验证码与弹题
│   └── runner.ts            CourseRunner 契约
├── services/         业务流程
│   ├── bot-service.ts          任务生命周期状态机（唯一持有者）
│   ├── scheduler-service.ts    自动调度
│   ├── transcription-service.ts 转录编排 + MediaPort 实现
│   ├── stt-worker.ts           Python STT worker 桥接（NDJSON）
│   ├── media.ts                ffmpeg + Node 侧下载
│   ├── settings-service.ts     类型化设置
│   ├── event-bus.ts            Service → IPC → Renderer
│   └── container.ts            依赖装配点
├── storage/          SQLite / safeStorage / v1 导入
└── ipc/              typed IPC handler

src/preload/          只暴露 window.appApi，不暴露 ipcRenderer
src/renderer/         Vue 3 控制面板（不含任何业务状态机）
src/shared/           Main / Preload / Renderer 共享的类型契约
python/transcriber/   v2 唯一保留的 Python：SenseVoice worker（audio → text）
```

## 关键约束

### 浏览器

- **谁都不许自己 launch/close 浏览器**，只能通过 `BrowserService` 拿 `BrowserSession`。
- Playwright **无法**驱动应用自身的 BrowserWindow（Electron 在
  `--remote-debugging-port` 上不提供 `Runtime` domain）。这就是 `--browser-host`
  子进程存在的原因，证据见 `docs/PLAYWRIGHT_POC.md`。
- 任何加载远程内容的 WebContents 必须
  `nodeIntegration:false / contextIsolation:true / sandbox:true`。
- **不打任何反检测补丁**（handoff §5）。
- 升级 Electron 或 Playwright 后必须重跑 `scripts/poc/02-host-full-matrix.mjs`。

### 进程与线程

- 应用本体与 Browser Host 共用同一个二进制，靠 `--browser-host` 分流；
  分流必须发生在任何重模块加载之前（宿主不能抢 userData 锁）。
- 构建产物路径不要用 `join(__dirname, ...)`：主进程被拆成
  `out/main/index.js` + `out/main/chunks/*.js`，`__dirname` 会飘。
  统一用 `app.getAppPath()` 相对解析。
- 退出清理只允许执行一次（`ServiceContainer.dispose`）。

### 业务边界

- `ClassicCourseRunner` 与 `MapCourseRunner` 是**两套独立业务**，
  不要写成 `if (mapMode) {...} else {...}` 塞进一个类（handoff §9）。
- Runner 通过 `RunnerContext` 拿一切依赖，不直接 import Electron / Vue。
- `course_progress` 的写入与转录**无关**（这是 v1 的缺陷 #1）。
- 每日进度用监控循环的真实耗时，不信任 video DOM 的 duration。
- 自动调度独立于 UI：关窗口、切页都不影响。

### 转录

- Python 侧只能做 `audio → text`。它不允许知道智慧树、DOM、验证码、
  数据库、Electron 的任何事（handoff §21）。
- Node 侧负责媒体获取、下载、录音、ffmpeg、文件管理、任务编排。
- 协议是 stdin/stdout NDJSON，worker 常驻。
- 录音产物**不走浏览器下载**：blob 下载在 Electron 下既不触发 Playwright
  事件也不触发宿主 `will-download`，必须走「页面攒块 + Node 分批取回」。

### 选择器

全部集中在 `src/main/automation/constants.ts`（以及 `map/navigator.ts`）。
平台改版只需要改这些文件。

**选择器一律保留多候选数组**：实测智慧树登录页的 `#lUsername` 已经失效，
靠 `input[placeholder*="手机号"]` 才命中（`docs/PLAYWRIGHT_POC.md` §2.2）。

## 提交约定

按阶段提交，每个提交保持仓库可运行，参考 handoff §31 的建议前缀：

```
chore(scope):  脚手架
feat(scope):   功能迁移
spike(scope):  技术验证
build:         打包
refactor:      删除 legacy
```

行为变化必须单独记录到 `docs/MIGRATION.md`。
