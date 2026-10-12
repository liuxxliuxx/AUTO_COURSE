# 项目信息

- 产品：AUTO_COURSE 2.0，课程学习与工作流桌面客户端。
- v1 共同开发者：liuxxliuxx、InvalidNamee。
- v2 主要维护者：InvalidNamee。
- 其他贡献者：以 Git 提交记录与 GitHub Contributors 为准。
- 许可证：[MIT](../LICENSE)，Copyright © 2026 liuxxliuxx and InvalidNamee。
- 主页 / 源码：https://github.com/liuxxliuxx/AUTO_COURSE
- 反馈：https://github.com/liuxxliuxx/AUTO_COURSE/issues
- 下载：https://github.com/liuxxliuxx/AUTO_COURSE/releases
- 用户文档：[安装与使用指南](user/README.md)（Markdown 文档保存在仓库中，应用入口在浏览器中打开仓库文档目录）。

v1 使用 PySide6 / Selenium；v2 使用 Electron / Vue 3 / TypeScript / Playwright。
保留应用 ID `com.autocourse.zhihuishu`，维护已有安装和系统身份。
第三方依赖保持各自许可证；构建时生成 `THIRD_PARTY_NOTICES.txt`，Electron 自带的许可证与 Chromium notices 随运行时保留。
转录内置 sherpa-onnx JavaScript/WASM 运行库，无需 Python；模型首次使用下载缓存，ffmpeg 仍需单独安装。
