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
| 设置 | 账号登录、新课程默认配置、转录目录、自动调度、外观缩放 |

- 没有课程时进入课程页；有课程且没有任务时恢复上次选择；任务运行中默认进入运行页。
- 点击课程列表只切换查看与选择，**不会启动任务**。
- 保存课程**不会**自动运行；运行期间可以查看和编辑其他课程，但不能启动第二个任务。
- 正在运行的课程禁止编辑与移除，详情里给出「先停止任务」的提示。

### 运行配置

每门课程各自保存「运行方式 / 起始位置 / 跳过已完成内容 / 单次时长」，
切换课程时随之切换，不再由全局开关推导：

| 运行方式 | 传统课 | 图谱课 |
|---|---|---|
| 学习 | ✅ | ✅ |
| 学习并转录 | ✅ | ✅ |
| 仅转录 | ✅ | — |

新课程从「设置 · 课程默认配置」复制一份；之后修改默认值只影响新建课程。
「关闭刷课就自动进入仅转录」这条隐式规则已经删除。

### 异常与人工介入

`InterventionRequest` 区分 `captcha` 与 `manual-login`，替代了过去所有问题共用一条验证码事件的做法：

- 登录失败 → 打开登录窗口、重试登录、去课程详情检查地址
- 检测到验证码 → 打开验证窗口、完成后继续
- 课程加载失败 → 重试任务、返回课程详情
- 普通执行错误只提示「任务执行失败」，不会引导去处理验证码

---

## 2. 模块边界

| 模块 | 所有权 |
|---|---|
| 课程管理 | `CourseService`：增删改查、选择状态、每门课程配置 |
| 账号登录 | `CredentialStore` + `SettingsService.loginMethod`：只负责凭据与登录结果 |
| 任务运行 | `BotService`：启停、配置快照、阶段、错误与人工介入 |
| 课程执行器 | `classic/` 与 `map/` 两个 Runner：只读运行上下文，不读可变的全局设置 |
| 进度 | `course_progress_v2` + `daily_progress`：按课程 ID 保存，负责每日统计 |
| 自动调度 | `SchedulerService`：按目标课程发起任务，不修改「本次课程」 |
| 转录 | `TranscriptionService`：接收任务配置与课程 ID，独立上报状态 |
| 应用设置 | `SettingsService`：全局默认值、目录、外观 |

前端对应 `stores/courses.ts`、`stores/account.ts`、`stores/app.ts`、
`stores/scheduler.ts`、`stores/settings.ts`，页面只通过类型化 IPC 调用，
不在组件里推导业务模式，也不自己维护任务状态。

`src/shared/courses.ts` 是唯一的兼容边界：`settingsForCourse()` 把课程配置翻译成
旧 Runner 仍在读取的 `AppSettings` 字段。执行器内部暂未重写，但数据来源已经隔离，
且运行期间不会写回全局设置。

---

## 3. 关键契约

```ts
interface Course { id, identity, name, url, kind, options, createdAt, updatedAt, lastRunAt, progressWarning }
interface CourseRunOptions { action, startPosition, skipCompleted, timeLimitMinutes }
interface RunRequest { courseId }
interface RunSnapshot { id, course, settings, startedAt, source: 'manual' | 'schedule' }
interface RunStatus { runId, courseId, snapshot, phase, error, intervention, state, ... }
interface SchedulerConfig { enabled, courseId, startTime, endTime, allDay, dailyLimitMinutes }
```

- 课程 IPC：`courses:list / select / create / update / remove / defaults`
- 运行 IPC：`bot:start` 只接收 `courseId`，配置在启动瞬间快照，运行期间不随设置变化
- 「选择课程同时覆盖全局 URL 与备注」的旧接口已退出主流程

---

## 4. 数据迁移

- `courses` / `course_progress_v2` 与 schema 版本一起在一个事务里建立。
- 旧数据来源是「当前课程配置 + URL 历史」：重复地址按 `identity` 合并，
  当前选中课程保持选中；当前课程保留原运行配置，其他历史课程继承迁移时的默认值。
- 进度按课程 ID 保存，改名不影响续学位置。
- 旧备注进度只有在唯一对应一门课程时才关联；同名歧义数据保留原样，
  在课程详情里显示 `progressWarning`，由用户重新确定续学位置。
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
