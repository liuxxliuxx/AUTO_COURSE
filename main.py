"""
智慧树自动刷课 GUI 入口 (PySide6)。

所有 GUI 代码在 gui/ 包中，此文件仅为薄启动器。
"""

import sys
from gui.app import run_app

if __name__ == "__main__":
    sys.exit(run_app())
