"""
智慧树手机号直接登录策略。
"""

import logging
import time

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from src.bot.login.base import LoginStrategy
from src.constants import (
    EXTRA_LONG_SLEEP,
    LOGIN_BTN_CSS,
    LOGIN_BTN_XPATH,
    LOGIN_PASSWORD_CSS,
    LOGIN_TAB_CSS,
    LOGIN_TAB_XPATH,
    LOGIN_USERNAME_CSS,
    LONG_SLEEP,
    MEDIUM_SLEEP,
    WAIT_EXTRA_LONG,
    WAIT_LONG,
    WAIT_MEDIUM,
    WAIT_SHORT,
)
from src.utils.element_finder import find_element

logger = logging.getLogger(__name__)


class ZhihuishuLogin(LoginStrategy):
    """智慧树在线平台手机号 + 密码直接登录。

    流程：
    1. 切换到"手机号"登录 Tab
    2. 填入用户名和密码
    3. 点击登录按钮触发滑块验证码
    4. 等待用户手动完成验证
    5. 等待页面跳转到 logged_url
    """

    def do_login(self):
        time.sleep(LONG_SLEEP)

        # 1. 切换到手机号登录 Tab
        self._switch_to_phone_tab()

        # 2. 填入用户名
        self._fill_username()

        # 3. 填入密码
        self._fill_password()

        # 4. 点击登录按钮
        self._click_login_button()

        # 5. 等待验证码处理
        time.sleep(EXTRA_LONG_SLEEP)
        if self.captcha:
            self.captcha.check_and_handle("登录时出现滑块验证码，请在浏览器中完成滑动验证")

        # 6. 等待登录跳转
        self._wait_for_redirect()

    def _switch_to_phone_tab(self):
        phone_tab = find_element(
            self.driver, By.CSS_SELECTOR, LOGIN_TAB_CSS, timeout=WAIT_SHORT
        )
        if not phone_tab:
            phone_tab = find_element(
                self.driver, By.XPATH, LOGIN_TAB_XPATH, timeout=WAIT_SHORT
            )
        if phone_tab:
            try:
                phone_tab.click()
                logger.info("已切换到手机号登录")
            except Exception:
                pass
        time.sleep(MEDIUM_SLEEP)

    def _fill_username(self):
        username_input = find_element(
            self.driver, By.CSS_SELECTOR, LOGIN_USERNAME_CSS, timeout=WAIT_MEDIUM
        )
        if username_input:
            username_input.clear()
            username_input.send_keys(self.username)
            logger.info("已填入账号")
        else:
            logger.error("未找到手机号输入框")
            if self.captcha:
                self.captcha.check_and_handle(
                    "未找到手机号输入框，请在浏览器中手动完成登录，然后点击GUI的'确认验证码已完成'按钮"
                )

    def _fill_password(self):
        password_input = find_element(
            self.driver, By.CSS_SELECTOR, LOGIN_PASSWORD_CSS, timeout=WAIT_MEDIUM
        )
        if password_input:
            password_input.clear()
            password_input.send_keys(self.password)
            logger.info("已填入密码")
        else:
            logger.error("未找到密码输入框")
            if self.captcha:
                self.captcha.check_and_handle(
                    "未找到密码输入框，请在浏览器中手动完成登录，然后点击GUI的'确认验证码已完成'按钮"
                )

    def _click_login_button(self):
        time.sleep(MEDIUM_SLEEP)
        login_btn = find_element(
            self.driver, By.CSS_SELECTOR, LOGIN_BTN_CSS, timeout=WAIT_MEDIUM
        )
        if not login_btn:
            login_btn = find_element(
                self.driver, By.XPATH, LOGIN_BTN_XPATH, timeout=WAIT_SHORT
            )

        if login_btn:
            # JS click 避免元素不可交互（页面可能有遮罩）
            self.driver.execute_script("arguments[0].click();", login_btn)
            logger.info("已点击登录按钮，等待滑块验证码出现...")
        else:
            logger.error("未找到登录按钮")
            if self.captcha:
                self.captcha.check_and_handle(
                    "未找到登录按钮，请在浏览器中手动点击登录并完成验证，然后点击GUI的'确认验证码已完成'按钮"
                )

    def _wait_for_redirect(self):
        """等待登录后页面跳转到 logged_url，超时后检查验证码并重试。"""
        try:
            WebDriverWait(self.driver, WAIT_EXTRA_LONG).until(
                lambda d: self.logged_url in d.current_url
                if self.logged_url
                else True
            )
            logger.info("登录成功")
        except Exception:
            logger.warning("等待登录跳转超时，再次检查验证码...")
            if self.captcha:
                self.captcha.check_and_handle("登录仍在等待验证，请完成验证码")
            try:
                WebDriverWait(self.driver, WAIT_LONG).until(
                    lambda d: self.logged_url in d.current_url
                    if self.logged_url
                    else True
                )
                logger.info("登录成功")
            except Exception:
                logger.warning("登录后未检测到 logged_URL，但继续执行")
