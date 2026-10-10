# {{productName}} {{version}}

Electron + Vue 3 + TypeScript + Playwright 的 v2 桌面版本，支持课程库、工作流与进度持久化。

## 下载

| 平台 | 文件 |
| --- | --- |
| Windows x64 安装包 | `{{productName}}-{{version}}-win-x64.exe` |
| macOS Apple Silicon | `{{productName}}-{{version}}-mac-arm64.dmg` |
| macOS Intel | `{{productName}}-{{version}}-mac-x64.dmg` |

使用 `SHA256SUMS.txt` 核对完整性。当前应用未签名或公证，没有自动更新；转录需额外安装 Python、ffmpeg 与模型依赖。

## 升级说明

先退出应用并备份数据。v1 数据仅在 v2 数据库为空时只读导入，不覆盖已有数据；旧密码需重新填写。旧 v2 数据目录继续复用。详细步骤见仓库中的用户指南。

## 本次变化

- 应用名称、版本、开发者信息和图标统一。
- 新增关于与帮助、仓库 Markdown 文档入口和运行环境诊断信息。
- 更新安装、使用、迁移、FAQ 与故障排除文档。

发布前由维护者补充功能变化和修复记录。

## 平台验收（发布前填写）

- [ ] Windows x64：安装、启动、SQLite、Browser Host、卸载与数据保留。
- [ ] macOS arm64：DMG、启动、SQLite、Browser Host 与人工登录。
- [ ] macOS x64：DMG、启动、SQLite、Browser Host 与人工登录。
- [ ] 全新安装、已有 v2 升级、v1 只读导入、备份恢复。
- [ ] 三种课程、人工验证码、工作流停止/冲突/定时、可选转录。

勾选项只表示实际验证，不以 CI 打包成功代替真实平台验收。

## 开发者与许可

v1 由 liuxxliuxx 与 InvalidNamee 共同开发，v2 主要由 InvalidNamee 维护。项目采用 MIT；第三方依赖保持各自许可证。
