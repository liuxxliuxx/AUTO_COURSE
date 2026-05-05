"""
浏览器工厂模块 —— 负责创建配置好反检测参数的 Chrome WebDriver 实例。

Chrome 选择策略（按优先级）：
1. 项目 bin/ 目录中的捆绑 Chrome for Testing + ChromeDriver
2. 系统 PATH 中的 chromedriver
3. webdriver-manager 自动下载（需系统已安装 Chrome）
"""

import logging
import os
import shutil
import sys

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

logger = logging.getLogger(__name__)


def _get_bin_dir():
    """获取 bin/ 目录的绝对路径。

    兼容两种运行环境：
    - 开发模式：项目根目录下的 bin/
    - PyInstaller 打包后：sys._MEIPASS 下的 bin/
    """
    # PyInstaller 打包后的临时目录
    if getattr(sys, "frozen", False):
        base = sys._MEIPASS
    else:
        # 开发模式：从 src/bot/browser.py 向上 3 级到项目根目录
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base, "bin")


def _get_bundled_chrome_path():
    """返回捆绑的 chrome.exe 路径，不存在则返回 None。"""
    chrome_exe = os.path.join(_get_bin_dir(), "chrome-win64", "chrome.exe")
    if os.path.exists(chrome_exe):
        return chrome_exe
    return None


def _get_bundled_chromedriver_path():
    """返回捆绑的 chromedriver.exe 路径，不存在则返回 None。"""
    driver_exe = os.path.join(_get_bin_dir(), "chromedriver-win64", "chromedriver.exe")
    if os.path.exists(driver_exe):
        return driver_exe
    return None


def create_driver():
    """创建配置了反检测参数的 Chrome WebDriver 实例。"""
    options = _build_chrome_options()

    bundled_chrome = _get_bundled_chrome_path()
    bundled_driver = _get_bundled_chromedriver_path()

    if bundled_chrome and bundled_driver:
        # ---- 优先使用捆绑的 Chrome for Testing ----
        logger.info("使用捆绑的 Chrome: %s", bundled_chrome)
        logger.info("使用捆绑的 ChromeDriver: %s", bundled_driver)
        options.binary_location = bundled_chrome
        service = Service(bundled_driver)
    else:
        # ---- Fallback: 系统 chromedriver 或 webdriver-manager ----
        chromedriver_path = shutil.which("chromedriver")
        if chromedriver_path:
            logger.info("使用系统 chromedriver: %s", chromedriver_path)
            service = Service(chromedriver_path)
        else:
            logger.info("使用 webdriver-manager 自动管理 ChromeDriver")
            service = Service(ChromeDriverManager().install())

    driver = webdriver.Chrome(options=options, service=service)

    # 覆盖 navigator.webdriver 属性，防止被检测为自动化工具
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver


def _build_chrome_options():
    """构建 Chrome Options 配置。"""
    options = Options()

    # 反检测参数
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-infobars")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--start-maximized")

    # 稳定性参数
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")

    # 禁用 Chrome 自动更新（对捆绑的 Chrome for Testing 是双保险）
    options.add_argument("--disable-background-networking")

    # 禁用浏览器的密码保存提示
    prefs = {
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
    }
    options.add_experimental_option("prefs", prefs)

    return options
