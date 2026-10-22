# 离线识别与验证码弹窗接入准备

日期：2026-10-17。上轮窗口与设置修改已单独提交为 `23b75aa`。

## 当前已接入（2026-10-17）

下文“下一步实施顺序”保留为接入前设计记录；当前正式入口已由 `CaptchaService` 调用 `GlyphCaptchaSolver`。

- Browser Host 在 Chromium 初始化前固定 `force-device-scale-factor=2`；原图沿用实际自然尺寸，不额外放大或再次乘 DPR。
- `resources/glyph-worker.cjs` 在独立 worker 中加载本项目模型并串行复用 ONNX 会话，识别工作不阻塞主线程；超时／停止／页面关闭时释放资源。
- 登录、课程与视频场景中的易盾单点题均可使用离线识别。滑块、腾讯验证、未知题型和模型不可用时沿用人工流程。
- 按本次需求覆盖原“一题失败即转人工”的设计：每个挑战最多点击一次，失败或拒识后刷新题目，连续 5 次失败转人工。同一人工介入期间再次检查不会重新开始五轮自动尝试。
- 点击前核对 frame、图源、题目、尺寸、原图哈希与命中位置；只接受唯一目标且坐标在图内和目标框内的 matched 结果。
- 通过信号采用挑战所在 frame 的易盾 `/api/vN/check` 响应 `data.result === true`，并要求验证码面板退出；仅消失或仅收到结果不算完成。
- 离线测试命令：`npx vitest run tests/integration/glyph-captcha.test.ts tests/unit/glyph-worker.test.ts`。实际宿主与原生 worker 冒烟：先构建，再运行 `node scripts/check-glyph-electron.mjs`。
- 已有独立 DPR=2 公开页联调记录在 `output/playwright/glyph-live-10-dpr2-20261017/results.json`：10/10 提交并通过，原图 480×240。该记录不是本次生产入口的在线验收。

## 2026-10-22 liuxx 真实课程排查

使用用户指定账号的临时 profile 副本和实际 Electron Browser Host，复用生产登录、离线 worker 与 GlyphCaptchaSolver。未运行课程播放循环，结束后关闭调试窗口并删除临时 profile；凭据仅在内存中用于登录。

修复前：5/5 原图均为 480×240，离线结果全部 matched 且目标坐标有效；但目标点的 `elementFromPoint` 均为 `div.yidun_bgimg`。生产逻辑要求命中对象严格等于 `img.yidun_bg-img`，因此在提交前返回 failed，实际上没有自动点击。针对 IMG 的 Playwright trial 同样无法通过 SDK 点击层。

修复后：只额外接受当前题图所在、属于同一个验证码弹窗的 `.yidun_bgimg` 本身；在这个点击层上做正常 trial，实际点击仍使用原图坐标映射得到的页面坐标。其他遮挡物、刷新控件、无唯一题图的容器仍拒绝。日志补充识别状态、原图尺寸及命中检查失败原因。

在线复测：登录后未立即弹出，重载同一课程一次自然出现挑战“请点击侧向的数字7”；第 1 次 matched，经正确点击层提交后获得站点确认且浮层退出，返回 solved。一次通过仅证明本次定位故障修复，不代表模型整体准确率。

回归 API 跟踪还发现成功退出时的 DOM 竞态：分步执行 popup count、图片 count、图片 evaluate，可能在前两步之后被 SDK 隐藏弹窗，导致 evaluate 等待已不存在的可见定位器。现改为每个 frame 一次原子读取弹窗数量、题图及题干；成功退出不会再进入该定位器等待。完整验证码及 worker 回归 20 项通过，类型检查和构建通过。

本机证据位于 `output/playwright/glyph-debug-20261022/`：修复前 events.jsonl、predictions.json、各轮题图及 hit.json；`fixed/` 内为修复后事件、命中状态与窗口截图。资料包含课程信息，不提交到 Git。回归覆盖 pointer-events:none 题图的正常点击层、iframe 坐标偏移，以及同一点击区域中的其他覆盖控件仍不提交。

