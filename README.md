# AUTO_COURSE 3.0

面向 Windows x64 和 macOS 13 及以上 的智慧树课程学习与工作流客户端。支持传统课程、知识图谱课程与掌握度课程，保存课程进度、处理弹题，并在登录或验证码需要人工处理时提示你接管课程窗口。

[下载发布版本](https://github.com/liuxxliuxx/AUTO_COURSE/releases) · [用户指南](docs/user/README.md) · [反馈问题](https://github.com/liuxxliuxx/AUTO_COURSE/issues)

## 安装与上手

- Windows x64：下载 `AUTO_COURSE-<版本>-win-x64.exe`，按安装向导完成安装。
- Apple Silicon：下载 `AUTO_COURSE-<版本>-mac-arm64.dmg`；Intel Mac：选择 `mac-x64.dmg`。打开磁盘镜像，将 AUTO_COURSE 拖入 Applications。
- 当前构建未签名或公证；下载时核对仓库与 SHA256 校验值。macOS 的具体打开步骤见安装指南。
- 普通课程学习无需安装 Node、Python、Chrome 或 ChromeDriver。转录功能另需 ffmpeg；SenseVoiceSmall 通过内置 JavaScript/WASM 运行，首次使用自动下载模型，无需 Python。

打开应用，在「账号」页添加账号并选择登录方式，再在「课程」页添加学习页地址和课程名称。选中课程点击「构建工作流」，为每一步选择账号并保存，然后立即运行或设置定时。在「运行」页查看进度，按提示处理登录或验证码后继续。

## 功能与边界

- 支持多个账号；每个工作流步骤绑定账号和课程，独立保存运行配置，续学进度按账号与课程组合共享。课程默认配置只影响之后添加的课程。
- 工作流按顺序执行课程，支持立即运行、单次定时、每日定时；不同账号可并行，工作流启动时占用涉及的全部账号，账号冲突时拒绝后启动的任务。
- 定时检查依赖应用保持运行，不会在关机后唤醒电脑。
- 掌握度题库持久化，支持导出 JSON；转录支持范围见用户指南。
- 三种登录方式独立：智慧树、机构 SSO、旧门户；失败后不会自动切换。
- 登录、学习时长和平台页面变化可能需要人工处理。真实网站功能仍需发布前人工验收。

## 文档

- [安装、快速上手、FAQ、故障排除与迁移](docs/user/README.md)
- [文档目录](docs/README.md)（应用「关于与帮助 → 打开用户文档」在浏览器中打开 GitHub 仓库的 docs 目录）
- [开发者与许可证](docs/PROJECT.md)
- [发布与验收](docs/RELEASING.md)
- [技术迁移记录](docs/MIGRATION.md)、[界面契约](docs/INTERACTION.md)、[自动化方案验证](docs/PLAYWRIGHT_POC.md)

## 开发与打包

使用 Node 24 LTS（≥ 24.15.0）和 npm 12；使用本机对应平台构建。SQLite 自带预编译模块，Windows x64 开发环境无需为它安装 Visual Studio C++ 工具链。

```sh
npm ci
npm run dev
npm run build
npm run release:check
npm run build:mac
npm run build:win
```

`package.json` 是版本与产品名的来源。构建写入 Git commit 和时间；安装包输出到 `release/`。
安装结束会检查 Node、Electron 的 SQLite 读写，也可运行 `npm run check:native` 单独检查。DOM 测试需 `npx playwright-core install chromium`。

## 数据与升级

v3 使用独立的 `auto-course-v3` 用户数据目录，所有设置恢复默认，不自动导入旧账号、课程、工作流、进度、模型或登录态。旧目录及已有输出文件原样保留。首次启动说明可打开旧数据目录；「关于与帮助 → 打开数据目录」显示新版实际位置。

数据库为 `auto_course.db`，密码按账号加密保存在 `account-credentials/<accountId>.bin`，登录态保存在 `account-profiles/<accountId>/`。转录输出按账号与课程隔离。升级与备份方法见[用户指南](docs/user/README.md)。

## 开发者与许可

v1：liuxxliuxx 与 InvalidNamee 共同开发。v2：主要由 InvalidNamee 维护，感谢所有贡献者。项目采用 [MIT License](LICENSE)；第三方许可证可在应用中查看。

支持范围：Windows x64、macOS arm64/x64。Windows 与 Intel Mac 的真实打包启动验收以 Release 验收表为准，构建成功不等于平台验收完成。
