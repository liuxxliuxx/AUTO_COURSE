# 第三方组件与来源

## 训练与导出（Python）

- PyTorch 2.14.1 与 torchvision 0.29.1（BSD-3-Clause）：ResNet-18 实现与训练。
- Ultralytics 8.4.176（AGPL-3.0）：YOLO11n 训练与 ONNX 导出。导出与训练脚本随项目保留，接收端只使用 ONNX，不链接 Ultralytics 代码。
- ONNX 1.23.2 与 ONNX Runtime 1.31.0（MIT）：模型导出与推理。
- NumPy 2.5.4、Pillow 12.3.0、scikit-learn 1.9.1、OpenCV 4.14.0.94：数值、图像与指标计算。
- 基础权重：`yolo11n.pt`（Ultralytics COCO 预训练）与 torchvision ImageNet 权重。

## 推理（Node.js）

- `onnxruntime-node` 1.23.2（MIT）：CPU float32 推理。
- `jpeg-js` 0.4.4（Apache-2.0）、`pngjs` 7.0.0（MIT）：纯 JS 图片解码，避免 native 依赖。

## 数据

- 题图来自公开页面 https://www.zhihuishu.com 在 2026-10-13 的一次正常 SDK 初始化采集，共 1000 张，未调用识别模型、未提交答案、未保存 Cookie 或凭据。
- 标注由模型草稿加人工复核产生；身份与朝向经用户整体确认，颜色标签为模型草稿并对与题干冲突的 19 张做了人工更正。