## 已落地的运行资源

训练交付来源：`/Users/wangyafei/Projects/captcha_solver/release/glyph-recognition-v1/`。本项目持有自己的运行资源副本，开发与打包运行均不依赖该绝对路径。

- `resources/glyph-recognition/models/detector.onnx`：YOLO11n，约 10.6 MB，SHA-256 `d2b0a4080447f216f6acfc64d9aab2039432b011991d1c5c2ee2409ef7fdf9ea`。
- `resources/glyph-recognition/models/roi-classifier/model.onnx`：ResNet-18，约 44.9 MB，SHA-256 `c83fb69a67d45d5d2efb8b5029e7f735fe58fb785f0af0f1f8e3b5cb4d3df89b`。
- 对应类别表、预处理和解析配置、JS 库、来源及第三方说明已复制。训练 checkpoint 继续保留在训练项目，应用推理不需要它们。
- 固定图片与 Python 参考结果也保存在本项目，用于离线回归；这些测试图片不进入安装包。
- `IMPORT-MANIFEST.json` 记录逐文件哈希和上游清单哈希。导入前校验上游清单中的全部文件，再复制选定运行文件。
- 根项目锁定 `onnxruntime-node@1.23.2`、`jpeg-js@0.4.4`、`pngjs@7.0.0`，不复制训练项目的 node_modules。
- electron-builder 已配置模型 extraResources、应用内 JS 文件和 ONNX Runtime 原生库的 asarUnpack。JS 库保存在 app.asar 内，才能解析同一应用的 node_modules；模型保存在 asar 外。

```sh
# 已完成导入；以后更新交付时显式指定来源
npm run glyph:prepare -- /path/to/glyph-recognition-v1
# 校验本地副本，并用本项目依赖复跑 8 组固定图片
npm run glyph:check
```

离线回归比较对象数量、身份、朝向、颜色、解析结果、目标与坐标，坐标容许 JPEG 解码造成的 0.5 像素差异。它不访问站点或提交答案，也不覆写上游评估报告。入口直接使用库 API 并指定模型路径，不使用交付包中默认路径有误的 CLI。

## 接入位置

`src/main/automation/captcha.ts` 的 `CaptchaService.checkAndHandle()` 是统一验证码入口。目前仍执行人工处理；本次准备未启用自动点击。

传统课程由 `ClassicPageInteractions.checkpoint()` 检测受保护弹窗，返回 `protected`；`ClassicCourseNavigator.settle()` 再调用 `checkAndHandle()`。因此应在 CaptchaService 中增加有界自动处理，保留现有弹窗所有权，不在普通浮层关闭器中再建循环，也不直接删除验证码 DOM 或遮罩。

共享接口也用于登录、图谱与掌握度流程。初次启用仅针对非登录场景的易盾文字／几何体单点题；登录滑块、腾讯验证、未知题型和 iframe 异常继续人工处理。

## 下一步实施顺序

