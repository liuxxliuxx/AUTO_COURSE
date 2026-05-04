import glob
import os
import shutil
import sys
from subprocess import check_output

from setuptools import setup

APP = ["main.py"]
OPTIONS = {
    "argv_emulation": False,
    "packages": ["selenium", "webdriver_manager", "keyring", "certifi"],
    "plist": {
        "CFBundleName": "智慧树自动刷课",
        "CFBundleDisplayName": "智慧树自动刷课",
        "CFBundleIdentifier": "com.zhihuishu.autocourse",
        "CFBundleVersion": "1",
        "CFBundleShortVersionString": "1.0.0",
    },
}

setup(
    app=APP,
    name="智慧树自动刷课",
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
