# 字符点选视觉识别：独立训练项目交付说明

版本：1.0；日期：2026-10-13；接收端：AUTO_COURSE（Electron / Node.js / TypeScript）。

本文是新模型训练项目的需求、数据说明和交付契约。目标是在 Python / PyTorch 中训练模型，导出 ONNX，交给 JavaScript 完成本地离线推理。

**当前已交付：15 组真实样本、采集元数据、视觉大模型对照结果、本说明。当前没有训练好的 YOLO 或属性分类权重。第 8 节列出的模型文件必须由新项目实际训练、评估、导出后交回，不是本次已有产物。**

## 1. 目标与工作边界

实现以下流水线：

```text
纯题图 → YOLO 检测字符框 → 按框裁剪字符
                         ├→ 颜色分类
                         ├→ 朝向分类
                         └→ 字符分类（A–Z、a–z、0–9）
题目提示 → 大模型解析为结构化条件
字符属性表 + 结构化条件 → 程序匹配 → 目标 ID、题图坐标、置信度 / 无法确定
```

第一版按用户指定的结构交付：一个 YOLO 检测模型，加三个独立属性分类模型。共享骨干与三个分类头可作为后续实验，不能未经记录替换第一版接口。

训练项目负责数据整理、标注、训练、评估、ONNX 导出、Node.js 推理示例及交付包。训练及评估按离线图像任务完成；现有应用的验证码人工处理流程本次没有接入或修改。是否接入课程执行流程另行实施。

## 2. 现有数据与实测基线

### 2.1 启动包结构

交付压缩包中的路径全部相对于解压目录：

```text
captcha-training-handoff/
├── HANDOFF.md                     本说明
├── README.md                      新项目接手顺序
├── SHA256SUMS.json                 包内文件校验值
├── dataset/
│   ├── manifest.json               可迁移清单与后续测试状态
│   └── samples/001…015/
│       ├── challenge.png           纯题图，实际 640×322 像素
│       ├── captcha.png             含题目提示的弹窗，实际 704×598 像素
│       └── metadata.json           提示、时间、截图几何信息
├── annotation/
│   ├── template.json               逐字符标注结构示例，非样本答案
│   ├── labels.json                 字符类别顺序及属性词表草案
│   └── weak-target-boxes.json      既有人工近似目标框，仅供复核
└── baselines/
    ├── summary.json
    ├── deepseek-results.json
    └── qwen-results.json
```

15 张纯题图哈希不同；题目覆盖指定颜色、指定朝向、与参照字符颜色相同、与参照字符朝向相同等类型。样本包括字母、数字、几何干扰物、三维厚度和局部遮挡。

启动包不包含整页课程截图、浏览器 profile、登录配置、Cookie、凭据或 API 密钥。现有样本元数据内的 `modelTested:false` 是**采集时的历史快照**；最新测试情况以启动包 manifest 和 baselines 为准。

**这 15 张适合流程调试，不足以验证 62 类字符和多种属性的泛化能力。它们已经参与提示词开发，不能作为独立最终测试集。**

### 2.2 已完成的离线基线

| 方法 | 人工近似目标框内命中 |
| --- | --- |
| Qwen 3.5 9B：纯题图 + 归一化坐标提示 | 7/15 |
| Qwen 3.5 9B：编号候选 + 结构化提示 | 10/15 |
| Qwen 3.5 9B：放大原图与编号对照图 | 12/15 |
| DeepSeek V4.1 Flash：纯题图 + 归一化坐标提示 | 10/15 |

DeepSeek 每题一次，平均约 0.90 秒，thinking disabled，temperature=0；与 Qwen 纯题图方案使用相同提示正文，输入流程不同的其他方案仅作参考。均未提交网站验证。

评分使用人工目视近似矩形，没有服务端命中区域；它不是实际通过率。弱标注需要重新审核，尤其是朝向关系。不要直接把模型预测或这些近似目标框当作全字符训练标签。

## 3. 数据获取方式

### 3.1 现有真实样本的获取过程

