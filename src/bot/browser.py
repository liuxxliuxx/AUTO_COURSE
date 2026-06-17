<<<<<<< HEAD
"""Chrome WebDriver factory with local, system, and cached browser discovery."""
=======
"""
浏览器工厂模块 —— 负责创建配置好反检测参数的 Chrome WebDriver 实例。

Chrome 选择策略（按优先级）：
1. 显式指定路径（chrome_binary / chromedriver_binary 参数）
2. 系统 PATH 中的 chromedriver + 常见 Chrome 安装路径
3. 下载并缓存 Chrome for Testing 到项目 bin/ 目录
"""
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a

import logging
import os
import shutil
import subprocess
import sys
import tempfile

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

logger = logging.getLogger(__name__)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BIN_DIR = os.path.join(_PROJECT_ROOT, "bin")

<<<<<<< HEAD
def _project_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _runtime_root():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    return _project_root()


BIN_DIR = os.path.join(_runtime_root(), "bin")


def _find_system_chrome():
    """Return a system Chrome/Chrome for Testing binary path when available."""
    if sys.platform == "darwin":
        candidates = [
=======

def _find_system_chrome():
    """查找系统安装的 Chrome 浏览器路径"""
    if sys.platform == "darwin":
        candidates = [
            # Chrome for Testing
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
            "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            os.path.expanduser(
                "~/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            ),
<<<<<<< HEAD
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
    else:
        candidates = [
            os.path.join(
                os.environ.get("PROGRAMFILES", "C:\\Program Files"),
                "Google\\Chrome for Testing\\Application\\chrome.exe",
            ),
            os.path.join(
                os.environ.get("LOCALAPPDATA", ""),
                "Google\\Chrome for Testing\\Application\\chrome.exe",
            ),
            os.path.join(
                os.environ.get("PROGRAMFILES", "C:\\Program Files"),
                "Google\\Chrome\\Application\\chrome.exe",
            ),
            os.path.join(
                os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"),
                "Google\\Chrome\\Application\\chrome.exe",
            ),
            os.path.join(
                os.environ.get("LOCALAPPDATA", ""),
                "Google\\Chrome\\Application\\chrome.exe",
            ),
        ]
    return next((path for path in candidates if os.path.exists(path)), None)


def _find_cached_chrome():
    """Return a cached Chrome for Testing binary path from bin/ when available."""
    if sys.platform == "darwin":
        candidates = [
            os.path.join(
                BIN_DIR,
                "chrome-mac-arm64",
                "Google Chrome for Testing.app",
                "Contents",
                "MacOS",
                "Google Chrome for Testing",
            ),
            os.path.join(
                BIN_DIR,
                "chrome-mac-x64",
                "Google Chrome for Testing.app",
                "Contents",
                "MacOS",
                "Google Chrome for Testing",
            ),
        ]
    else:
        candidates = [os.path.join(BIN_DIR, "chrome-win64", "chrome.exe")]
    return next((path for path in candidates if os.path.exists(path)), None)


def _find_system_chromedriver():
    """Return a system chromedriver path from PATH or common locations."""
    path = shutil.which("chromedriver")
    if path:
        return path

    if sys.platform == "darwin":
        candidates = [
            "/opt/homebrew/bin/chromedriver",
            "/usr/local/bin/chromedriver",
            "/usr/local/lib/node_modules/chromedriver/bin/chromedriver",
            os.path.expanduser("~/.npm-global/bin/chromedriver"),
        ]
    else:
        candidates = [
            os.path.join(
                os.environ.get("PROGRAMFILES", "C:\\Program Files"),
                "chromedriver",
                "chromedriver.exe",
            ),
            os.path.join(
                os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"),
                "chromedriver",
                "chromedriver.exe",
            ),
            os.path.join(
                os.environ.get("APPDATA", ""),
                "npm",
                "node_modules",
                "chromedriver",
                "bin",
                "chromedriver.exe",
            ),
        ]
    return next((path for path in candidates if os.path.isfile(path)), None)


def _find_cached_chromedriver():
    """Return a cached chromedriver path from bin/ when available."""
=======
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


def _find_system_chromedriver():
    """查找系统安装的 chromedriver（优先 PATH，再查常见路径）。"""
    # 1. PATH 中查找
    path = shutil.which("chromedriver")
    if path:
        return path
    # 2. 常见安装路径
    if sys.platform == "darwin":
        candidates = [
            "/opt/homebrew/bin/chromedriver",
            "/usr/local/bin/chromedriver",
            "/usr/local/lib/node_modules/chromedriver/bin/chromedriver",
            os.path.expanduser("~/.npm-global/bin/chromedriver"),
        ]
    else:
        candidates = [
            os.path.join(os.environ.get("PROGRAMFILES", "C:\\Program Files"),
                         "chromedriver", "chromedriver.exe"),
            os.path.join(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)"),
                         "chromedriver", "chromedriver.exe"),
            os.path.join(os.environ.get("APPDATA", ""),
                         "npm", "node_modules", "chromedriver", "bin", "chromedriver.exe"),
        ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def _find_cached_chromedriver():
    """在 bin/ 目录查找已缓存的 chromedriver。"""
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
    if sys.platform == "darwin":
        candidates = [
            os.path.join(BIN_DIR, "chromedriver-mac-arm64", "chromedriver"),
            os.path.join(BIN_DIR, "chromedriver-mac-x64", "chromedriver"),
        ]
    else:
<<<<<<< HEAD
        candidates = [os.path.join(BIN_DIR, "chromedriver-win64", "chromedriver.exe")]
    return next((path for path in candidates if os.path.exists(path)), None)


def _download_chrome():
    """Download Chrome for Testing into bin/ when the helper script is available."""
    script = os.path.join(_project_root(), "scripts", "download_chrome.py")
    if not os.path.exists(script):
        logger.warning("Chrome download helper not found: %s", script)
        return False

    logger.info("Downloading Chrome for Testing, this may take a few minutes...")
=======
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
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
    try:
        subprocess.run(
            [sys.executable, script],
            check=True,
            capture_output=True,
            text=True,
        )
<<<<<<< HEAD
        logger.info("Chrome for Testing download finished")
        return True
    except subprocess.CalledProcessError as exc:
        logger.error("Chrome for Testing download failed: %s", exc.stderr or exc)
=======
        logger.info("Chrome for Testing 下载完成")
        return True
    except subprocess.CalledProcessError as e:
        logger.error("Chrome for Testing 下载失败: %s", e.stderr)
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
        return False


def create_driver(chrome_binary=None, chromedriver_binary=None):
<<<<<<< HEAD
    """Create a Chrome WebDriver using explicit paths, system paths, or cache."""
=======
    """创建配置了反检测参数的 Chrome WebDriver 实例。

    Args:
        chrome_binary: Chrome 可执行文件路径（可选）。
        chromedriver_binary: ChromeDriver 可执行文件路径（可选）。

    Priority:
        1. 显式指定的路径
        2. 系统已安装的 Chrome + chromedriver
        3. 按需下载 Chrome for Testing + ChromeDriver 到 bin/
    """
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
    options = _build_chrome_options()
    _add_runtime_chrome_options(options)

<<<<<<< HEAD
    explicit_chrome = chrome_binary if chrome_binary and os.path.exists(chrome_binary) else None
    explicit_driver = (
        chromedriver_binary
        if chromedriver_binary and os.path.exists(chromedriver_binary)
        else None
    )

    if chrome_binary and not explicit_chrome:
        logger.warning("Configured Chrome path does not exist: %s", chrome_binary)
    if chromedriver_binary and not explicit_driver:
        logger.warning("Configured ChromeDriver path does not exist: %s", chromedriver_binary)

    if explicit_chrome:
        logger.info("Using configured Chrome: %s", explicit_chrome)
        options.binary_location = explicit_chrome
    if explicit_driver:
        logger.info("Using configured ChromeDriver: %s", explicit_driver)
        return _create_driver_instance(options, Service(explicit_driver))

    system_chrome = None if explicit_chrome else _find_system_chrome()
    system_driver = _find_system_chromedriver()
    if system_chrome:
        logger.info("Using system Chrome: %s", system_chrome)
        options.binary_location = system_chrome
    if system_driver:
        logger.info("Using system chromedriver: %s", system_driver)
        return _create_driver_instance(options, Service(system_driver))

    cached_chrome = None if explicit_chrome else _find_cached_chrome()
    cached_driver = _find_cached_chromedriver()
    if cached_chrome and cached_driver:
        logger.info("Using cached Chrome: %s", cached_chrome)
        logger.info("Using cached ChromeDriver: %s", cached_driver)
        options.binary_location = cached_chrome
        return _create_driver_instance(options, Service(cached_driver))

    logger.info("No matching Chrome/ChromeDriver pair found, trying cached download...")
    if not getattr(sys, "frozen", False) and _download_chrome():
        cached_chrome = None if explicit_chrome else _find_cached_chrome()
        cached_driver = _find_cached_chromedriver()
        if cached_chrome:
            logger.info("Using downloaded Chrome: %s", cached_chrome)
            options.binary_location = cached_chrome
        if cached_driver:
            logger.info("Using downloaded ChromeDriver: %s", cached_driver)
            return _create_driver_instance(options, Service(cached_driver))

    logger.info("Using webdriver-manager for ChromeDriver")
    return _create_driver_instance(options, Service(ChromeDriverManager().install()))


def _add_runtime_chrome_options(options):
    user_data_dir = tempfile.mkdtemp(prefix="chrome_zhs_")
    options.add_argument(f"--user-data-dir={user_data_dir}")
    logger.info("Chrome user-data-dir: %s", user_data_dir)


def _create_driver_instance(options, service):
=======
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
    system_chromedriver = _find_system_chromedriver()
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
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
    driver = webdriver.Chrome(options=options, service=service)
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver


def _build_chrome_options():
    options = Options()

<<<<<<< HEAD
    # MediaRecorder/captureStream needs an isolated profile with disabled web security.
    options.add_argument("--disable-web-security")

=======
>>>>>>> 308e2218fc774f0041cb972afcb4ba714612fa1a
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
