"""
浏览器工厂模块 —— 负责创建配置好反检测参数的 Chrome WebDriver 实例。

Chrome 选择策略（按优先级）：
1. 显式指定路径（chrome_binary / chromedriver_binary 参数）
2. 系统 PATH 中的 chromedriver + 常见 Chrome 安装路径
3. 下载并缓存 Chrome for Testing 到项目 bin/ 目录
"""

import logging
import os
import shutil
import subprocess
import sys

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

logger = logging.getLogger(__name__)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BIN_DIR = os.path.join(_PROJECT_ROOT, "bin")


def _find_system_chrome():
    """查找系统安装的 Chrome 浏览器路径"""
    if sys.platform == "darwin":
        candidates = [
            # Chrome for Testing
            "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            os.path.expanduser(
                "~/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            ),
            # 正常 Chrome
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
    else:
        candidates = [
            # Chrome for Testing
            os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"),
                         "Google\\Chrome for Testing\\Application\\chrome.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""),
                         "Google\\Chrome for Testing\\Application\\chrome.exe"),
            # 正常 Chrome
            os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"),
                         "Google\\Chrome\\Application\\chrome.exe"),
            os.path.join(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"),
                         "Google\\Chrome\\Application\\chrome.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""),
                         "Google\\Chrome\\Application\\chrome.exe"),
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
    return None


def _find_cached_chrome():
    """在 bin/ 目录查找已缓存的 Chrome for Testing。"""
    if sys.platform == "darwin":
        candidates = [
            os.path.join(BIN_DIR, "chrome-mac-arm64",
                         "Google Chrome for Testing.app", "Contents", "MacOS",
                         "Google Chrome for Testing"),
            os.path.join(BIN_DIR, "chrome-mac-x64",
                         "Google Chrome for Testing.app", "Contents", "MacOS",
                         "Google Chrome for Testing"),
        ]
    else:
        candidates = [
            os.path.join(BIN_DIR, "chrome-win64", "chrome.exe"),
        ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _find_cached_chromedriver():
    """在 bin/ 目录查找已缓存的 chromedriver。"""
    if sys.platform == "darwin":
        candidates = [
            os.path.join(BIN_DIR, "chromedriver-mac-arm64", "chromedriver"),
            os.path.join(BIN_DIR, "chromedriver-mac-x64", "chromedriver"),
        ]
    else:
        candidates = [
            os.path.join(BIN_DIR, "chromedriver-win64", "chromedriver.exe"),
        ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _download_chrome():
    """按需下载 Chrome for Testing 到 bin/ 目录。"""
    logger.info("正在下载 Chrome for Testing（约 200MB），请耐心等待...")
    script = os.path.join(_PROJECT_ROOT, "scripts", "download_chrome.py")
    try:
        subprocess.run(
            [sys.executable, script],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Chrome for Testing 下载完成")
        return True
    except subprocess.CalledProcessError as e:
        logger.error("Chrome for Testing 下载失败: %s", e.stderr)
        return False


def create_driver(chrome_binary=None, chromedriver_binary=None):
    """创建配置了反检测参数的 Chrome WebDriver 实例。

    Args:
        chrome_binary: Chrome 可执行文件路径（可选）。
        chromedriver_binary: ChromeDriver 可执行文件路径（可选）。

    Priority:
        1. 显式指定的路径
        2. 系统已安装的 Chrome + chromedriver
        3. 按需下载 Chrome for Testing + ChromeDriver 到 bin/
    """
    options = _build_chrome_options()

    # ---- Priority 1: 显式指定的路径 ----
    if chrome_binary and chromedriver_binary:
        if os.path.exists(chrome_binary) and os.path.exists(chromedriver_binary):
            logger.info("使用指定 Chrome: %s", chrome_binary)
            logger.info("使用指定 ChromeDriver: %s", chromedriver_binary)
            options.binary_location = chrome_binary
            service = Service(chromedriver_binary)
            return _create_driver_instance(options, service)

    # ---- Priority 2: 系统检测 ----
    system_chrome = _find_system_chrome()
    system_chromedriver = shutil.which("chromedriver")
    if system_chrome and system_chromedriver:
        logger.info("使用系统 Chrome: %s", system_chrome)
        logger.info("使用系统 chromedriver: %s", system_chromedriver)
        options.binary_location = system_chrome
        service = Service(system_chromedriver)
        return _create_driver_instance(options, service)

    if system_chromedriver:
        logger.info("使用系统 chromedriver: %s", system_chromedriver)
        service = Service(system_chromedriver)
        return _create_driver_instance(options, service)

    # ---- Priority 3: 缓存的 Chrome for Testing ----
    cached_chrome = _find_cached_chrome()
    cached_driver = _find_cached_chromedriver()
    if cached_chrome and cached_driver:
        logger.info("使用缓存 Chrome: %s", cached_chrome)
        logger.info("使用缓存 ChromeDriver: %s", cached_driver)
        options.binary_location = cached_chrome
        service = Service(cached_driver)
        return _create_driver_instance(options, service)

    # ---- Priority 4: 按需下载 ----
    logger.info("未找到可用的 Chrome，正在自动下载...")
    if _download_chrome():
        cached_chrome = _find_cached_chrome()
        cached_driver = _find_cached_chromedriver()
        if cached_chrome and cached_driver:
            options.binary_location = cached_chrome
            service = Service(cached_driver)
            return _create_driver_instance(options, service)

    # ---- 最后兜底: webdriver-manager ----
    logger.info("使用 webdriver-manager 自动管理 ChromeDriver")
    service = Service(ChromeDriverManager().install())
    return _create_driver_instance(options, service)


def _create_driver_instance(options, service):
    """创建 WebDriver 实例并注入反检测脚本。"""
    driver = webdriver.Chrome(options=options, service=service)
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver


def _build_chrome_options():
    """构建 Chrome Options 配置。"""
    options = Options()

    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-infobars")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--start-maximized")

    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-background-networking")

    prefs = {
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
    }
    options.add_experimental_option("prefs", prefs)

    return options