使用应用已有的 Electron Browser Host 与 Playwright，复制已有账号 profile 到临时目录；通过站点已有易盾 SDK 打开 `capType:'space'` 挑战，再使用弹窗的刷新按钮逐张取得新题。

原项目中可参考：

- `scripts/survey-course-popups.mjs`：已有采样与现场检查工具，`captcha-once` 每个调查目录仅主动打开一次挑战。
- `output/playwright/captcha-samples-20261013/collect.mjs`：本次有限批次采集的本地实验脚本；依赖 AUTO_COURSE 宿主和临时配置，不是独立训练项目可直接运行的通用采集器。
- `docs/POPUP_SURVEY.md`：站点结构、采样方式与观察范围。

本次批次目标为 15 个不同挑战；刷新间隔约 8 秒，等待图片加载和界面稳定后保存，成功后关闭宿主并删除临时 profile 与配置。没有点击答案或调用验证码验证接口。

### 3.2 后续采集应提供的功能

在原应用环境采集后，把数据包导入训练项目。若新项目实现采集入口，应显式配置 `appRoot`、临时 profile、课程地址、输出目录、最大样本数与刷新间隔；不硬编码本机路径或账号，不把密钥写入仓库。

已观察到的页面元素：

| 内容 | 选择器 |
| --- | --- |
| 可见挑战弹窗 | `.yidun_popup:visible` |
| 弹窗主体 | `.yidun_popup:visible .yidun_modal` |
| 纯题图 | `.yidun_popup:visible .yidun_bg-img` |
| 提示文字 | `.yidun_popup:visible .yidun_tips__text` |
| 刷新按钮 | `.yidun_popup:visible .yidun_refresh` |

以上是当前采样现场选择器，需要现场确认；`:visible` 为 Playwright 选择器扩展，不能直接交给浏览器 `querySelector`。

每次保存步骤：

1. 读取刷新前图片标识；通过页面刷新按钮触发下一张。
2. 等待图片变化、`complete=true`、`naturalWidth>0`，并确认提示已更新，加载遮罩消失。
3. 同时保存纯题图、含提示弹窗及提示文字；截图前后再次检查题图标识和提示是否一致，避免保存串题。
4. 保存实际图像宽高、DOM 的 CSS 矩形、DPR、采集时间和采集会话 ID。
5. 计算 SHA256 去除完全重复图；通过感知哈希与人工复核分组近重复图。
6. 加载失败、频率限制或额外验证时停止本批次，保留已有数据及失败原因；限制总次数和运行时长。

后续建议按类别覆盖逐步补充，例如先做数百张用于验证标注和训练，再根据学习曲线、类别数量及错误分布扩充。数据量以每个字符和属性组合的有效覆盖为依据，不以总张数作为达标条件。

### 3.3 合成数据补充

可用离线三维字符渲染补充稀缺类别：控制字符、字体、主体色、三维朝向、挤出厚度、光照、位置、背景和遮挡，自动生成精确标签。合成数据与真实数据分别记录来源。

合成字体与真实题图可能存在差异；合成数据不能替代真实独立测试。颜色与朝向按渲染参数生成标签，避免依赖合成器生成后再由模型猜标签。

## 4. 标注规范

### 4.1 每张图必须标注的内容

- `sample_id`、`source_session_id`、`source_type`（real / synthetic）、`duplicate_group_id`。
- 原始图像宽高、原文提示、提示的结构化解释。
- **所有可见字符**的独立边界框、字符、主体颜色、朝向，而非只标答案。
- 每个属性的审核状态；遮挡与歧义说明。
- 可确定时的目标对象 ID；不确定时标记 `needs_review`，不能强制猜答案。

边界框采用原始纯题图像素的 `[x1,y1,x2,y2]`，右、下端采用半开区间。完整包住字符正面和三维侧面。相邻或重叠字符分别画框，不能合成一个对象。刷新图标、方块等干扰物不标成字符；记录为忽略区域或背景说明。

### 4.2 属性定义

