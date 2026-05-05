"""
登录策略抽象基类 —— 定义统一的登录接口，方便后续新增第三方登录方式。
"""

from abc import ABC, abstractmethod


class LoginStrategy(ABC):
    """登录策略基类。

    子类需实现 do_login() 方法，处理从登录页到跳转完成的完整流程。
    """

    def __init__(self, driver, username, password, base_url, logged_url, captcha_handler=None):
        self.driver = driver
        self.username = username
        self.password = password
        self.base_url = base_url
        self.logged_url = logged_url
        self.captcha = captcha_handler

    @abstractmethod
    def do_login(self):
        """执行登录流程。"""
        ...

    def check_already_logged_in(self):
        """检测当前是否已处于登录状态。

        策略：访问 base_url 后比较 current_url 是否包含 logged_url。
        如果已登录则跳过登录流程，节省时间。
        """
        import time
        from src.constants import PAGE_LOAD_WAIT
        import logging

        logger = logging.getLogger(__name__)
        self.driver.get(self.base_url)
        time.sleep(PAGE_LOAD_WAIT)
        current_url = self.driver.current_url
        logger.info("当前 URL: %s", current_url)
        if self.logged_url and self.logged_url in current_url:
            logger.info("已登录，无需重新登录")
            return True
        logger.info("未登录，开始登录流程")
        return False
