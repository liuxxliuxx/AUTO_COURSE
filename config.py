"""
应用配置模块。

负责：
- 跨平台数据目录解析（DB 路径）
- Keyring 服务名与 key 名常量
- 其他全局配置项集中管理
"""

import os
import sys

# ============================================================================
# Keyring 配置（用于安全存储账号密码）
# ============================================================================

KEYRING_SERVICE = "zhihuishu_auto_course"
KEYRING_USERNAME_KEY = "zhanghao"
KEYRING_PASSWORD_KEY = "mima"

# ============================================================================
# 数据库路径（平台自适应）
# ============================================================================


def _get_db_path():
    """根据操作系统返回用户数据目录下的数据库路径。"""
    if sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.environ.get(
            "XDG_DATA_HOME",
            os.path.join(os.path.expanduser("~"), ".local", "share"),
        )
    path = os.path.join(base, "zhihuishu_auto_course")
    os.makedirs(path, exist_ok=True)
    return os.path.join(path, "course_progress.db")


DB_PATH = _get_db_path()
