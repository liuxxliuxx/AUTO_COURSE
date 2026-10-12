> v3 更新：账号在独立账号页管理，每个工作流步骤必须包含 accountId 与 courseId。续学进度以 (accountId, courseId) 保存，工作流启动时占用涉及的全部账号；不同账号可执行同一课程。浏览器 profile 按账号隔离。v3 使用独立目录并停止旧数据自动导入。下面保留早期界面设计记录，旧单账号及课程进度迁移规则已被上述规则替代。

# 交互、课程库与模块边界

本次重构要消除的核心问题是：课程依赖 URL 历史、课程名充当进度主键、
全局设置兼任当前任务配置、几个布尔开关隐式决定运行模式。

本文记录重构后的实际边界。行为变化的历史原因见 [MIGRATION.md](MIGRATION.md)，
最初的完整方案见 [v2_handoff.md](v2_handoff.md)。

---

## 1. 页面流程

| 页面 | 职责 |
|---|---|
| 课程 | 课程增删改查、每门课程的运行配置、选择「本次课程」 |
| 运行 | 当前任务、阶段、进度、异常处理、日志 |
| 工作流 | 课程步骤编排、运行方式、立即/定时运行、工作流编辑 |
| 设置 | 账号登录、新课程默认配置、转录目录、外观缩放 |

- 没有课程时进入课程页；有活动运行实例时默认进入运行页；否则进入工作流页。
- 点击课程列表只切换查看与选择，**不会启动任务**。
- 保存课程**不会**自动运行；运行期间可以查看和编辑其他课程，但不能启动第二个任务。
- 正在运行的课程禁止编辑与移除，详情里给出「先停止任务」的提示。

### 运行配置

每门课程各自保存「运行方式 / 起始位置 / 跳过已完成内容 / 单次时长」，
切换课程时随之切换，不再由全局开关推导：

| 运行方式 | 传统课 | 图谱课 | 掌握度课 |
|---|---|---|---|
| 学习 | ✅ | ✅ | ✅ |
| 学习并转录 | ✅ | ✅ | — |
| 仅转录 | ✅ | — | — |

新课程从「设置 · 课程默认配置」复制一份；之后修改默认值只影响新建课程。
「关闭刷课就自动进入仅转录」这条隐式规则已经删除。

掌握度课每次提交后都会打开作答解析页。只有整套题全部正确才结束当前知识点；
错题会把题目的试错次数加一并继续答题。题目、选项、正确答案和试错次数保存在应用数据库。

### 异常与人工介入

`InterventionRequest` 区分 `captcha` 与 `manual-login`，替代了过去所有问题共用一条验证码事件的做法：

- 登录失败 → 打开登录窗口、重试登录、去课程详情检查地址
- 检测到验证码 → 打开验证窗口、完成后继续
- 课程加载失败 → 重试任务、返回课程详情
- 普通执行错误只提示「任务执行失败」，不会引导去处理验证码

### 窗口焦点

课程窗口是自动打开的（每次运行、每次宿主重启都会开），所以它**不允许抢焦点**：

- 自动路径（宿主启动、运行开始、宿主重启）只 `showInactive()`：窗口照常出现，
  但不激活进程、不打断用户正在用的 App。
- 只有用户主动点「打开课程窗口 / 验证窗口 / 登录窗口」时，`browser:openCourseWindow`
  才会显式把窗口拉到前台（`BrowserService.focusCourseWindow()`）。

实测（`scripts/poc/focus-probe.mjs`，需要图形会话，手动跑）：前台放着「访达」时
拉起宿主，窗口 `visible=true / focused=false`，前台仍是「访达」；点按钮才切到 Electron。
同一探针还确认不聚焦时 Playwright 仍能正常 fill / click，页面 `document.hasFocus()` 也是 true，
所以刷课链路不受影响。

---

## 2. 工作流与运行实例

- `WorkflowService` 持久化工作流、步骤和定时规则；步骤保存课程配置的副本。
- `WorkflowRunManager` 在启动前一次性校验并占用全部课程；课程有重叠时拒绝后启动的工作流。
- `WorkflowExecutor` 在一个运行实例内顺序执行步骤；某一步失败后继续后续步骤并汇总为部分失败。
- 每个运行实例拥有独立 Browser Host profile、转录 worker 临时目录和取消信号。
- 日志、进度和人工处理状态携带 `workflowId / runId / stepId`，运行快照不保存密码或 Cookie。