| 属性 | 第一版约定 |
| --- | --- |
| 检测类别 | 单类 `glyph`，检测所有字母和数字 |
| 字符类别 | 固定 62 类，顺序为 A–Z、a–z、0–9 |
| 颜色 | 先用 red/yellow/green/cyan/blue/purple/gray/black/white 词表；未观察到的类别注明未覆盖 |
| 朝向 | `front` / `side`；不能判断时标签为 null，并 mask 掉对应分类损失 |
| 歧义 | `ambiguous_char`、`ambiguous_color`、`ambiguous_orientation`、`occluded` |

颜色指字符主体材料颜色，不把高光、阴影或侧面的深色当成独立颜色。`front/side` 指三维字符字面的朝向，不指画面左/右位置，也不等同于平面内旋转。由标注者先审核一组正反例，建立朝向示例页，后续保持同一口径。

某些字体中 `O/o/0`、`V/v` 等仅靠单字符外观可能无法唯一确定。允许 null 与歧义标记，保存可选类别集合，不根据题目答案反推成确定字符标签；推理阶段保留类别分布，在题意约束下筛选。

`unknown` 是运行时低置信度状态，不默认添加为第 63 个可训练字符类。只有定义并采集足够的拒识样本后，才能另行训练未知类。

### 4.3 标注记录示例

以下只是格式示例，不是 001 的真实对象标签：

```json
{
  "sample_id": "example",
  "source_session_id": "session-example",
  "duplicate_group_id": "group-example",
  "image": "samples/example/challenge.png",
  "width": 640,
  "height": 322,
  "instruction": "请点击大写F朝向一样的小写e",
  "objects": [
    {
      "id": "g1",
      "bbox_xyxy": [100, 40, 160, 140],
      "character": "F",
      "color": "green",
      "orientation": "front",
      "review_status": "reviewed",
      "flags": []
    }
  ],
  "query": {
    "target": {"character": "e"},
    "reference": {"character": "F"},
    "match_attribute": "orientation"
  },
  "answer_object_ids": [],
  "answer_status": "needs_review"
}
```

### 4.4 数据划分

先按原始题图和会话分组，再分 train / val / test；同一图中的字符裁剪、近重复图、同一合成基础场景的变体必须在同一集合。禁止按裁剪字符随机分组。

可从 70% / 15% / 15% 起步，并按会话、字符与题型覆盖检查；最终冻结划分清单与哈希。对样本不足的类别写明未覆盖，不能用训练集分数替代测试分数。现有 15 张归入开发集合；另采集并冻结独立测试数据。

## 5. 训练步骤

### 第一步：建立可复现训练环境

建立独立 Python 项目，使用 PyTorch、torchvision、Ultralytics、ONNX、ONNX Runtime 与图像处理库。首次跑通后锁定准确依赖版本，记录 Python、CUDA / 驱动或 CPU / MPS 后端、硬件与随机种子。无需在 AUTO_COURSE 中安装训练环境。

新项目应实现以下脚本接口（本交付包没有这些训练脚本）：

```text
validate_dataset.py   检查标注、类别、重复与跨集合泄漏
build_dataset.py      生成 YOLO 数据与三个分类任务数据
train_attributes.py   训练字符 / 颜色 / 朝向分类器
calibrate.py          在验证集选择阈值与校准置信度
export_models.py      导出三个分类模型为 ONNX
compare_runtimes.py   检验 PyTorch / ONNX / JS 的一致性
benchmark_pipeline.py 评估完整离线识别链路
```

### 第二步：检测数据与 YOLO 训练

生成 YOLO 单类检测数据；每张图一个同名 txt，每个字符一行：

```text
0 x_center_normalized y_center_normalized width_normalized height_normalized
```

