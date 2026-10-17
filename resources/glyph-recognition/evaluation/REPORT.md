# 验证码离线识别流水线验收报告

本报告由 `scripts/report_glyph_pipeline.py` 依据冻结的评估 JSON 生成，所有数值都是实测值。

## 数据与协议

- 训练/验证/测试：400/100/50 张，对象 2417/608/300，划分哈希见 `provenance/provenance.json`。
- 检测器：YOLO11n 单类 `symbol`，imgsz=480，ONNX opset 17，`nms=False`，conf=0.25，IoU=0.7；解码与 NMS 由 Python 与 JS 各自实现。
- ROI 分类器：交付的 129 类 ResNet-18（灰度、1/99 分位拉伸、保比例缩放、填充），本次未重训。
- 颜色：HSV 规则，词表 red/yellow/green/blue/gray，青色与蓝色是同一个标签（色相 85-165 都是蓝），white 并入 gray；black/purple 在数据中不存在。

## val 检测质量

| 指标 | 值 |
| --- | ---: |
| 图像数 | 100 |
| 标注对象 | 608 |
| 预测框 | 608 |
| 匹配（IoU≥0.5） | 608 |
| 漏检 | 0 |
| 多余框 | 0 |
| precision | 100.00% |
| recall | 100.00% |
| 整图对象检全率 | 100/100（100.00%） |
| i/j 圆点对象召回 | 100.00%（34 个） |
| 单图检测耗时 | 10.5 ms |

mAP50 = 100.00%，mAP50-95 = 97.00%。

### 标注框属性

| 属性 | 支持 | 正确 | 准确率 | 逐类宏平均 |
| --- | ---: | ---: | ---: | ---: |
| identity | 608 | 608 | 100.00% | 100.00% |
| orientation | 608 | 608 | 100.00% | 100.00% |
| color | 608 | 603 | 99.18% | 99.23% |
| joint | 608 | 608 | 100.00% | 100.00% |

### 检测框属性

| 属性 | 支持 | 正确 | 准确率 | 逐类宏平均 |
| --- | ---: | ---: | ---: | ---: |
| identity | 608 | 608 | 100.00% | 100.00% |
| orientation | 608 | 608 | 100.00% | 100.00% |
| color | 608 | 602 | 99.01% | 99.07% |
| joint | 608 | 608 | 100.00% | 100.00% |

## val 完整链路

| 指标 | 值 |
| --- | ---: |
| 图像数 | 100 |
| 目标选择正确 | 100 |
| 目标选择错误 | 0 |
| 拒识 | 0 |
| 解析失败 | 0 |
| 总体准确率 | 100.00% |
| 接受样本准确率 | 100.00% |
| 覆盖率 | 100.00% |
| 拒识率 | 0.00% |
| 坐标落在目标框内 | 100.00% |
| 拒识原因 | {} |

## val 未覆盖 16 类

| 未覆盖联合类别 | 支持数 | 联合准确率 | 是否达标 |
| --- | ---: | ---: | --- |
| C|front | 1 | 100.00% | 未达标 |
| P|side | 5 | 100.00% | 达标 |
| U|front | 5 | 100.00% | 达标 |
| Y|side | 4 | 100.00% | 达标 |
| a|front | 4 | 100.00% | 达标 |
| e|side | 9 | 100.00% | 达标 |
| l|front | 11 | 100.00% | 达标 |
| o|front | 3 | 100.00% | 达标 |
| w|front | 5 | 100.00% | 达标 |
| w|side | 5 | 100.00% | 达标 |
| y|front | 5 | 100.00% | 达标 |
| 9|side | 7 | 100.00% | 达标 |
| shape:cube|side | 1 | 100.00% | 未达标 |
| shape:cylinder|front | 1 | 100.00% | 未达标 |
| shape:cone|front | 2 | 100.00% | 未达标 |
| shape:sphere|front | 3 | 100.00% | 达标 |

未达标的联合类别在验证集与验收批上的支持数会单独列出；验证集曾用于模型选轮次，因此只作为二级参考，不是独立测试，独立结论以验收批为准。

## test 检测质量

| 指标 | 值 |
| --- | ---: |
| 图像数 | 50 |
| 标注对象 | 300 |
| 预测框 | 300 |
| 匹配（IoU≥0.5） | 300 |
| 漏检 | 0 |
| 多余框 | 0 |
| precision | 100.00% |
| recall | 100.00% |
| 整图对象检全率 | 50/50（100.00%） |
| i/j 圆点对象召回 | 100.00%（14 个） |
| 单图检测耗时 | 11.0 ms |

mAP50 = 100.00%，mAP50-95 = 98.28%。

### 标注框属性

