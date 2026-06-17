"""Chrome WebDriver factory with local, system, and cached browser discovery."""

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
            "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            os.path.expanduser(
                "~/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            ),
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
    if sys.platform == "darwin":
        candidates = [
            os.path.join(BIN_DIR, "chromedriver-mac-arm64", "chromedriver"),
            os.path.join(BIN_DIR, "chromedriver-mac-x64", "chromedriver"),
        ]
    else:
        candidates = [os.path.join(BIN_DIR, "chromedriver-win64", "chromedriver.exe")]
    return next((path for path in candidates if os.path.exists(path)), None)


def _download_chrome():
    """Download Chrome for Testing into bin/ when the helper script is available."""
    script = os.path.join(_project_root(), "scripts", "download_chrome.py")
    if not os.path.exists(script):
        logger.warning("Chrome download helper not found: %s", script)
        return False

    logger.info("Downloading Chrome for Testing, this may take a few minutes...")
    try:
        subprocess.run(
            [sys.executable, script],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Chrome for Testing download finished")
        return True
    except subprocess.CalledProcessError as exc:
        logger.error("Chrome for Testing download failed: %s", exc.stderr or exc)
        return False


def create_driver(chrome_binary=None, chromedriver_binary=None):
    """Create a Chrome WebDriver using explicit paths, system paths, or cache."""
    options = _build_chrome_options()
    _add_runtime_chrome_options(options)

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
    driver = webdriver.Chrome(options=options, service=service)
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver


def _build_chrome_options():
    options = Options()

    # MediaRecorder/captureStream needs an isolated profile with disabled web security.
    options.add_argument("--disable-web-security")

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