## 3. 模块边界

| 模块 | 所有权 |
|---|---|
| 课程管理 | `CourseService`：增删改查、选择状态、每门课程配置 |
| 账号登录 | `CredentialStore` + `SettingsService.loginMethod`：只负责凭据与登录结果 |
| 工作流运行 | `WorkflowRunManager`、`WorkflowExecutor`：启停、快照、阶段、错误与人工介入 |
| 课程执行器 | `classic/` 与 `map/` 两个 Runner：只读运行上下文，不读可变的全局设置 |
| 进度 | `course_progress_v2` + `daily_progress`：按课程 ID 保存，负责每日统计 |
| 自动调度 | `WorkflowScheduler`：按工作流的单次/每日规则发起运行 |
| 转录 | `TranscriptionService`：接收任务配置与课程 ID，独立上报状态 |
| 应用设置 | `SettingsService`：全局默认值、目录、外观 |

前端对应 `stores/courses.ts`、`stores/account.ts`、`stores/app.ts`、
`stores/scheduler.ts`、`stores/settings.ts`，页面只通过类型化 IPC 调用，
不在组件里推导业务模式，也不自己维护任务状态。

`src/shared/courses.ts` 是唯一的兼容边界：`settingsForCourse()` 把课程配置翻译成
旧 Runner 仍在读取的 `AppSettings` 字段。执行器内部暂未重写，但数据来源已经隔离，
且运行期间不会写回全局设置。

---

## 4. 关键契约

```ts
interface Course { id, identity, name, url, kind, options, createdAt, updatedAt, lastRunAt, progressWarning }
interface CourseRunOptions { action, startPosition, skipCompleted, timeLimitMinutes }
interface WorkflowStep { id, courseId, options }
interface Workflow { id, name, steps, schedule, version }
interface WorkflowRun { id, workflowId, snapshot, steps, state }
interface RunRequest { workflowId }
interface RunSnapshot { id, course, settings, startedAt, source: 'manual' | 'schedule' }
interface RunStatus { runId, courseId, snapshot, phase, error, intervention, state, ... }
interface SchedulerConfig { enabled, courseId, startTime, endTime, allDay, dailyLimitMinutes }
```

- 课程 IPC：`courses:list / select / create / update / remove / defaults`
- 工作流 IPC：`workflows:list / get / create / update / remove`
- 运行 IPC：`workflows:start / runs / run / stop / window / confirm / logs`
- 配置在启动瞬间快照，运行期间编辑工作流不会影响当前实例

---

## 5. 数据迁移

- `courses` / `course_progress_v2` 与 schema 版本一起在一个事务里建立。
- 旧数据来源是「当前课程配置 + URL 历史」：重复地址按 `identity` 合并，
  当前选中课程保持选中；当前课程保留原运行配置，其他历史课程继承迁移时的默认值。
- 进度按课程 ID 保存，改名不影响续学位置。
- 旧备注进度只有在唯一对应一门课程时才关联；同名歧义数据保留原样，
  在课程详情里显示 `progressWarning`，由用户重新确定续学位置。
- 旧自动调度迁移为单步骤工作流；原时间段和每日目标无法等价转换，新工作流定时默认停用并提示重新设置。
- 旧表只用于核对，不再双向写入；重复迁移不会重复导入，失败会回滚。

---

## 5. 验收状态

已由自动化覆盖：

| 场景 | 位置 |
|---|---|
| 添加两门不同配置的课程、切换与刷新后配置不串用、保存不启动 | `tests/integration/course-ui.test.ts` |
| 重复地址提示、取消编辑不覆盖、保存失败保留输入 | 同上 |
| 账号密码不回填、默认配置不影响已有课程、调度目标独立可选 | 同上 |
| 键盘焦点、长名称与窄窗口无水平溢出 | 同上 |
| 去重迁移、重复初始化、迁移失败回滚、同名歧义、重命名保进度、运行中禁止编辑 | `tests/unit/course-library.test.ts` |
| 运行快照隔离、人工介入类型区分、登录失败阶段与错误 | `tests/unit/run-snapshot.test.ts` |
| 调度目标、暂停与恢复 | `tests/unit/scheduler-tick.test.ts` |

仍需要真实站点人工验收（不能用夹具替代）：登录三种方式的真实表现、
课程页真实加载、视频播放与弹题处理、验证码出现与继续。