1. **建立常驻识别 worker。** JS 入口始终从 app.getAppPath()/resources/glyph-recognition/js/src/index.mjs 加载；模型根目录使用 app.getAppPath()/resources/glyph-recognition（开发）或 process.resourcesPath/glyph-recognition（打包）。显式创建 Detector 和 RoiClassifier，复用会话；图片与题目通过消息传入，结果通过任务 ID 返回。不要在 Electron 主线程做图像预处理。按工作流生命周期释放 worker，排队串行使用，停止、超时、崩溃时清理待处理任务。
2. **读取唯一、可见且已加载的挑战。** 已采集 DOM 为 `.yidun_popup`、`.yidun_bg-img` 和 `.yidun_tips__text`。保存当前图源、题目、自然尺寸、图像字节哈希和 frame 身份。多弹窗或多图片不得任意取第一个；题目不支持、图片未加载时转人工。通过浏览器会话读取当前实际原图，不用包含刷新图标的元素截图替代。不要把带查询参数的图片 URL、Cookie 或图片字节写入日志。
3. **调用库 API。** 原图解码为 RGB，再调用 `recognize(pixels,width,height,instruction,detector,classifier)`。保留交付版预处理、颜色词表和解析约定。只接受 matched、唯一 targetId、有限且位于图内的 pointInImage；并验证点位于对应目标框中。uncertain、unsupported_instruction、依赖缺失、推理异常一律转人工。
4. **点击前重新核对挑战。** 再读取图源、题目、自然尺寸及可见状态；刷新或切页后丢弃旧结果。停止后不得点击。读取最新的图像显示位置，按当前自然尺寸分别计算 x/y 比例；iframe 场景使用 Playwright 定位器的页面坐标，避免漏加 iframe 偏移或重复应用 DPR。核对元素未被遮挡，不复用推理前的位置。
5. **确认站点结果后继续。** 每个挑战最多自动尝试一次，不循环刷新。提交前先监听实际成功／失败信号；点击后须确认验证成功且浮层退出，再返回 handled。验证码变成下一题、显示错误、超时或只有弹窗关闭而没有可靠成功证据时，应返回明确状态并转人工，不把“模型找到目标”当作“站点验证通过”。
6. **保持现有人工兜底与业务状态。** 自动处理失败继续调用 requestManualHelp()，沿用运行页“打开处理窗口／已完成，继续”。人工取消或停止返回停止；验证码未解决期间不推进视频完成记录、续学位置或下一课程。

## 启用前的验收

- 本地 DOM 夹具：显示／隐藏、缩放、iframe 偏移、多弹窗、刷新中与点击前刷新、停止、超时、错误题型、目标不唯一、遮挡、站点拒绝、成功退出后继续。
- worker：模型加载失败、消息 ID、排队、超时、停止、退出和资源释放；主线程仍能处理停止操作。
- Electron 冒烟：开发模式和实际打包资源均可加载模型及 ONNX 原生库，不依赖系统 Node/Python 或训练目录。
- 在线联调：在一次用户授权的实际弹窗中，记录脱敏后的阶段、耗时、结果与站点确认，验证人工兜底。离线 8 组通过不能替代在线确认。

## 当前性能证据的边界

本项目复制后的 8 组固定用例已分别在系统 Node 与 Electron 自带 Node 下通过。上游报告还记录固定 50 张目标选择 50/50、补充验收批 140/140，这两个全集本次未复跑。实际安装包尚未构建验收。

交付 matcher 默认身份／朝向门槛为 0，只用唯一性不能保证高置信度；启用自动点击前需用冻结验证数据确定门槛，并报告接受准确率和拒识率。圆柱、圆锥、球的 front 是标签约定；4 个几何体组合的补测仍各只有 1～2 个对象。同一采集批次的成绩不能替代后续独立批次验收。

## 2026-10-17 真实弹窗联调

通过 `scripts/try-glyph-popups.mjs` 在公开页面以 Playwright 触发 10 道新题，使用本项目模型副本。每题最多点击一次，保留录像与窗口截图；没有进入账号或课程。此次是独立联调脚本，尚未接到生产 CaptchaService。

- 实际原图均为 320×160；沿用交付库原始输入路径，5 题 matched 并提交，5 题 target_missing 未提交。
- 提交的 5 题均获得服务端 result=true 和 SDK 成功回调；0 次站点拒绝、0 次未确认。覆盖率 50%，接受样本通过率 100%，样本量仅 10 道。
- 同一批原图离线统一到交付约定的 480×240 后，10/10 可得到唯一候选；这些新候选没有在线提交或独立标注，不能称为 100% 正确。
- 因此接入前必须明确输入尺度的转换，并将 480 坐标映射回实际自然图和当前 DOM；不能假设站点始终提供 480×240 原图。统一尺度后还需在线验收。
- 录像、每题原图和预测、站点结果、尺寸对照在 `output/playwright/glyph-live-10-20261017/`，入口为 `index.html`。文件内不保存验证码 token、Cookie 或带参数图源 URL。
