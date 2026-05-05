"""
弹题测验处理模块 —— 负责检测弹题对话框、答题、关闭弹题。

答题策略通过 AnswerStrategy 协议注入，默认使用 RandomAnswerStrategy。
"""

import logging
import random
import time

from selenium.webdriver.common.by import By

from src.constants import (
    MEDIUM_SLEEP,
    QUIZ_CLOSE_BTN_XPATH,
    QUIZ_CLOSE_CSS,
    QUIZ_DIALOG_CSS,
    QUIZ_DIALOG_FALLBACK_CSS,
    QUIZ_FOOTER_BTN_XPATH,
    QUIZ_NEXT_BTN_CSS,
    QUIZ_OPTION_ACTIVE_CSS,
    QUIZ_OPTION_CSS,
    SHORT_SLEEP,
)

logger = logging.getLogger(__name__)


# ============================================================================
# 答题策略
# ============================================================================


class AnswerStrategy:
    """答题策略基类（鸭子类型协议）。

    子类只需实现 select_option(options: list[WebElement]) -> WebElement。
    """

    def select_option(self, options):
        """从选项列表中选择一个，返回选中的 WebElement。"""
        raise NotImplementedError


class RandomAnswerStrategy(AnswerStrategy):
    """随机选择答题策略 —— 默认策略。"""

    def select_option(self, options):
        return random.choice(options)


class FirstAnswerStrategy(AnswerStrategy):
    """固定选第一个 —— 用于调试或保守策略。"""

    def select_option(self, options):
        return options[0]


# ============================================================================
# 弹题处理器
# ============================================================================


class QuizHandler:
    """弹题测验处理器。

    负责检测弹题对话框、答题（委托给 AnswerStrategy）、
    处理多题连答、关闭对话框。

    Args:
        driver: Selenium WebDriver
        answer_strategy: 答题策略，默认 RandomAnswerStrategy
    """

    def __init__(self, driver, answer_strategy=None):
        self.driver = driver
        self.answer_strategy = answer_strategy or RandomAnswerStrategy()

    def find_dialog(self):
        """检测页面是否有可见的弹题测验对话框。"""
        try:
            dialogs = self.driver.find_elements(By.CSS_SELECTOR, QUIZ_DIALOG_CSS)
            for d in dialogs:
                if d.is_displayed():
                    return d
        except Exception:
            pass

        # Fallback: 遍历所有可见 el-dialog
        try:
            dialogs = self.driver.find_elements(By.CSS_SELECTOR, QUIZ_DIALOG_FALLBACK_CSS)
            for d in dialogs:
                if not d.is_displayed():
                    continue
                try:
                    label = d.get_attribute("aria-label")
                    if label and ("弹题" in label or "测验" in label or "答题" in label):
                        return d
                except Exception:
                    pass
        except Exception:
            pass

        return None

    def handle(self, dialog):
        """处理弹题测验（支持多题连答）。"""
        try:
            question_index = 0
            while True:
                question_index += 1
                logger.info("处理弹题第 %d 题", question_index)

                self._answer_current(dialog)
                time.sleep(SHORT_SLEEP)

                # 检查是否有下一题
                try:
                    next_btn = dialog.find_element(By.CSS_SELECTOR, QUIZ_NEXT_BTN_CSS)
                    if next_btn.is_enabled() and next_btn.is_displayed():
                        logger.info("点击右箭头进入下一题")
                        next_btn.click()
                        time.sleep(MEDIUM_SLEEP)
                        continue
                except Exception:
                    pass

                break

            return self._close(dialog)

        except Exception as e:
            logger.error("处理弹题时出错: %s", e)
            return False

    def _answer_current(self, dialog):
        """使用当前答题策略回答一道题目。"""
        options = dialog.find_elements(By.CSS_SELECTOR, QUIZ_OPTION_CSS)
        if not options:
            options = dialog.find_elements(
                By.XPATH, ".//li[contains(@class,'topic-item')]"
            )

        if not options:
            logger.info("未找到弹题选项")
            return False

        # 委托给策略选择
        choice = self.answer_strategy.select_option(options)

        clicked = False
        for click_target in [
            choice,
            *choice.find_elements(By.CSS_SELECTOR, ".item-topic"),
            *choice.find_elements(By.CSS_SELECTOR, "span"),
            *choice.find_elements(By.CSS_SELECTOR, "div"),
        ]:
            try:
                click_target.click()
                clicked = True
                break
            except Exception:
                continue

        if clicked:
            logger.info("已点击弹题选项（策略: %s）", type(self.answer_strategy).__name__)
        else:
            logger.warning("无法点击弹题选项")
            return False

        # 验证选中
        time.sleep(SHORT_SLEEP)
        for _ in range(5):
            active_opts = dialog.find_elements(By.CSS_SELECTOR, QUIZ_OPTION_ACTIVE_CSS[0])
            if not active_opts:
                active_opts = dialog.find_elements(By.CSS_SELECTOR, QUIZ_OPTION_ACTIVE_CSS[1])
            if active_opts:
                logger.info("确认选项已被选中（%d个active元素）", len(active_opts))
                return True
            try:
                self.answer_strategy.select_option(options).click()
            except Exception:
                pass
            time.sleep(SHORT_SLEEP)

        logger.warning("未检测到选项被选中")
        return False

    def _close(self, dialog):
        """关闭弹题对话框。"""
        for sel in QUIZ_CLOSE_CSS:
            try:
                close_btn = dialog.find_element(By.CSS_SELECTOR, sel)
                if close_btn.is_displayed():
                    close_btn.click()
                    logger.info("已关闭弹题对话框")
                    time.sleep(MEDIUM_SLEEP)
                    return True
            except Exception:
                continue

        try:
            footer_btn = dialog.find_element(By.XPATH, QUIZ_FOOTER_BTN_XPATH)
            footer_btn.click()
            logger.info("已通过底部按钮关闭弹题")
            time.sleep(MEDIUM_SLEEP)
            return True
        except Exception:
            pass

        try:
            footer_btn = dialog.find_element(By.XPATH, QUIZ_CLOSE_BTN_XPATH)
            footer_btn.click()
            logger.info("已通过底部'关闭'按钮关闭弹题")
            time.sleep(MEDIUM_SLEEP)
            return True
        except Exception:
            pass

        logger.warning("未能关闭弹题对话框")
        return False
