from __future__ import annotations

import logging
import shutil

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

import global_state
from app.course_app_factory import build_course_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)


class CourseBot:
    """全局运行编排器：只保留通用能力与配置。"""

    def __init__(
        self,
        base_url,
        username,
        password,
        logged_url,
        video_url,
        login_method="zhihuishu",
        time_limit_minutes=0,
        captcha_event=None,
        captcha_done_event=None,
        stop_event=None,
        db_proxy=None,
        skip_completed_courses=True,
    ):
        self.driver = None
        self.db = db_proxy
        self.base_url = base_url
        self.username = username
        self.password = password
        self.logged_url = logged_url
        self.video_url = video_url
        self.login_method = login_method
        self.time_limit_seconds = (time_limit_minutes or 0) * 60
        self.total_watched_seconds = 0
        self.captcha_event = captcha_event
        self.captcha_done_event = captcha_done_event
        self.stop_event = stop_event
        self.skip_completed_courses = bool(skip_completed_courses)

    def should_stop(self) -> bool:
        return bool(self.stop_event and self.stop_event.is_set())

    def create_driver(self):
        options = Options()
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-infobars")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)
        options.add_argument("--start-maximized")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-dev-shm-usage")
        options.add_experimental_option(
            "prefs",
            {
                "credentials_enable_service": False,
                "profile.password_manager_enabled": False,
            },
        )

        chromedriver_path = shutil.which("chromedriver")
        service = Service(chromedriver_path) if chromedriver_path else Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(options=options, service=service)
        driver.execute_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        return driver

    def run(self):
        logger.info("=" * 50)
        logger.info("课程自动播放程序启动")
        logger.info("=" * 50)
        try:
            app = build_course_app(self)
            app.run()
        except KeyboardInterrupt:
            logger.info("用户中断脚本")
        except Exception as exc:
            logger.error("脚本运行出错: %s", exc, exc_info=True)
        finally:
            if self.driver:
                logger.info("正在关闭浏览器...")
                self.driver.quit()
            global_state.set_globals(driver=None)
            logger.info("课程自动播放程序已退出")
