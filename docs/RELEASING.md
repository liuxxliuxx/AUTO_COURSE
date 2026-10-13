# 发布与验收

## 元数据与资源

版本、产品名、作者、许可证和项目地址来源于 `package.json`，安装包采用 `${productName}-${version}-mac-${arch}.dmg` / `${productName}-${version}-win-${arch}.exe`。
`appId` 保留 `com.autocourse.zhihuishu`。About 显示实际运行时版本、构建 commit 和 UTC 时间，未提交的工作区附加 `-dirty`。没有自动更新客户端；发布版本入口打开 Releases。

更改版本时同时更新 lockfile 根版本和 `packages[""].version`（可用 `npm version <版本> --no-git-tag-version`），然后构建并执行 `npm run release:check`。发布 tag 必须是 `v<package.json version>`。可先使用 `2.0.0-rc.1` 验收，正式版为 `2.0.0`；不要为尚未验证的平台声明已通过。

图标转换：`python3 scripts/build-icons.py`（需要 Pillow）。用户文档使用 Markdown 保存在 `docs/`，目录导航为 `docs/README.md`，使用指南为 `docs/user/README.md`。`package.json` 的 `documentation` 配置浏览器打开的仓库文档目录；当前指向代码所在的 `rewrite/electron` 分支，后续分支合并时同步更新该地址。无需生成 HTML 或将文档打进安装包。许可证汇总由 `npm run licenses` 生成，包含所有生产 Node 依赖的许可证正文；Electron/Chromium 原生 notices 由 Electron 运行时提供，sherpa-onnx WASM 随包分发，模型首次使用下载。

## 本地验证

```sh
npm ci
npx playwright-core install chromium
npm test
npm run check:native
npm run build
npm run release:check
```

使用 npm 12 安装依赖；`allowScripts` 禁止 better-sqlite3 被 npm 隐式编译，并允许 Electron、esbuild 和 Windows 安装器的安装脚本。旧版 npm 会忽略该策略，可能仍触发 `node-gyp rebuild`。

当前 better-sqlite3 13 自带 Node-API 预编译模块。`postinstall` 和 `npm run check:native` 分别在 Node、Electron 中执行内存数据库读写；首次检查会按 Electron 自身的安装逻辑下载运行时。打包设置 `npmRebuild: false`，避免 `@electron/rebuild` 因不识别该预编译格式而调用 C++ 工具链。不要再执行 `electron-builder install-app-deps`，这个显式命令不受 `npmRebuild` 控制。升级或新增原生依赖后，应重新检查预编译支持和两种运行环境。

各平台本机构建：Windows 用 `npm run build:win`，Apple Silicon / Intel Mac 先用 `npm run build`，再用 `npx electron-builder --mac --arm64 --publish never --config electron-builder.yml`。Mac 默认构建当前宿主架构；显式指定 `--arm64 --x64` 可构建两种架构。CI 分别在各架构宿主构建，避免原生模块跨架构污染。未新增 portable 发行目标。

打包验证示例：

```sh
node scripts/verify-package.mjs "release/mac-arm64/AUTO_COURSE.app/Contents/MacOS/AUTO_COURSE"
node scripts/verify-package.mjs "release/win-unpacked/AUTO_COURSE.exe"
```

该脚本使用独立临时用户数据目录并检查 SQLite、许可证资源、Browser Host 实际可驱动能力和退出结果，不访问线上课程或使用个人账号。真实登录与课程学习仍由人工验收。

## Workflow

`.github/workflows/release.yml` 在手动触发或 `v3.*` tag 时运行：Windows x64、macOS arm64/x64 分开安装、测试、验证 SQLite、构建和启动验证。手动触发仅保存候选安装包；tag 全部通过后汇总校验值并创建 **draft Release**，预发布 tag 标记 prerelease。不会自动公开发布，不会覆盖已公开版本。

本次改动只准备 workflow；推送、创建 tag、执行 GitHub CI 和公开 Release 均需在验收后进行。

## 人工验收

使用 `.github/RELEASE_TEMPLATE.md` 的检查表：三个平台安装与启动、SQLite、Browser Host、真实登录、三种课程、验证码、工作流冲突/停止/定时、转录、多账号进度与登录态隔离、v3 独立目录、旧数据保留以及备份恢复。Windows 验证安装/卸载时的数据保留，Mac 验证 DMG 拖动安装与系统打开提示。

在填完验收结果后生成说明 `npm run release:notes`，编辑实际变化与已知限制，再由维护者发布草稿。未签名、公证是当前构建策略，必须在 Release 明示。

GitHub 宿主架构参照 [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)，macOS 13 最低要求参照 [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)。

参考：[Electron app API](https://www.electronjs.org/docs/latest/api/app)、[electron-builder NSIS](https://www.electron.build/docs/nsis/)。
