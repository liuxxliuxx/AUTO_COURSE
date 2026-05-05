"""
数字石大 (UPC) SSO 统一认证登录策略。
"""

import json
import logging
import time

from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from src.bot.login.base import LoginStrategy
from src.constants import (
    EXTRA_LONG_SLEEP,
    LONG_SLEEP,
    UPC_FORWARD_URL,
    UPC_LOGIN_IFRAME_CSS,
    WAIT_DEFAULT,
    WAIT_EXTRA_LONG,
    WAIT_LONG,
    WAIT_MEDIUM,
)

logger = logging.getLogger(__name__)


class UPCLogin(LoginStrategy):
    """数字石大 (UPC) SSO 统一认证登录。

    流程：
    1. 在 CAS 页面找到 Vant UI 登录 iframe
    2. 通过 JS 注入用户名和密码到 Vue 组件
    3. 触发 passwordLogin() 方法
    4. 跳转到课程中心应用
    5. 处理可能的验证码
    6. 等待最终跳转
    """

    def do_login(self):
        time.sleep(EXTRA_LONG_SLEEP)
        logger.info("CAS 页面 URL: %s", self.driver.current_url)

        try:
            self._inject_vue_credentials()
        except (TimeoutException, NoSuchElementException) as e:
            logger.error("CAS 登录表单操作失败: %s", e)
            try:
                self.driver.switch_to.default_content()
            except Exception:
                pass
            raise

        # 跳转到课程中心应用
        time.sleep(WAIT_MEDIUM)
        logger.info("正在跳转到应用页面...")
        self.driver.get(UPC_FORWARD_URL)
        time.sleep(WAIT_MEDIUM)

        # 处理验证码
        if self.captcha:
            self.captcha.check_and_handle("登录时出现验证码，请完成验证")

        # 等待跳转
        self._wait_for_redirect()

    def _inject_vue_credentials(self):
        """在 UPC CAS 页面的 Vant UI iframe 中注入凭据。

        UPC 的登录表单是一个 Vue 组件，通过 JS 直接修改
        app.username / app.password 并调用 passwordLogin() 来登录，
        比模拟键盘输入更可靠。
        """
        WebDriverWait(self.driver, WAIT_DEFAULT).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, UPC_LOGIN_IFRAME_CSS))
        )
        self.driver.switch_to.frame(
            self.driver.find_element(By.CSS_SELECTOR, UPC_LOGIN_IFRAME_CSS)
        )
        time.sleep(LONG_SLEEP)

        js_code = (
            "var app = document.querySelector('#app').__vue__;"
            "app.username = %s;"
            "app.password = %s;"
            "app.passwordLogin();"
        ) % (json.dumps(self.username), json.dumps(self.password))
        self.driver.execute_script(js_code)
        logger.info("已通过 JS 注入凭据并触发登录，等待跳转...")

        self.driver.switch_to.default_content()

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
