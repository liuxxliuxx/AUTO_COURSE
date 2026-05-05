"""
验证码检测与人工介入处理模块。

负责检测页面上的各种验证码形式（iframe、弹窗、图片验证码），
并通过 threading.Event 通知 GUI 线程等待用户手动完成。
"""

import logging
import time

from selenium.webdriver.common.by import By

from src.constants import (
    CAPTCHA_IFRAME_KEYWORDS,
    CAPTCHA_IMAGE_INPUT_ID,
    CAPTCHA_POPUP_SELECTORS,
    CAPTCHA_WAIT_TIMEOUT,
    LONG_SLEEP,
    MEDIUM_SLEEP,
)

logger = logging.getLogger(__name__)


class CaptchaHandler:
    """验证码检测与人工介入处理器。

    通过 threading.Event 与 GUI 线程通信：
    - captcha_event: 通知 GUI 有验证码需要处理
    - captcha_done_event: GUI 通知验证码已完成
    - stop_event: 外部通知立即停止等待
    """

    def __init__(self, driver, captcha_event=None, captcha_done_event=None, stop_event=None):
        self.driver = driver
        self._captcha_event = captcha_event
        self._captcha_done = captcha_done_event
        self._stop_event = stop_event

    def check_and_handle(self, message="请完成验证码"):
        """检测页面是否出现验证码，如有则通知 GUI 等待用户完成。

        检测顺序（按可靠性降序）：
        1. 验证码相关 iframe — 最可靠标识
        2. 可见弹窗元素 — yidun 滑块等
        3. 图片验证码输入框 — 登录页 j-captcha-mobile

        注意：特意跳过永久性隐藏容器（如 #captchaYidun），避免误报。
        """
        # 检测 1: 验证码 iframe
        try:
            iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
            for iframe in iframes:
                try:
                    src = (iframe.get_attribute("src") or "").lower()
                    if any(kw in src for kw in CAPTCHA_IFRAME_KEYWORDS):
                        if iframe.is_displayed():
                            logger.info("检测到验证码 iframe: %s", src)
                            self._notify_and_wait(message)
                            return True
                except Exception:
                    pass
        except Exception:
            pass

        # 检测 2: 可见弹窗
        for sel in CAPTCHA_POPUP_SELECTORS:
            try:
                els = self.driver.find_elements(By.CSS_SELECTOR, sel)
                for e in els:
                    try:
                        if e.is_displayed() and e.size.get("width", 0) > 10:
                            logger.info("检测到验证码弹窗: %s", sel)
                            self._notify_and_wait(message)
                            return True
                    except Exception:
                        pass
            except Exception:
                pass

        # 检测 3: 图片验证码输入框
        try:
            captcha_input = self.driver.find_element(By.ID, CAPTCHA_IMAGE_INPUT_ID)
            if captcha_input.is_displayed():
                logger.info("检测到登录页图片验证码输入框")
                self._notify_and_wait(message)
                return True
        except Exception:
            pass

        return False

    def _should_stop(self):
        """检查外部是否发出了停止信号。"""
        return self._stop_event and self._stop_event.is_set()

    def _notify_and_wait(self, message):
        """通知 GUI 验证码出现，阻塞等待用户确认（或超时/停止）。

        每 1 秒检查一次停止信号，最多等待 CAPTCHA_WAIT_TIMEOUT 秒。
        """
        logger.warning(message)
        if self._captcha_event:
            self._captcha_event.set()
            self._captcha_done.clear()
            waited = 0
            while not self._captcha_done.wait(timeout=MEDIUM_SLEEP):
                if self._should_stop():
                    logger.info("收到停止信号，放弃等待验证码")
                    self._captcha_done.clear()
                    self._captcha_event.clear()
                    return
                waited += 1
                if waited >= CAPTCHA_WAIT_TIMEOUT:
                    break
            self._captcha_done.clear()
            self._captcha_event.clear()
        logger.info("用户确认验证码已处理，继续运行")
        time.sleep(LONG_SLEEP)
