# 验证码离线识别流水线 v1

图片＋题目 → 检测对象 → ROI 分类器（身份与朝向）＋ HSV 颜色 → 规则解析题意 → 程序匹配 → 输出目标框与坐标。全程离线，不依赖网络与大模型。

## 目录

```
glyph-recognition-v1/
├── models/
│   ├── detector.onnx            YOLO11n 单类检测器（opset 17，batch 1，nms=False）
│   └── roi-classifier/          129 类 ResNet-18（model.onnx + labels.json）
├── checkpoints/                 对应 PyTorch 权重
├── configs/                     训练配置、导出校验、标签表、预处理、题意 schema、检测解码说明
├── js/                          Node.js 推理（onnxruntime-node）、规则解析、匹配与一致性测试
├── golden/                      固定用例与 Python 参考输出
├── evaluation/                  指标、混淆矩阵、错误样本、一致性报告与 REPORT.md
├── provenance/                  数据版本、划分与模型哈希
└── SHA256SUMS.json              全部文件校验值
```

## 快速开始

```sh
cd js
npm ci
node src/infer.mjs --image ../golden/images/worker-01-001.jpg --instruction "请点击圆柱朝向一样的大写A"
```

`js/node_modules` 随本机交付保留以便直接运行，但 `SHA256SUMS.json` 与文件清单不含该目录；接收端以 `npm ci` 与 `package-lock.json` 为准重建依赖。

输出字段：`status`（`matched` / `uncertain` / `unsupported_instruction`）、`objects[]`（框、身份、朝向、颜色、各自分数）、`targetId`、`pointInImage`、`reason`。传入 `--rect '{"x":520,"y":240.6,"width":320,"height":160}'` 时额外给出 `pagePoint`（页面 CSS 坐标）。

Node.js 侧只需要 `onnxruntime-node`、`jpeg-js`、`pngjs`，无 Python 运行时。模型与依赖作为应用资源分发，建议放在常驻 worker 或 utility process，避免占用渲染线程。

## 输入输出约定

- 检测输入是纯题图（480×240 原图），输出对象框是原图像素 `[x1,y1,x2,y2]` 半开区间，包含正面与可见厚度面，小写 `i/j` 的圆点属于同一对象。
- ROI 分类器输入 `[N,1,96,96]`：原图框外扩 10%、转灰度、1%/99% 分位拉伸（范围至少 10）、保比例缩到 96、按边界中位数填充、`(p/255-0.5)/0.5`。导出模型的类别顺序以 `labels.json` 为准，不能用编号整除解码。
- 颜色是 HSV 规则：前景为与图像边框背景 RGB 差 > 22 的像素；有效饱和像素不足则判 `gray`。词表 `red/yellow/green/blue/gray`，青色与蓝色是同一个标签，white 并入 gray。所有分数都是未校准的模型或规则分数，不是正确概率。
- 题意解析是确定性规则，覆盖已采集的全部句式（参考句式 `请点击 A <颜色|朝向> 一样的 B`，目标取 B）。无法解析或条件不全时返回 `unsupported_instruction` 或 `uncertain`，并带明确原因。
- 匹配只在约束筛出唯一候选时给出 `targetId` 与坐标；参考缺失、参考不唯一、目标缺失、目标不唯一、分数不足分别返回 `reference_missing`、`reference_ambiguous`、`target_missing`、`target_ambiguous`、`low_confidence`。
- 坐标换算：`cssX = rect.x + x × rect.width / naturalWidth`（Y 同理），使用当前 DOM 矩形与题图自然尺寸；交付只返回坐标，不含点击。

## 验证

- 指标、混淆矩阵、逐类支持数、错误样本与限制见 `evaluation/REPORT.md`。
- Python 与 Node.js 的数值一致性见 `evaluation/runtime-parity.json`。
- 冻结用例与 Python 参考输出见 `golden/python-reference.json`，可用 `npm run parity` 复现。

## 限制

- ROI 分类器在固定 50 张测试集上为 299/300（联合形态×朝向），该测试集曾用于历史评估，不是全新外部盲测；另有 100 张未参与训练与本次测试。
- 4 个几何形体联合类别（`cube|side`、`cylinder|front`、`cone|front`、`sphere|front`）在独立验收批中可能达不到 3 个对象的最低覆盖门槛，报告中会明确标注未达标，不用训练集分数替代。
- 独立验收批与训练图来自同一采集批次（2026-10-13），不是全新来源；选图使用了模型预测与题干文本，代表覆盖而不是站点的自然分布。
- 颜色词表不含 black/purple，因为采集到的 550 张里没有这两类对象；题目文本也只出现红、黄、绿、蓝、灰五个颜色词，青色按蓝色处理。