| 属性 | 支持 | 正确 | 准确率 | 逐类宏平均 |
| --- | ---: | ---: | ---: | ---: |
| identity | 300 | 299 | 99.67% | 99.68% |
| orientation | 300 | 300 | 100.00% | 100.00% |
| color | 300 | 297 | 99.00% | 99.05% |
| joint | 300 | 299 | 99.67% | 99.56% |

### 检测框属性

| 属性 | 支持 | 正确 | 准确率 | 逐类宏平均 |
| --- | ---: | ---: | ---: | ---: |
| identity | 300 | 300 | 100.00% | 100.00% |
| orientation | 300 | 300 | 100.00% | 100.00% |
| color | 300 | 297 | 99.00% | 99.05% |
| joint | 300 | 300 | 100.00% | 100.00% |

## test 完整链路

| 指标 | 值 |
| --- | ---: |
| 图像数 | 50 |
| 目标选择正确 | 50 |
| 目标选择错误 | 0 |
| 拒识 | 0 |
| 解析失败 | 0 |
| 总体准确率 | 100.00% |
| 接受样本准确率 | 100.00% |
| 覆盖率 | 100.00% |
| 拒识率 | 0.00% |
| 坐标落在目标框内 | 100.00% |
| 拒识原因 | {} |

## test 未覆盖 16 类

| 未覆盖联合类别 | 支持数 | 联合准确率 | 是否达标 |
| --- | ---: | ---: | --- |
| C|front | 0 | — | 未达标 |
| P|side | 0 | — | 未达标 |
| U|front | 0 | — | 未达标 |
| Y|side | 0 | — | 未达标 |
| a|front | 0 | — | 未达标 |
| e|side | 0 | — | 未达标 |
| l|front | 0 | — | 未达标 |
| o|front | 0 | — | 未达标 |
| w|front | 0 | — | 未达标 |
| w|side | 0 | — | 未达标 |
| y|front | 0 | — | 未达标 |
| 9|side | 0 | — | 未达标 |
| shape:cube|side | 0 | — | 未达标 |
| shape:cylinder|front | 0 | — | 未达标 |
| shape:cone|front | 0 | — | 未达标 |
| shape:sphere|front | 0 | — | 未达标 |

未达标的联合类别在验证集与验收批上的支持数会单独列出；验证集曾用于模型选轮次，因此只作为二级参考，不是独立测试，独立结论以验收批为准。

## 颜色相似度阈值扫描（验证集）

| 阈值 | 总体准确率 | 接受样本准确率 | 覆盖率 | 拒识率 |
| ---: | ---: | ---: | ---: | ---: |
| 0.1 | 96.00% | 100.00% | 96.00% | 4.00% |
| 0.2 | 97.00% | 100.00% | 97.00% | 3.00% |
| 0.3 | 97.00% | 100.00% | 97.00% | 3.00% |
| 0.4 | 98.00% | 100.00% | 98.00% | 2.00% |
| 0.5 | 99.00% | 100.00% | 99.00% | 1.00% |
| 0.6 | 100.00% | 100.00% | 100.00% | 0.00% |
| 0.7 | 100.00% | 100.00% | 100.00% | 0.00% |
| 0.8 | 99.00% | 100.00% | 99.00% | 1.00% |
| 0.9 | 99.00% | 100.00% | 99.00% | 1.00% |

## 独立验收批（仅作测试，未参与训练）

口径：身份与朝向经人工按类复核（848 个对象，1 处更正 H→L）；颜色经人工抽查并更正 2 处；边界框由用户确认为全部正常（未逐个点击）。
检测框标签仍来自检测器本身，所以 detection precision/recall 不是独立检测精度，独立检测证据用固定 50 张测试集；颜色准确率按更正后的标签计算。

- 图像 140 张；检测 precision 100.00%、recall 100.00%、整图检全率 100.00%。
- 目标选择：正确 140、错误 0、拒识 0；总体准确率 100.00%，接受样本准确率 100.00%，拒识率 0.00%。
- 坐标落在目标框内：100.00%。

- 属性（检测框）：身份 99.88%、朝向 100.00%、颜色 99.76%。

| 图 / 对象 | 属性 | 标注 | 预测 |
| --- | --- | --- | --- |
| worker-06-057 / o6 | identity | L | H |
| worker-07-034 / o7 | color | yellow | red |
| worker-10-010 / o3 | color | gray | green |

### 验收批未覆盖 16 类

