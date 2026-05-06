import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from setuptools import setup

APP = ["main.py"]
OPTIONS = {
    "argv_emulation": False,
    "packages": ["selenium", "webdriver_manager", "keyring", "certifi"],
    "includes": [
        "src", "src.constants", "src.db", "src.bot", "src.bot.login",
        "src.ui", "src.utils",
        "config", "database",
    ],
    "plist": {
        "CFBundleName": "ZhiHuiShu_AutoCourse",
        "CFBundleDisplayName": "智慧树自动刷课",
        "CFBundleIdentifier": "com.zhihuishu.autocourse",
        "CFBundleVersion": "1",
        "CFBundleShortVersionString": "1.0.0",
    },
}

setup(
    app=APP,
    name="ZhiHuiShu_AutoCourse",
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