坐标归一化到 0–1，类别 0 为 glyph。按官方 YOLO 格式组织 `images/{train,val,test}` 与 `labels/{train,val,test}`。[官方数据格式](https://docs.ultralytics.com/datasets/detect/)

`configs/glyph.yaml` 示例：

```yaml
path: datasets/glyph
train: images/train
val: images/val
test: images/test
names:
  0: glyph
```

先用轻量 YOLO 检测器建立基线，例如固定使用 `yolo11n.pt`，加载预训练权重后微调。下面是配置起点，不是保证达标的参数：

```bash
yolo detect train model=yolo11n.pt data=configs/glyph.yaml imgsz=640 epochs=100 batch=16 seed=42 fliplr=0 flipud=0 degrees=0 mosaic=0 hsv_h=0 hsv_s=0 hsv_v=0
yolo detect val model=runs/detect/train/weights/best.pt data=configs/glyph.yaml split=test
```

路径按实际运行产物设置。batch 随显存调整；图像尺寸与训练轮数根据验证结果选择。优先排查漏检、重复框与重叠字符，不能只看总体 mAP。YOLO 导出是否内置 NMS必须明确记录。

### 第三步：构建字符裁剪数据

先用人工框构建分类训练集，向四周扩展约 10% 边距并裁到图像范围；保持长宽比，以 padding 补到统一尺寸，不拉伸字符。验证时另提供检测框生成的裁剪集，用于测量检测误差的影响。

裁剪数据保留原样本 ID、原框、扩边框及属性标签。将检测框的轻微偏移和尺度误差作为训练扰动，避免分类器只适应完美人工框。

### 第四步：训练三个属性分类器

三个模型独立训练，可以使用相同轻量预训练骨干（如 MobileNetV3 Small），分别替换分类头：

- 字符：62 类；逐类别统计 `O/o/0`、`I/l/1`、`V/v` 等混淆。
- 颜色：按最终词表训练，保留 RGB；灰度化不适用于颜色任务。
- 朝向：front / side；剔除或 mask 无法确认的朝向标签。

采用迁移学习：先训练新分类头，再解冻部分骨干微调，以验证集选择 best checkpoint。[PyTorch 迁移学习文档](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html)

建议第一版输入固定为 `[N,3,96,96]` float32，RGB、NCHW、像素除以 255，再使用所选骨干对应的 mean/std。实际参数必须与训练一致并写入交付 manifest，不可由 JS 端猜测。

不要默认套用自然图片分类的全部增强：翻转可能改变字符；旋转或透视会改变朝向语义；强色相变化会改变颜色标签。第一版只使用不改变标签的裁剪抖动、轻微压缩和有限亮度扰动。各分类任务可以有不同增强，但导出必须记录各自预处理。

### 第五步：语义解析与条件匹配

大模型输入题目文字，输出受 schema 约束的查询；视觉模型负责属性，程序执行匹配。基本题型：

```json
{"target":{"character":"m","color":"blue"},"reference":null,"match_attribute":null}
```

```json
{"target":{"character":"D","orientation":"side"},"reference":null,"match_attribute":null}
```

```json
{"target":{"character":"e"},"reference":{"character":"F"},"match_attribute":"orientation"}
```

```json
{"target":{"character":"U"},"reference":{"character":"L"},"match_attribute":"color"}
```

校验字符大小写、合法属性名、条件完整性；“和 F 一样的小写 e”若没有说明比较颜色还是朝向，应返回 `ambiguous_instruction`。固定题型可以用规则解析器覆盖，以大模型处理规则未覆盖表达；语义解析实现与模型版本需要一同交付。

匹配流程：筛选参照字符 → 确定其被比较属性 → 筛选目标字符 → 比较指定属性 → 检查唯一性与置信度。多个参照可以仅在相关属性一致时合并，否则返回歧义。多个目标匹配时不任意选第一个。

### 第六步：端到端评估与误差归因

至少报告以下指标：

| 层级 | 必报指标 |
| --- | --- |
| 检测 | precision / recall、mAP、整图所有字符检出率、重复检出率 |
| 字符 | accuracy、macro F1、每类支持数、混淆矩阵 |
| 颜色与朝向 | 各自 accuracy、macro F1、分组混淆、未覆盖类别 |
| 语义解析 | 结构化字段 exact match、无效 JSON 率、歧义识别 |
| 完整链路 | 目标对象 ID 准确率、坐标落入复核区域比例、拒识率、接受样本准确率 |
| 性能 | 指定硬件下加载耗时、预热后 p50/p95 延迟、内存、模型文件体积 |

同时测试人工框分类和检测框分类，分别归因于检测、字符、颜色、朝向、题意与匹配规则。拒识样本不能从分母中静默删除；同时报告总体正确率与接受样本的准确率 / 覆盖率。

第一阶段以完整跑通和可复现指标为验收；正式性能目标在独立测试集冻结后再确定，不预设已达 95% 或 99%。目前的 15 张实验结果不能当生产验收依据。

### 第七步：导出与运行时一致性验证

检测器使用官方 ONNX 导出，第一版固定 batch=1、float32；三个分类器使用 `torch.onnx.export` 导出，batch 可以动态，空间尺寸固定。先选定部署端支持的 opset 并记录，遇到不支持算子时调整网络或导出方案。ONNX opset 17 可作为验证起点，不能代替兼容性检查。[YOLO 官方导出文档](https://docs.ultralytics.com/modes/export/)

检测器导出示例：

```bash
yolo export model=runs/detect/train/weights/best.pt format=onnx imgsz=640 batch=1 dynamic=False half=False opset=17 nms=False
```

若选择 `nms=False`，交付 JS 必须实现与 Python 相同的输出解码与 NMS；若改成内置 NMS，更新输出协议与 golden cases，不能同时重复执行。不能假设所有 YOLO 版本的输出形状一致。

使用固定 golden cases 比较 PyTorch、Python ONNX Runtime 和 Node.js ONNX Runtime：记录输出形状、最大绝对 / 相对误差、分类 top-1、检测框及最终目标的一致性。允许的数值误差按模型实测设定，最终选择变化必须调查。

## 6. JavaScript / Electron 推理与坐标约定

Node.js 通过 `onnxruntime-node` 加载模型；模型与依赖作为应用资源分发，推理放在常驻 worker 或独立 utility process，避免占用渲染线程。不依赖 Python 运行时。[ONNX Runtime Node.js 文档](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)

启动时加载会话并预热，随后复用；一张图中所有字符裁剪按分类器能力批量推理。接收端优先建立 float32 CPU 基线；GPU 是否可用必须按实际系统与运行时构建验证，不假设 Node.js 自动使用 macOS MPS 或任意 GPU。

顺序保持一致：RGB → detector letterbox → 检测框解码及反变换到纯题图 → 原图裁剪并 padding → 三个分类器 → 属性表 → 语义匹配。

接口示意：

```ts
type RecognitionResult = {
  schemaVersion: '1.0'
  status: 'matched' | 'uncertain' | 'unsupported'
  objects: Array<{
    id: string
    bbox: [number, number, number, number] // 原始纯题图像素 xyxy
    detectionConfidence: number
    character: { label: string | null; probability: number }
    color: { label: string | null; probability: number }
    orientation: { label: 'front' | 'side' | null; probability: number }
  }>
  targetId: string | null
  pointInImage: { x: number; y: number } | null
  reason: string | null
}
```

交付完整 schema 与实际示例，概率需说明是否校准。不要把 softmax 数值直接解释为实际正确率。匹配状态要求目标唯一且各相关属性通过验证集选定阈值。原始类别分布 / top-k 建议作为可选调试输出。

目标点第一版使用检测框中心，矩形半开边界内约束；遮挡、紧邻字符、中心落在非目标内容等情况返回不确定，必要时另行加入 mask / 目标区域估计，不能把框中心永远正确作为前提。

题图坐标到页面 CSS 坐标：

```text
cssX = currentChallengeRect.x + pointInImage.x × currentChallengeRect.width / actualImageWidth
cssY = currentChallengeRect.y + pointInImage.y × currentChallengeRect.height / actualImageHeight
```

使用当前图片实际尺寸和当前 DOM 矩形，不盲目只除以 DPR。已有题图 640×322、CSS 内容约 320×160，存在截图取整差异；原始下载图自然尺寸又是 480×240。若使用弹窗裁剪图或做过 letterbox，先还原到纯题图再换算。历史 metadata 仅供离线重现，不能复用于下一道挑战。执行前还需确认题图未变化；本训练交付仅返回坐标，不实现网页点击。

## 7. 新训练项目建议结构与实施顺序

```text
vision-training/
├── README.md
├── requirements.lock
├── configs/
├── data/raw/                       导入启动包中的 dataset
├── data/annotations/               审核后的逐字符标签
├── data/splits/                    冻结划分
├── scripts/                        第 5 节规定的脚本
├── src/                            模型、预处理、匹配逻辑
├── js/                             Node 推理示例和依赖锁
├── runs/                           训练日志与 checkpoint
└── release/                        最终交付模型包
```

接手顺序：

1. 解压启动包，核对 SHA256；先阅读本说明和 metadata。
2. 用现有样本建立标注与可视化流程，复核所有弱目标框和朝向口径。
3. 获取足够的类别覆盖，按原图 / 会话分组冻结数据划分。
4. 先训练单类检测器，再分别训练三个分类器。
5. 实现题意 schema 与确定性匹配器，评估完整链路。
6. 导出 ONNX，完成 PyTorch / ONNX / Node 对照。
7. 按下一节产物清单交付真实权重与报告。

## 8. 训练完成后必须交回的产物

```text
release/glyph-recognition-v1/
├── README.md                       安装、运行、输入输出、限制
├── manifest.json                   版本、文件哈希、模型协议、阈值
├── models/
│   ├── detector.onnx               训练完成的字符定位模型
│   ├── character.onnx              训练完成的 62 类字符模型
│   ├── color.onnx                  训练完成的主体颜色模型
│   └── orientation.onnx            训练完成的 front/side 模型
├── checkpoints/
│   ├── detector.pt                 对应 best checkpoint
│   ├── character.pth
│   ├── color.pth
│   └── orientation.pth
├── configs/
│   ├── training/                   完整训练参数及随机种子
│   ├── labels.json                 ID 到标签的固定顺序
│   ├── preprocessing.json          每模型输入预处理
│   └── semantic-query.schema.json
├── js/
│   ├── package.json
│   ├── package-lock.json
│   ├── infer.mjs                   image + instruction → JSON
│   ├── decode-detector.mjs          对应导出版本的解码 / NMS
│   ├── match.mjs                   条件匹配与拒识
│   └── semantic-parser/            提示 / 规则 / 校验 / 单元样例
├── evaluation/
│   ├── metrics.json
│   ├── REPORT.md
│   ├── confusion-matrices/
│   ├── errors/                     错误与拒识案例
│   ├── runtime-parity.json
│   └── hardware.json
├── golden/                         固定图片、题目、预期输出
├── provenance/                     数据版本、划分哈希、代码 commit
├── requirements.lock
├── SHA256SUMS.json
└── THIRD_PARTY_NOTICES.md           框架、基础权重、字体等来源和许可
```

`manifest.json` 至少包含：模型版本、训练代码 commit、数据版本 / split 哈希、基础权重来源、输入 / 输出名称与形状、dtype、opset、标签映射、RGB/NCHW、缩放与 mean/std、letterbox/padding 参数、检测框坐标定义、NMS 状态与参数、置信度阈值及选择依据、JS 依赖版本、各文件 SHA256。

分类模型输出建议为 logits `[N,C]`，交付标签顺序与 softmax 处理约定。检测器输出按实际导出明确约定，附一份真实张量样例。checkpoint 需附模型结构定义及重新加载方式；只有 state_dict 而无网络结构不算完整可复现交付。

验收时必须能在**没有 Python 的接收端**加载 ONNX，执行固定图片与题目，返回符合 schema 的 JSON；训练复现另在 Python 环境执行。一次命令跑 golden cases，并给出明确通过 / 失败和误差，而不是只展示截图。

不得使用下载的通用预训练模型冒充任务已经训练完成，也不得把未训练权重或占位 ONNX 文件列为已交付。若部分类别覆盖不足或性能未达目标，交付报告如实列出，不通过自动降低阈值隐藏问题。

## 9. 给新项目的启动任务

> 依据 HANDOFF.md 建立独立 Python / PyTorch 训练项目。实现一个 YOLO 字符定位模型和三个独立属性分类模型：字符、颜色、朝向。导入附带 15 组开发样本，先建立逐字符标注、数据检查与可视化流程，不把现有弱目标框或模型输出当作审核标签。完善类别覆盖后按原图与会话划分数据。大模型只解析题意，程序做属性匹配。最终交付真实训练的 PyTorch checkpoint、四个 ONNX、Node.js 推理实现、标签与预处理配置、独立测试报告和运行时一致性验证，满足第 8 节契约。当前没有现成训练权重，不能假称已训练完成。

## 10. 大批采样发现与训练契约补充（2026-10-13）

后续启动了 10 个并发页面任务，每个目标 100 份，输出位于 `output/playwright/captcha-training-1000/`。实际完成数量及各路状态以该批次 `manifest.json`、`status.json` 和 `validation.json` 为准；不要把请求目标 1,000 当作已经完成的事实。

本批次验证了**无需课程登录的公开页面 SDK 初始化**：从 `https://www.zhihuishu.com/` 加载站点已有 `yidun-captcha.js` 和 `ableCaptchaCommon.js`，创建 SDK 默认挂载容器 `#captchaYidun` 后，以现有 `initAbleYidunFallback` 和 `capType:'space'` 初始化挑战，再正常点击刷新。使用全新临时浏览器 session，没有打开课程播放器。10 路是同一浏览器 session 下的不同页面 / SDK 实例，并非十个独立账号或来源。

除截图和提示外，本批次还保存浏览器已加载的原始图片响应 `original.jpg/png`，通常为 480×240；它没有刷新按钮覆盖，建议作为训练主图。原图哈希用于全局精确去重，没有为保存原图重复发起下载请求。截图题图仍为约 640×322，两者标注坐标不能混用。

**新题型要求扩展第 4、5、6、8 节原先以字符为主的约定：几何形体既可以作为参照，也可以作为要点击的目标。** 已观察到题目包括：

- “请点击圆柱朝向一样的大写A”。
- “请点击绿色 立方体朝向一样的数字0”。
- “请点击蓝色大写 P朝向一样的圆锥”。

因此，新项目应采用以下补充作为最新约定：

1. 检测所有可作为题目对象的字符与几何形体。可先用单一检测类 `symbol`；不能把所有形体都作为背景忽略。
2. 仍保持三个属性分类模型，但原“字符分类”扩为**身份分类**，包括 A–Z / a–z / 0–9，加经审核的 `shape:cube`、`shape:cylinder`、`shape:cone` 等形体类别。实际类别由完整数据盘点确定，不把初始三类当作完整形体词表。
3. 对象标注增加 `kind: 'glyph' | 'shape'` 与 `shape` 字段。形体的 character 为 null；字符的 shape 为 null。身份类别到字符 / 形体的映射显式记录在 labels.json。身份 ONNX 仍可沿用第 8 节文件名 `character.onnx`，但 manifest 必须声明其类别已扩展，不能假定输出永远为 62 维。
4. 查询的 target / reference 支持 `{ "shape": "cylinder" }` 等条件，并允许参照同时带颜色，如 `{ "character": "P", "color": "blue" }`。不能仅按字符找参照。
5. 形体朝向也要建立可复核口径。对旋转对称且视觉上无法确定朝向的对象保留不确定标签，不强行制造可分类答案。
6. 批次提供的 `annotations.unlabeled.jsonl` 只有样本骨架，没有逐对象标注和正确答案；objects 为空代表“未开始标注”，不能当作无目标背景图送入检测训练。

独立最终测试应来自后续不同采集批次，并结合近重复分组；本批次十个 worker 不能自动视为十个独立泛化测试来源。

朝向训练还需检查二分类是否足以表达完整题库：若“朝向一样”要求区分多个侧向角度、左右斜视或形体轴线方向，应扩展朝向词表，并保留 front/side 粗粒度映射供对应题型使用；不能把不同朝向一律压成 side 后声称关系题可解。

本批次最终结果：10 路各 100 份，共 **1,000 份原图哈希不同的样本**，跳过 109 次重复；全部任务完成，无采集报错。原始数据尚未逐对象标注、未调用模型测试、未提交验证码。数量与文件校验见随附 validation.json。