| 未覆盖联合类别 | 支持数 | 联合准确率 | 是否达标 |
| --- | ---: | ---: | --- |
| C|front | 10 | 100.00% | 达标 |
| P|side | 12 | 100.00% | 达标 |
| U|front | 7 | 100.00% | 达标 |
| Y|side | 6 | 100.00% | 达标 |
| a|front | 9 | 100.00% | 达标 |
| e|side | 7 | 100.00% | 达标 |
| l|front | 8 | 100.00% | 达标 |
| o|front | 9 | 100.00% | 达标 |
| w|front | 8 | 100.00% | 达标 |
| w|side | 8 | 100.00% | 达标 |
| y|front | 7 | 100.00% | 达标 |
| 9|side | 7 | 100.00% | 达标 |
| shape:cube|side | 2 | 100.00% | 未达标 |
| shape:cylinder|front | 1 | 100.00% | 未达标 |
| shape:cone|front | 1 | 100.00% | 未达标 |
| shape:sphere|front | 1 | 100.00% | 未达标 |

### 人工审计（颜色与边界框）

- 颜色：人工检查发现 2 处标错（worker-07-034/o7→yellow、worker-10-010/o3→gray）；按更正后的标签重算，规则颜色准确率为 99.76%。
- 边界框：848 个对象，标为有问题的 0 个，漏检 0 个（用户声明：边界都没问题）；审计口径下框正常率 100.00%、召回下限 100.00%。

## Python 与 Node.js 推理一致性

- 用例 8 个，失败 0 个，结果 通过。
- 逐用例的画布校验和、检测框数与最大坐标差、身份/朝向/颜色标签、解析与匹配状态见 `runtime-parity.json`。

## 参考重采样与交付 PIL 流程的等价性

- 对象 251 个；张量最大绝对差 0.0392，平均绝对差 8.88e-08。
- top-1 一致率 100.00%；参考实现与交付实现在标注框上的准确率分别为 100.00%、100.00%。

## 手写解码与 Ultralytics 预测路径的对照

- 25 张验证图：框数量不一致 0 张，最大坐标差 0.68 像素，最小匹配 IoU 0.953，最大置信度差 0.0197。
- Hand-written decode/NMS on the exported ONNX versus Ultralytics predict on best.pt, same imgsz/conf/iou. Ultralytics solves the same detection with a slightly different letterbox/box-restore path, so coordinates differ by a fraction of a pixel.

## 性能（Apple M5，CPU float32，4 线程）

| 端 | 图像数 | 模型加载 | 单图 p50 | 单图 p95 | 图片解码 p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Python ONNX Runtime | 100 | 99 ms | 28.9 ms | 32.6 ms | 0.52 ms |
| Node.js onnxruntime-node | 100 | 46 ms | 38 ms | 56 ms | 2 ms |

模型体积：detector.onnx 10.6 MB，roi-classifier/model.onnx 44.9 MB。

## 颜色标签一致性

- 冻结 550 张中，题干与标签唯一自洽 549 张，冲突 1 张，明细见 `colour-review.json`。

## 验收批选图

- 选中 140 张：{"题干提到形体": 4, "补 C|front,P|side,w|front": 1, "补 C|front,shape:cone|front": 1, "补 shape:cube|side,y|front": 1, "补 P|side,y|front": 1, "补 e|side,w|side": 1, "补 a|front,w|front": 1, "补 o|front,y|front": 1, "补 l|front,w|side": 1, "补 Y|side,a|front": 1, "补 Y|side,l|front": 1, "补 9|side,w|front": 1, "补 9|side,o|front": 1, "补 9|side,Y|side": 1, "补 l|front,o|front": 1, "补 shape:sphere|front": 1, "补 shape:cylinder|front": 1, "补 shape:cube|side": 1, "补 a|front": 1, "补 U|front": 3, "保留池均匀抽查": 27, "颜色/句式/i-j 覆盖补充": 88}。
- 选图前模型预测覆盖：{"C|front": 3, "P|side": 3, "U|front": 3, "Y|side": 3, "a|front": 3, "e|side": 3, "l|front": 3, "o|front": 3, "w|front": 3, "w|side": 3, "y|front": 3, "9|side": 3, "shape:cube|side": 2, "shape:cylinder|front": 1, "shape:cone|front": 1, "shape:sphere|front": 1}；低于 3 个对象的类别：["shape:cube|side", "shape:cylinder|front", "shape:cone|front", "shape:sphere|front"]。
- 限制：Selected with model predictions and instruction text, not a uniform random sample of the site distribution.

## 错误样本

- 已导出 12 个属性错误裁片到 `evaluation/errors/`，索引见 `errors/index.json`。

## 复现

```sh
.venv/bin/python scripts/build_glyph_detector.py
.venv/bin/python scripts/train_glyph_detector.py
.venv/bin/python scripts/evaluate_glyph_pipeline.py --splits val test
.venv/bin/python scripts/evaluate_glyph_pipeline.py --splits acceptance --acceptance <acceptance.annotations.jsonl>
.venv/bin/python scripts/build_glyph_golden.py
cd release/glyph-recognition-v1/js && npm ci && npm run parity
.venv/bin/python scripts/report_glyph_pipeline.py
```

