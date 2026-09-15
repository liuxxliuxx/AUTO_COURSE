# v1 基线记录（PySide6 + Selenium）

> 对应 tag：`v1-pyside-final`（= `dev_beta` @ `ecde984`）
> 用途：v2 重写期间的行为对照与回归基准。**本文档描述的是现状，不是目标。**

---

## 1. 运行入口与分层

```
main.py                     # 只做启动，导入 gui.app
config.py                   # 平台数据目录解析 + keyring 常量
database.py                 # SQLite CRUD（根目录，不在 src/db/）
gui/
  app.py                    # QApplication + QQmlApplicationEngine
  bridge.py                 # ThreadBridge：QObject 暴露给 QML（615 行，业务最密集处）
  qml/*.qml                 # 界面
src/
  constants.py              # 所有选择器 / 超时 / URL
  bot/
    bot_core.py             # ZhiHuiShuBot 主循环 + 图谱分支（518 行）
    browser.py              # Chrome/ChromeDriver 三级查找
    course.py               # CourseNavigator（350 行）
    video.py                # VideoController（187 行）
    quiz.py                 # QuizHandler + AnswerStrategy（221 行）
    captcha.py              # CaptchaHandler（119 行）
    map_course.py           # MapCourseBot（457 行）
    login/{base,zhihuishu,upc}.py
  transcriber/
    transcription_manager.py  # 628 行
    audio_capture.py          # 873 行
    transcription_worker.py   # 145 行（multiprocessing spawn 子进程）
  ui/log_handler.py         # logging → queue
  utils/element_finder.py   # 多选择器依次尝试
```

## 2. 线程模型

- **GUI 线程**：持有 QML 与 `ThreadBridge`，用 4 个 `QTimer` 轮询
  （日志 200ms、验证码 500ms、转录 500ms、调度 30s）
- **Bot 线程**：`threading.Thread(target=bot.run, daemon=True)`
- 跨线程通道：`threading.Event`（captcha_needed / captcha_done / stop_event）
  + `queue.Queue`（log / transcribe_status）
- `ThreadBridge._running` 只由 GUI 线程读写

## 3. 状态机（v1 实际行为）

```
idle ──start──► starting ──► running ──► idle
                                 │
                    用户停止 / 超时 / 达标 / 课程池耗尽
```

v1 没有显式状态机，`_running` 布尔 + `_bot_thread.is_alive()` 共同推导。
自然结束由调度器 tick 检测：`_running == True and not thread.is_alive()`。

### 状态文案映射（迁移时必须保持语义）

| 场景 | 文案 | 色 |
|---|---|---|
| 空闲 | ● 就绪 | gray |
| 初始化 | ● 正在初始化... | success |
| 刷课中 | ● 正在刷课 | success |
| 验证码 | ⚠ 检测到验证码 — 请在浏览器中完成验证 | danger |
| 手动停止 | ● 已停止 | danger |
| 图谱停止 | ● 图谱刷课已停止 | danger |
| 转录停止 | ● 转录已停止 | danger |
| 达标 | ● 今日目标已完成 | warning |
| 超时 | ● 不在允许运行时间内 | warning |

## 4. 数据库 schema（v1 实际结构，取自真实用户库）

```sql
CREATE TABLE url_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_type TEXT NOT NULL,          -- 'logged' | 'video'
    url TEXT NOT NULL,
    note TEXT DEFAULT '',
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(url_type, url)
);
CREATE UNIQUE INDEX idx_url_history_type_url ON url_history(url_type, url);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE daily_progress (
    date TEXT PRIMARY KEY,           -- 'YYYY-MM-DD'
    watched_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE course_progress (
    course_note TEXT PRIMARY KEY,
    last_video_title TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

数据库文件位置（`config._get_db_path`）：

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/zhihuishu_auto_course/course_progress.db` |
| Windows | `%APPDATA%\zhihuishu_auto_course\course_progress.db` |
| Linux | `$XDG_DATA_HOME/zhihuishu_auto_course/course_progress.db` |

## 5. settings 表的全部键（v1 实测）

| key | 默认 | 含义 |
|---|---|---|
| `login_method` | `zhihuishu` | `zhihuishu` \| `upc` |
| `logged_url` | 空 | 登录后跳转 URL |
| `video_url` | 空 | 课程 / 图谱课 URL |
| `course_note` | 空 | 课程备注，也是 `course_progress` 的键 |
| `brush_enabled` | `1` | 关闭则进入「仅转录」 |
| `map_mode` | `0` | 图谱刷课 |
| `skip_completed` | `1` | 跳过已完成视频 |
| `from_last_progress` | `0` | 从上次进度继续 |
| `time_limit` | `0` | 单次运行时长上限（分钟） |
| `transcribe_enabled` | `0` | 启用语音转文字 |
| `transcribe_base_dir` | 空 | 转录输出根目录 |
| `auto_mode` | `0` | 自动调度开关 |
| `auto_start_time` | `06:00` | 允许时段起 |
| `auto_end_time` | `23:00` | 允许时段止 |
| `auto_allday` | `0` | 忽略时段 |
| `auto_limit` | 继承 `time_limit` | 每日目标分钟 |
| `bg_blur_radius` | `40` | 旧毛玻璃界面参数，v2 不再沿用 |
| `chrome_binary` | 自动探测 | v2 不再需要 |
| `chromedriver_binary` | 自动探测 | v2 不再需要 |

