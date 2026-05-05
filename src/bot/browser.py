"""
浏览器工厂模块 —— 负责创建配置好反检测参数的 Chrome WebDriver 实例。
"""

import shutil

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager


def create_driver():
    """创建配置了反检测参数的 Chrome WebDriver。

    优先使用系统 PATH 中的 chromedriver，否则通过 webdriver-manager 自动下载。
    配置包括：禁用自动化标志、最大化窗口、禁用密码保存提示等。
    """
    options = Options()
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-infobars")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--start-maximized")

    # 额外的反检测与稳定性参数
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-dev-shm-usage")

    # 禁用浏览器的密码保存提示
    prefs = {
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
    }
    options.add_experimental_option("prefs", prefs)

    chromedriver_path = shutil.which("chromedriver")
    if chromedriver_path:
        service = Service(chromedriver_path)
    else:
        service = Service(ChromeDriverManager().install())

    driver = webdriver.Chrome(options=options, service=service)

    # 覆盖 navigator.webdriver 属性，防止被检测为自动化工具
    driver.execute_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return driver
