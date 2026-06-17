import os
import sys
<<<<<<< HEAD
=======

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a

from setuptools import setup

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

APP = ["main.py"]
OPTIONS = {
    "argv_emulation": False,
    "iconfile": "assets/icon.icns",
<<<<<<< HEAD
    "packages": [
        "certifi",
        "keyring",
        "numpy",
        "PIL",
        "PySide6",
        "requests",
        "selenium",
        "sounddevice",
        "webdriver_manager",
        "gui",
        "src",
    ],
    "includes": [
        "config",
        "database",
        "gui.app",
        "gui.bridge",
        "src.bot",
        "src.bot.bot_core",
        "src.bot.browser",
        "src.bot.captcha",
        "src.bot.course",
        "src.bot.login",
        "src.bot.login.base",
        "src.bot.login.upc",
        "src.bot.login.zhihuishu",
        "src.bot.quiz",
        "src.bot.video",
        "src.constants",
        "src.transcriber",
        "src.transcriber.audio_capture",
        "src.transcriber.transcription_manager",
        "src.transcriber.transcription_worker",
        "src.ui",
        "src.ui.log_handler",
        "src.utils",
        "src.utils.element_finder",
    ],
    "resources": [
        "assets/icon.png",
        "gui/qml",
=======
    "packages": ["selenium", "webdriver_manager", "keyring", "certifi"],
    "includes": [
        "src", "src.constants", "src.db", "src.bot", "src.bot.login",
        "src.ui", "src.utils",
        "config", "database",
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
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
