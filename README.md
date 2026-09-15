# 智慧树自动刷课 · v2

自动播放智慧树平台课程视频，支持传统课程与知识图谱课程、弹题自动作答、
验证码人工介入、语音转文字、自动调度与每日进度统计。

> **当前分支 `rewrite/electron` 是 v2 重写版**（Electron + Vue 3 + TypeScript + Playwright）。
> v1（PySide6 + Selenium）已从工作区删除，冻结在 tag `v1-pyside-final`；
> 需要对照行为时 `git worktree add /tmp/v1 v1-pyside-final`。
> 迁移过程与每一处行为变化见 [docs/MIGRATION.md](docs/MIGRATION.md)。

---

## 架构

```
Vue 3 Renderer（控制面板）
        │  typed IPC（preload 白名单，不暴露 ipcRenderer）
Electron Main
        │
   BotService ──┬── ClassicCourseRunner     传统课程
                ├── MapCourseRunner          知识图谱课程
                ├── SchedulerService         自动调度
                ├── StorageService           SQLite
                └── TranscriptionService ──► Python STT Worker
        │                                        （SenseVoice，NDJSON 协议）
   BrowserService
        │  Playwright
        ▼
   Browser Host（同一个 Electron 二进制的 --browser-host 子进程）
        │
     课程网页
```

**为什么需要一个单独的 Browser Host 进程**：Electron 通过
`--remote-debugging-port` 暴露的 CDP 不提供 `Runtime` domain，而 Playwright 的
`locator/click/fill` 全部依赖它 —— 也就是说 Playwright **无法**驱动应用自身的
BrowserWindow。实验证据与取舍见 [docs/PLAYWRIGHT_POC.md](docs/PLAYWRIGHT_POC.md)。

---

## 环境要求

| 依赖 | 用途 | 是否必须 |
|---|---|---|
| Node.js ≥ 20 | 构建 | 开发必须 |
| ffmpeg | 提取音轨（语音转文字） | 只在用转录时需要 |
| Python 3.10+ | 跑 SenseVoice worker | 只在用转录时需要 |

### 安装 ffmpeg

```bash
# macOS
brew install ffmpeg

# Windows
winget install Gyan.FFmpeg
# 或 conda install -c conda-forge ffmpeg
```

### 安装转录依赖（可选）

```bash
pip install -r python/transcriber/requirements.txt
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

首次转录时会自动下载 SenseVoiceSmall 权重（数百 MB）。模型常驻在 worker 进程里，
一节课只加载一次。

---

## 开发

```bash
npm install        # postinstall 会自动为新 Electron 重建 better-sqlite3

npm run dev        # 开发模式（Vite HMR）
npm run build      # 类型检查 + 三段构建（main / preload / renderer）
npm start          # 预览构建产物
```

> **国内网络**：仓库根目录的 `.npmrc` 已把 Electron 二进制指向 npmmirror。
> 若 `npm install` 后 `node_modules/electron/dist` 为空，执行
> `node node_modules/electron/install.js` 补下载。

---

## 测试

```bash
npm test           # 全部单测 + DOM 夹具测试
npm run test:watch
```

测试分三层（handoff §29）：

| 层 | 位置 | 覆盖 |
|---|---|---|
| 单元测试 | `tests/unit/` | 调度决策、设置往返、DB CRUD、v1 导入映射、图谱解析、URL 解析、文件名净化、媒体下载 |
| DOM 夹具测试 | `tests/integration/` | 用真实 Chromium 打开 `tests/fixtures/` 里复刻真实结构的页面，驱动 Navigator / VideoController / QuizService / CaptchaService |
| 端到端冒烟 | `scripts/` | Electron 启动、typed IPC、转录链路（假 Python worker）、打包产物验证 |

DOM 夹具测试需要先装一次浏览器：

```bash
npx playwright install chromium
```

**真实站点只用于人工冒烟**，自动化测试不碰线上，也不写入任何账号密码。

---

## 构建

```bash
npm run build:mac      # 输出 release/*.dmg
npm run build:win      # 输出 release/*.exe（NSIS 安装包）
```

验证打包产物（会真的启动它并拉一次 Browser Host）：

```bash
node scripts/verify-package.mjs "release/mac-arm64/ZhiHuiShu AutoCourse.app/Contents/MacOS/ZhiHuiShu AutoCourse"
```

macOS 产物未做代码签名，首次打开需右键 → 打开。

---

## 使用

1. **设置 · 账号** 填登录方式与账号密码（数字石大登录还需要填登录跳转 URL）
2. **设置 · 课程** 填课程地址与课程备注
3. **设置 · 刷课** 按需开关「跳过已完成视频」「从上次进度继续」
4. 回到 **运行** 页点「开始刷课」

出现验证码时应用会变红并提示，在课程窗口里手动完成后点「已完成验证，继续」。

### 模式

| 模式 | 开关组合 | 说明 |
|---|---|---|
| 刷课 | 启用刷课 | 播放视频并自动处理弹题/验证码 |
| 图谱刷课 | 启用刷课 + 图谱刷课 | 遍历知识项与必学资源；非视频资源停留 5 秒 |
| 仅转录 | 关闭刷课 | 不播放视频，直接下载音轨转文字 |
| 刷课 + 转录 | 启用刷课 + 启用语音转文字 | 播放的同时录音转写 |

### 自动调度

在 **设置 · 自动调度** 里开启后，到达时间段且今日未达标会自动开始，
达标或超出时段自动停止。支持跨午夜时间段（如 `22:00` → `06:00`）。
调度在后台独立运行，关掉窗口或切页都不影响。

---

## 数据与凭据

- 数据库：`<用户数据目录>/auto_course.db`
  （macOS `~/Library/Application Support/auto-course/`，
  Windows `%APPDATA%\auto-course\`）
- 首次启动会**只读**检测 v1 数据库并导入，此后只用 v2 库
- 账号密码用 Electron `safeStorage` 加密保存，**不迁移** v1 的 keyring 凭据 ——
  升级后需要重新输入一次
- 转录结果写在设置里指定的目录下 `课程录音/<课程名>/<课时名>.txt`

---

## 文档

- [docs/MIGRATION.md](docs/MIGRATION.md) — v1 → v2 的完整迁移说明与每一处行为变化
- [docs/PLAYWRIGHT_POC.md](docs/PLAYWRIGHT_POC.md) — 浏览器自动化方案的技术验证报告
- [docs/V1_BASELINE.md](docs/V1_BASELINE.md) — v1 的冻结行为记录
- [docs/v2_handoff.md](docs/v2_handoff.md) — 本次重构的目标与分阶段计划

---

## 已知限制

- 未做代码签名，macOS 需要右键打开
- 不做任何浏览器指纹伪造或反自动化检测绕过（handoff §5）
- 需要系统自带 ffmpeg 与 Python，未随包分发
- Windows 构建尚未在真实 Windows 机器上实测
