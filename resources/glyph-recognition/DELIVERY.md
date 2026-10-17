# 流水线交付说明（检测 / 颜色 / 解析 / 匹配 / JS / 验收）

本文说明本轮补齐的六个部分、产物位置、实测指标，以及两个必须由人确认的环节。

## 交付位置

- 统一交付包：`release/glyph-recognition-v1/`（模型、权重、配置、JS、golden、evaluation、provenance、SHA256SUMS）。
- 训练与评估中间产物：`runs/glyph-pipeline-20261016/`。
- 验收批复核工作台：`reports/glyph-acceptance-review-20261016/index.html`。
- 颜色标签复核工作台：`runs/glyph-pipeline-20261016/colour-review/index.html`。
- 验收报告：`release/glyph-recognition-v1/evaluation/REPORT.md`。

## 1 对象检测

- 用最新冻结标注（550 张、3325 个对象）按 400/100/50 划分重训 YOLO11n 单类检测器，imgsz=480，30 轮，禁翻转/旋转/mosaic/HSV，seed 42。
- 导出 `models/detector.onnx`：opset 17、batch 1、固定 480×480、`nms=False`；解码、letterbox 还原与 NMS（conf 0.25、IoU 0.7、最多 300 框）由 Python 与 JS 各自实现，说明见 `configs/detector-decode.md`。
- 手写解码与 Ultralytics 预测路径在 25 张验证图上逐框对照：框数量不一致 0 张，最大坐标差 0.68 像素，最小匹配 IoU 0.953。
- 实测：验证集 precision/recall 100%/100%，mAP50 100%，mAP50-95 97.0%；测试集 mAP50 100%，mAP50-95 98.3%；小写 `i/j` 圆点对象召回 100%（验证 34 个、测试 14 个）。
- 类别说明：单类 `symbol` 只表示「这是一个对象」，身份与朝向由 ROI 分类器给出，避免把检测分数当成识别结果。

## 2 颜色识别

- 交付实现是 HSV 规则（`src/glyph_recognition/color.py`、`js/src/color.mjs`），不是神经网络。
- 前景为与图像边框背景 RGB 差 > 22 的像素，据此忽略背景与投影；饱和像素（S≥45、V≥30）不足时判 `gray`，据此忽略高光与阴影。
- 词表 `red/yellow/green/blue/gray`：青色与蓝色是同一个标签（色相 85-165 都算蓝），white 并入 gray；black/purple 在 550 张里没有对象，题目文本也只出现红黄绿蓝灰五个颜色词。
- 色相区间（OpenCV 8 位色相 0-179，直方图 181 格）：红 165-180 与 0-15，黄 15-45，绿 45-85，蓝 85-165。
- 「颜色一样」类题按同一标签判定（同标签即 1.0），标签不同时用圆均值色相给出低于阈值的渐降分数，阈值 0.7。
- 实测：合并青色后验证集检测框 99.01%、测试集 99.00%；550 张冻结标注上整体 99.28%（3301/3325），错误分散到 gray↔yellow 等少量个例。

## 3 题意解析

- 纯规则解析器，覆盖已采集的全部句式（550/550 零反例）：`请点击<槽位>` 与 `请点击<A><颜色|朝向>一样的<B>`（目标取 B）。
- 槽位 = `[颜色字](正向|侧向)?(大写|小写|数字)?(字符|形体词)`；大小写与数字作为校验条件，矛盾时返回 `ambiguous_instruction`。
- 输出结构见 `configs/semantic-query.schema.json`，与需求示例一致，例如 target.identity=e、reference.identity=F、match_attributes=[orientation]；形体写作 `shape:cylinder`。
- 校验规则：字符合法集、形体词表、属性名、条件完整性；缺属性名、无法匹配模板分别返回 `ambiguous_instruction`、`unsupported_instruction`。

## 4 属性匹配与坐标

- 顺序：解析 → 参考对象唯一性 → 目标筛选 → 按 `match_attributes` 比较（朝向取分类器结果，形体按 front-only 约定；颜色取色相相似度）→ 唯一性判定。
- 只有在约束筛出唯一候选时才输出 `targetId` 与坐标；参考缺失/不唯一、目标缺失/不唯一、分数不足分别返回明确原因。
- 阈值在验证集上扫描后冻结，偏向给出答案：颜色相似度 0.7 时覆盖与准确率同时最优（见报告中的扫描表）。
- 坐标：目标点取检测框中心；页面换算 `cssX = rect.x + x × rect.width / naturalWidth`（Y 同理）。
- 实测（冻结标签、检测框）：验证集 100/100、测试集 50/50，零错答、零拒识，坐标落在目标框内比例 100%。

