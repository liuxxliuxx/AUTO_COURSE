# 这里为什么还有一坨 Python 代码

仓库里同时存在两套实现：

```
src/  gui/  main.py  database.py  config.py
scripts/build_win.ps1  scripts/build_mac.sh  scripts/setup_mac.py
requirements.txt
        ↑
        v1：PySide6 + QML + Selenium。**不是 v2 的运行链路**，仅作行为对照。

package.json  src/main/  src/preload/  src/renderer/  python/transcriber/
        ↑
        v2：Electron + Vue 3 + TypeScript + Playwright。**当前唯一入口**。
```

运行 v2 用 `npm run dev` / `npm start`。
`python main.py` 启动的是 v1，需要 v1 的 Python 依赖，与 v2 互不影响。

---

## 为什么不直接删掉

`docs/v2_handoff.md` §24 规定：

> 重构初期应同时存在 new Electron implementation + legacy Python implementation
> ……只有对应模块在 v2 中通过验证后才能删除旧实现。

§25 Phase 9 进一步要求「**仅当所有核心功能通过后**删除」。

v2 目前的验证状态（详见 `docs/MIGRATION.md` §5）：

- ✅ 自动化测试覆盖：单元 169 项 + DOM 夹具 + 端到端（假 Python worker）+ 打包产物验证
- ⚠️ **未经真实账号验证**：智慧树登录、数字石大 SSO、真实课程页面的完整刷课流程
- ⚠️ **未经真实模型验证**：SenseVoice 实际推理（协议层已用假 worker 验证）
- ⚠️ **未经真实 Windows 验证**：打包配置就绪但未在 Windows 上实测

真实站点与真实账号的验证无法自动化（需要账号密码，且不应写进仓库），
因此这一步必须由人来做。

---

## 删除的条件与步骤

先在有真实账号的机器上完成 `docs/MIGRATION.md` §5 表格里所有 ⚠️ 项，
确认 v2 功能追平后，按 handoff §31 的建议分两个提交删除：

```bash
# 1. 移除 Selenium 浏览器后端
git rm -r src/ config.py database.py main.py main_tkinter.py.bak
git rm scripts/download_chrome.py scripts/fix_ps1_encoding.py
git commit -m "refactor: remove selenium browser backend"

# 2. 移除 PySide6 / QML 应用
git rm -r gui/ scripts/setup_mac.py scripts/build_mac.sh \
          scripts/build_win.ps1 scripts/create_installer.ps1 scripts/generate_nsi.py
git rm requirements.txt
git commit -m "refactor: remove pyside and qml application"
```

**保留**：`python/transcriber/`（SenseVoice worker，v2 唯一保留的 Python runtime）。

---

## v1 怎么跑

v1 实现冻结在 tag `v1-pyside-final`（= `dev_beta` @ `ecde984`）。需要对照行为时：

```bash
git worktree add /tmp/v1 v1-pyside-final
cd /tmp/v1
pip install -r requirements.txt
python main.py
```

v1 的 keyring 凭据与数据库都没有被 v2 改动，随时可以退回去用。
