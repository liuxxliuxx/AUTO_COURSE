# 真实课程弹窗采样

2026-10-13，使用用户指定的「计算机网络原理共享课」及账号「王亚飞」进行有限现场调查。原账号 profile 复制到临时目录，独立启动应用已有的 Electron Browser Host，未启动 CourseRunner、QuizService、CaptchaService 或任何自动关闭器。因此采样期间全部自动弹窗处理被绕过，生产配置和本地续学数据库未改写。平台仍可能记录实际播放。

原始现场位于 `output/playwright/popup-survey/`（Git 忽略），每份完整样本包含 `screen.png`、`dom.html`、`state.json`；网络时间线位于 `events.jsonl`。该目录含个人课程信息，仅用于本机诊断。

## 已验证的类型与规律

| 类型 | 真实结构与触发方式 | 处理上的区别 |
| --- | --- | --- |
| 学前必读 | `.dialog > .mask + .dialog-read`；点击页头「学前必读」出现，内容异步填充 | 关闭控件是 `i.iconfont.iconguanbi`。脚本中的首次展示逻辑读取 `readKey`，关闭会写入与课程关联的标记；复用 profile 后并不保证自动弹出 |
| AI 助教面板 | `.ai-draggable-dialog`；点击右下角 `.ai-show-icon` 打开 | 包含输入区域，是交互面板，应作为独立类型管理；现有一般浮层保护规则会跳过带表单的容器 |
| AI 助教使用提示 | `.ai-helper-agreement-Dialog`，标准 Element UI 遮罩 | 真实关闭提示入口是 `div.primary-btn`「我知道了」，不是 `button`；不应将其他协议接受或提交按钮等同于普通关闭 |
| 课程提醒 | `.el-dialog__wrapper.dialog-warn`，点击页头「课程提醒」出现 | 没有 X；`div.talk-later-btn`「下次再说」是临时关闭；「已绑定，不再提示」会改变提醒状态 |
| 浏览器推荐提示 | `.exploreTip`，页面顶部黄色条 | 是常驻横幅，不是模态弹窗；「不再提示」有持久化语义 |
| 弹题时间标记 | `.video-topic > ul > li`，节点 `left:86.8649%` | 标记与题目弹窗分开管理。实测容器覆盖播放器底部约 1020×20 px，标记约 5×5 px；有局部截获点击的可能，必须结合具体目标命中检测，不能无条件删除整个标记层 |
| 弹题测验 | `.el-dialog[aria-label="弹题测验"]`，到标记时间出现 | 视频约 807.446 秒，百分比换算约 701.387 秒；定位到 695 秒并播放后，约 701.222 秒出现题目并暂停。未提交答案。包含选项、上一题、下一题及关闭控件 |
| 进度提交失败 | `.el-dialog__wrapper.dialog-back`，内容为「因网络连接问题，导致学习进度提交失败…」 | 本次为**故障注入样本**：一次 `/learning/saveDatabaseIntervalTimeV2` 请求在本地被替换为 `code:-1` 的响应，未送到服务端。切换视频触发保存后弹窗出现，视频仍继续播放。点 X 关闭不证明保存已恢复 |

## 验证码调查的证据边界

实际网络中观察到网易易盾的 `/api/v2/getconf`、腾讯验证码 iframe 与相应脚本，以及旧门户图片验证码资源。加载这些资源不等于屏幕上存在有效挑战。

课程脚本中发现 `capinitAbleYidunFallback`、`popupYidunInstance`、`validateMessage` 等方法；原有集成使用 `window.initAbleYidunFallback`，`capType` 为 `space`，实例的展示方法是 `popUp`。平台校验函数名包括 `validateSlideToken`，但不能仅凭函数名断言某个具体接口已请求或验证成功。

实际通过站点 SDK 单次主动打开了易盾文字点选挑战（不是滑块），完整截图和提示文字已保存。观察到 `GET c.dun.163.com/api/v3/get` 获取挑战、`POST ir-sdk.dun.163.com/v4/j/up` 风险初始化及挑战图片资源。没有解题或提交验证码，因此没有实际验证请求或验证成功证据。没有批量刷新、无限请求、自动解题、伪造验证结果或收集可复用验证令牌。

本轮共保存 66 份完整现场（含加载及动画状态），整理为 8 组代表样本。图集和报告位于 `output/playwright/popup-survey/index.html` 与 `REPORT.md`。诊断窗口已关闭，临时 profile 和私有配置已删除。

## 还不能声称覆盖的内容

- 原截图那种包含「欢迎你加入课程／课程学习时间／考试时间」的欢迎安排卡，本次没有自然出现；`.aiMsg.once` 的隐藏壳可在 DOM 中找到，不能把它当作已获得的可见样本。
- 部分错误、异常学习、退出确认、学习习惯与人脸验证结构仅在 DOM 或客户端代码中发现。未触发就不算真实现场。
- 未人为触发反脚本警告、人脸验证或多个账号/窗口抢占，也没有通过提交错误验证码来枚举错误状态。

## 复用采样工具

`scripts/survey-course-popups.mjs` 使用项目已有的 Electron Playwright 宿主，保留应用相同的浏览器环境；它是诊断工具，不是新的课程执行策略。先准备仅本地保存的配置 JSON：`course.url`、临时 `profile` 路径，机构登录还需已保存加密凭据的 `credentialFile` 路径。不得把明文密码写入配置。

```sh
node scripts/survey-course-popups.mjs output/playwright/popup-survey/config.local.json
```

在同目录写入 `command.json` 发送一次命令；前一个文件被读取删除后再写下一个，避免覆盖。支持 `capture`、`click`（显式 selector）、`hover`、`play`、`seek`（seconds）、`reload`、`runtime`、`login` 和 `stop`。所有点击前后先保存现场；没有自动答题、自动关闭或自动验证码确认。

`fail-next-progress` 仅模拟一次保存失败，日志明确标注本地注入；`captcha-once` 每个采样目录最多允许一次显式挑战观察，不自动完成验证。运行有 25 分钟上限，应主动 `stop` 收尾。

网络记录只保留 URL 路径、查询参数名、状态码、请求字段名和响应数据类型结构，不保留 Cookie、Authorization、明文密码、请求正文值或响应令牌。DOM 副本剔除脚本、表单值和敏感属性，截图仍可能包含姓名和课程信息，不应提交到 Git 或直接外发。诊断结束后删除自己创建的临时 profile 和私有配置；保留样本供本机分析。