别名映射（`bridge._setting_key`）：`transcribe_dir → transcribe_base_dir`、
`auto_start → auto_start_time`、`auto_end → auto_end_time`、`blur_radius → bg_blur_radius`。

凭据不入库：v1 用 Python `keyring`，service=`zhihuishu_auto_course`，
key 为 `zhanghao` / `mima`。

## 6. 功能清单（v2 功能追平的对照表）

- [x] 智慧树手机号 + 密码登录（含滑块验证码人工介入）
- [x] 数字石大 UPC SSO 登录（Vue 组件凭据注入 + `passwordLogin()`）
- [x] 传统课程：解析 `li.video` 列表 → 逐个点击 → 播放监控
- [x] 视频暂停自动恢复（每 10s 检查）
- [x] 弹题处理（多题连答 + 随机选项策略）
- [x] 验证码检测（iframe / 弹窗 / 图片输入框）+ 人工确认
- [x] 学前必读弹窗、学习进度提醒弹窗关闭
- [x] 图谱课程：知识项 → 必学资源 → 视频播放 / 非视频停留 5s
- [x] 跳过已完成 / 从上次进度继续
- [x] 时长上限与每日目标
- [x] 自动调度（含跨午夜时间段）
- [x] 每日观看时长累计（用监控循环实际耗时，不信任 DOM 时长）
- [x] 语音转文字：实时录音（MediaRecorder + captureStream）
- [x] 语音转文字：仅转录（直链下载 + ffmpeg 提取音轨）
- [x] SenseVoice/FunASR 常驻 worker（multiprocessing spawn）
- [x] URL 历史与课程备注
- [x] Windows / macOS 打包

## 7. v1 已确认缺陷（v2 不得原样复制）

依据 `docs/v2_handoff.md` §28，并已通过代码核对确认：

1. **课程进度被转录流程劫持**（`bot_core.py:376` → `bridge.py:363`）。
   `course_progress` 只在**转录成功**时写入；不开转录时「从上次进度继续」完全失效。
2. **课程进度写入键与读取键不一致**。写入用的是 `sanitize_filename()` 之后的课程名，
   读取用的是原始 `course_note`；含 `<>:"/\|?*`、连续 `_`/空格或超 100 字符的备注
   会写到一个永远查不到的主键下。
3. **`transcribe_via_download` 无条件返回 `True`**（`transcription_manager.py:452`），
   等待超时或被停止也算成功。
4. **Map 模式生命周期可能重复收尾**：`_run_map_mode` 在 `try`/`except` 里各调一次
   `on_bot_stop()`，而 `finally` 又关一次 driver。
5. **Classic 回环风险**：`skip_completed=False` 时 `get_next_video_after` 会环形回到
   列表头部，终止条件依赖 DOM 状态而非显式任务终止条件。
6. **Quiz 随机策略重复随机**：`_answer_current` 验证选中失败时再次
   `select_option`，等于换了一个选项，单题结果不确定。
7. **图谱 URL 解析脆弱**：仅用 `re.search`，未覆盖已知的多种图谱 URL 结构。
8. **Map + 转录未集成**：`_run_map_mode` 在建 transcriber 之前就 return，
   组合静默失效。
9. **临时 WAV 永不清除**：`TRANSCRIPTION_DEBUG_KEEP_WAV = True`，
   `_cleanup_temp` 直接 return，一节课约 115MB 常驻磁盘。
10. **停止信号只中断等待、不中断推理**：`should_stop` 只在 `wait_for_current_job`
    轮询；worker 仍在跑，结果无人消费，`_pending_jobs` 与临时文件泄漏。
11. **`_wasapi_record_thread` 内异常只被记录**，线程静默死亡仍报 `_recording = True`。
12. **死代码**：`poll_results`、`get_download_progress`、
    `TRANSCRIPTION_URL_RETRIES/URL_RETRY_INTERVAL/DOWNLOAD_TIMEOUT/POLL_INTERVAL`。

## 8. 环境与打包

- Python 环境：conda env `zhihuishu`（Windows 路径 `/c/Users/liuxx/anaconda3/envs/zhihuishu/`）
- 依赖见 `requirements.txt`：selenium / webdriver-manager / keyring / funasr /
  modelscope / torch / torchaudio / requests / sounddevice / numpy / PySide6 / Pillow
- Chrome 查找顺序（`src/bot/browser.py`）：
  显式配置 → 系统 Chrome + Driver → `bin/` 缓存 → 自动下载 → `webdriver-manager`
- 打包：`scripts/build_win.ps1`（PyInstaller onedir + NSIS）、
  `scripts/build_mac.sh`（py2app）