## 5 JavaScript 推理

- `js/` 下提供 `onnxruntime-node` 推理、解码、ROI 预处理、颜色、规则解析与匹配；依赖锁定在 `package.json` + `package-lock.json`，图片解码用纯 JS 的 `jpeg-js`/`pngjs`。
- ROI 预处理完整复刻交付 ResNet 的灰度、1%/99% 分位拉伸、等比例缩放与边界中位数填充；与交付的 PIL/Lanczos 实现在 251 个对象上 top-1 一致率 100%、张量平均绝对差 8.9e-8。
- Python 与 Node 一致性（`evaluation/runtime-parity.json`）：同一像素输入下 letterbox 画布与 ROI 张量逐位一致；走 JPEG 解码时框坐标差 ≤0.5 像素、置信度差 ≤0.002，身份/朝向/颜色标签、解析结果与匹配状态完全一致，8/8 用例通过。
- 性能（Apple M5、CPU、4 线程）：Python 加载 99 ms、单图 p50 28.9 ms / p95 32.6 ms；Node 加载 46 ms、单图 p50 38 ms / p95 56 ms。模型体积 10.6 MB + 44.9 MB。

## 6 验收资料

- 训练源码、模型构建与加载代码：`source/`（检测器数据集构建、训练与导出、ROI 分类器训练、评估与报告脚本、流水线模块）。
- 数据划分清单与哈希：`configs/split.json`、`configs/detector-dataset.json`、`provenance/provenance.json`。
- 逐类指标与混淆矩阵：`evaluation/per-class-*.csv`、`evaluation/confusion-matrices/`。
- 错误样本：`evaluation/errors/`（属性错误裁片与索引）。
- 未覆盖 16 类覆盖表：报告按「联合类别」给出支持数与准确率，未达 3 个对象的类别明写未达标。
- 独立验收批：140 张、848 个对象。身份与朝向按 66 类分组人工复核（1 处更正 H→L），实测身份 99.88%、朝向 100%；颜色经人工抽查更正 2 处后为 99.76%；边界框由用户确认为全部正常（848 个，0 个异常，0 个漏检）。链路 140/140 正确、0 拒识、0 错答。检测框标签仍来自检测器本身，检测 precision/recall 不是独立检测精度，独立检测证据用固定 50 张测试集。
- 16 类补测：12 个字符类 6～12 个对象（达标）；4 个形体类 1～2 个对象，未达每类 3 个的门槛，已在报告中明写。

## 复核与验收状态

颜色标签已经按你的要求把青色并入蓝色（`scripts/normalise_glyph_colours.py`，346 个 cyan→blue、4 个 white→gray，patch 与审计在 `annotations/review-patches/` 与 `annotations/human-reviews/`），因此原来那 19 张颜色冲突全部消失，不再需要颜色复核。

- 验收批的对象分类复核已完成：导出记录归档在 `annotations/human-reviews/20261017T020329-glyph-acceptance-class-review/`，标注在 `annotations/human-reviewed-additions/20261017T020305-glyph-acceptance-class-review-test-only.jsonl`，只作测试、不进入训练。
- 若要把验收批的检测召回与颜色精度也做成独立口径，还需要两个小复核：补/删检测框（逐图工作台 `reports/glyph-acceptance-review-20261016/index.html`）与逐对象颜色确认。当前报告已明确标注这两项为自洽数字。

## 已知限制

- 独立验收批与训练图来自同一采集批次（2026-10-13），不是全新来源；选图使用模型预测与题干文本，代表覆盖而不是站点自然分布。
- 验证集与固定测试集都曾参与历史评估与选模，不是外部盲测；形体类的二级补测在报告中单独标注。
- 颜色标签从未逐图人工复核；本轮把青色并入蓝色、白色并入灰色，题干与标签的自洽率从 531/550 升到 549/550。
- 剩余 1 张（worker-06-070）是身份大小写不一致：题干说「大写 V」，标注里只有小写 v；属于身份标签问题而不是颜色，未擅自改动。
- ResNet-18 与 JS 参考重采样存在极小的重采样差异（张量最大 0.039、平均 8.9e-8），已用 251 个对象的 top-1 一致率 100% 验证，但不等于逐位相同。

