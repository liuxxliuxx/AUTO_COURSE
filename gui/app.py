"""
应用程序入口 —— QQmlApplicationEngine + QML 前端。

conda-forge PySide6 兼容性：自动设置 Qt 插件路径。
"""

import os
import sys

# ── Qt env: must be set before importing PySide6 ──
conda_prefix = os.environ.get("CONDA_PREFIX", "")
if conda_prefix:
    qt_plugin_dir = os.path.join(conda_prefix, "Library", "lib", "qt6", "plugins")
    if os.path.isdir(qt_plugin_dir):
        os.environ.setdefault("QT_PLUGIN_PATH", qt_plugin_dir)
        os.environ.setdefault("QT_QPA_PLATFORM_PLUGIN_PATH",
                              os.path.join(qt_plugin_dir, "platforms"))
    qt_bin = os.path.join(conda_prefix, "Library", "bin")
    if os.path.isdir(qt_bin):
        os.environ["PATH"] = qt_bin + os.pathsep + os.environ.get("PATH", "")

from PySide6.QtCore import QUrl
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtWidgets import QApplication

from gui.bridge import ThreadBridge


def _resolve_qml_dir():
    candidates = [
        os.path.join(os.path.dirname(__file__), "qml"),
    ]
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        candidates.append(os.path.join(sys._MEIPASS, "gui", "qml"))
    resource_path = os.environ.get("RESOURCEPATH")
    if resource_path:
        candidates.append(os.path.join(resource_path, "gui", "qml"))

    for candidate in candidates:
        if os.path.exists(os.path.join(candidate, "main.qml")):
            return candidate
    return candidates[0]


def run_app() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("智慧树自动刷课")

    # Bridge (exposed to QML as "bridge")
    bridge = ThreadBridge()

    # QML engine
    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("bridge", bridge)

    qml_dir = _resolve_qml_dir()
    main_qml = os.path.join(qml_dir, "main.qml")
    engine.load(QUrl.fromLocalFile(main_qml))

    if not engine.rootObjects():
        sys.exit(1)

    return app.exec()
