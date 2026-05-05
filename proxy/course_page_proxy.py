from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import global_state


class CoursePageProxy:
    def __init__(self, page):
        self.page = page
        self.bot = page.state["bot"]
        self.role = page.state.get("role", "course")
        self.urls = page.urls

    @property
    def driver(self):
        return global_state.GLOBAL_DRIVER or self.bot.driver

    def on_page_start(self, page):
        if self.role == "login":
            if self.bot.driver is None:
                self.bot.driver = self.bot._create_driver()
                self.bot.wait = WebDriverWait(self.bot.driver, 10)
                global_state.set_globals(driver=self.bot.driver)
            target = self.pick_url()
            if target:
                self.open(target)

    def on_page_end(self, page):
        return None

    def pick_url(self):
        if not self.urls:
            return ""
        selector = self.page.state.get("url_selector")
        if selector is None:
            return self.urls[0]

        try:
            if callable(selector):
                idx = selector(self.urls, self)
            elif hasattr(selector, "select_index"):
                idx = selector.select_index(self.urls, self)
            else:
                idx = 0
        except Exception:
            idx = 0

        if not isinstance(idx, int) or idx < 0 or idx >= len(self.urls):
            idx = 0
        return self.urls[idx]

    def open(self, url: str | None = None):
        target = url or self.pick_url()
        if target:
            self.driver.get(target)

    def wait(self, seconds: float):
        import time

        time.sleep(seconds)

    def find(self, by: str, value: str, timeout: int = 10):
        by_map = {
            "css": By.CSS_SELECTOR,
            "xpath": By.XPATH,
            "id": By.ID,
            "name": By.NAME,
            "tag": By.TAG_NAME,
            "class": By.CLASS_NAME,
        }
        locator = by_map.get(by.lower(), By.CSS_SELECTOR)
        return WebDriverWait(self.driver, timeout).until(
            EC.presence_of_element_located((locator, value))
        )

    def click(self, by: str, value: str, timeout: int = 10):
        self.find(by, value, timeout=timeout).click()

    def input(self, by: str, value: str, text: str, timeout: int = 10):
        el = self.find(by, value, timeout=timeout)
        el.clear()
        el.send_keys(text)

    def get(self, key: str, default=None):
        values = {
            "loop_sleep_seconds": self.page.state.get("loop_sleep_seconds", 1.0),
            "unfinished": self.page.state.get("unfinished", []),
            "video_index": self.page.state.get("video_index", 0),
            "completed_this_run": self.page.state.get("completed_this_run", 0),
            "role": self.role,
            "urls": self.urls,
        }
        return values.get(key, default)

    def set(self, key: str, value):
        self.page.state[key] = value
