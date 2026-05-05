"""
课程导航模块 —— 负责课程页面导航、视频列表解析、弹窗处理。
"""

import logging
import time

from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.common.by import By

from src.constants import (
    EXTRA_LONG_SLEEP,
    INITIAL_DIALOG_MAX_ATTEMPTS,
    LONG_SLEEP,
    MEDIUM_SLEEP,
    PRESCHOOL_CLOSE_CSS,
    PRESCHOOL_DIALOG_CSS,
    SHORT_SLEEP,
    VIDEO_FINISHED_MARK_CSS,
    VIDEO_LIST_ITEM_CSS,
    VIDEO_SMALL_LESSON_CSS,
    VIDEO_TITLE_CSS,
    WAIT_MEDIUM,
    WAIT_SHORT,
)
from src.utils.element_finder import find_element

logger = logging.getLogger(__name__)


class CourseNavigator:
    """课程页面导航器。

    负责访问课程页面、处理初始弹窗（学前必读、弹题）、
    解析未完成视频列表、点击视频项加载播放器。
    """

    def __init__(self, driver, captcha_handler=None, quiz_handler=None, skip_completed=True):
        self.driver = driver
        self.captcha = captcha_handler
        self.quiz = quiz_handler
        self.skip_completed = skip_completed

    def navigate(self, video_url):
        """访问课程视频页面并处理初始弹窗和验证码。"""
        logger.info("正在访问课程页面: %s", video_url)
        self.driver.get(video_url)
        time.sleep(WAIT_MEDIUM)

        self._handle_initial_dialogs()
        if self.captcha:
            self.captcha.check_and_handle("访问课程页面时出现验证码，请完成验证")

    def _handle_initial_dialogs(self):
        """交叉检测并处理页面加载时可能同时出现的多种弹窗。

        学前必读和弹题测验可能同时弹出，此方法交替检查两者，
        而不是只处理一种就退出——避免另一种弹窗残留阻塞页面。
        """
        for attempt in range(INITIAL_DIALOG_MAX_ATTEMPTS):
            found_any = False

            # 学前必读弹窗
            try:
                dialog = self.driver.find_element(By.CSS_SELECTOR, PRESCHOOL_DIALOG_CSS)
                if dialog.is_displayed():
                    found_any = True
                    logger.info("检测到'学前必读'弹窗（第%d次尝试）", attempt + 1)
                    self._close_preschool_dialog()
                    time.sleep(MEDIUM_SLEEP)
            except NoSuchElementException:
                pass

            # 弹题测验
            if self.quiz:
                quiz_dialog = self.quiz.find_dialog()
                if quiz_dialog:
                    found_any = True
                    logger.info("检测到弹题测验（第%d次尝试）", attempt + 1)
                    self.quiz.handle(quiz_dialog)
                    time.sleep(MEDIUM_SLEEP)

            if not found_any:
                logger.debug("初始弹窗已全部处理完毕（经过%d次检查）", attempt + 1)
                break
        else:
            logger.warning("初始弹窗处理循环达到上限，继续执行")

    def _close_preschool_dialog(self):
        """关闭'学前必读'弹窗。优先 Selenium 点击，失败用 JS 兜底。"""
        try:
            dialog = self.driver.find_element(By.CSS_SELECTOR, PRESCHOOL_DIALOG_CSS)
            if dialog.is_displayed():
                logger.info("检测到'学前必读'弹窗，正在关闭...")
                close_btn = find_element(
                    self.driver, By.CSS_SELECTOR, PRESCHOOL_CLOSE_CSS, timeout=WAIT_SHORT
                )
                if close_btn:
                    close_btn.click()
                    logger.info("已关闭'学前必读'弹窗")
                else:
                    self.driver.execute_script(
                        "var d=document.querySelector('.dialog-read');"
                        "var i=d&&d.querySelector('i.iconfont');"
                        "if(i)i.click();"
                    )
                    logger.info("已通过JS关闭'学前必读'弹窗")
                time.sleep(LONG_SLEEP)
        except NoSuchElementException:
            logger.debug("未检测到'学前必读'弹窗")
        except Exception as e:
            logger.debug("处理'学前必读'弹窗时出错（可能不存在）: %s", e)

    def get_unfinished_videos(self):
        """获取课程页面中的视频列表。

        返回 [(title, WebElement), ...]。
        如果 skip_completed=True，排除已标记完成的视频；
        如果 skip_completed=False，返回全部视频（含已学完的）。
        """
        try:
            all_items = self.driver.find_elements(By.CSS_SELECTOR, VIDEO_LIST_ITEM_CSS)
        except Exception:
            logger.warning("未找到课程列表项")
            return []

        result = []
        for item in all_items:
            try:
                # 排除小章节标题（无视频内容）
                small_lesson = item.find_elements(By.CSS_SELECTOR, VIDEO_SMALL_LESSON_CSS)
                if small_lesson:
                    continue

                # 必须有标题
                title_el = item.find_elements(By.CSS_SELECTOR, VIDEO_TITLE_CSS)
                if not title_el:
                    continue

                title = title_el[0].text.strip()
                if not title:
                    continue

                # 仅当"跳过已学课程"勾选时才排除已完成项
                if self.skip_completed:
                    finished = item.find_elements(By.CSS_SELECTOR, VIDEO_FINISHED_MARK_CSS)
                    if finished:
                        logger.debug("已完成（跳过）: %s", title)
                        continue

                result.append((title, item))
                logger.info("待学习: %s", title)
            except Exception as e:
                logger.debug("解析课程项出错: %s", e)
                continue

        return result

    def click_video(self, video_element, title):
        """点击侧边栏视频项以加载播放器。"""
        logger.info("点击课程: %s", title)
        try:
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block: 'center'});", video_element
            )
            time.sleep(SHORT_SLEEP)
            video_element.click()
            time.sleep(EXTRA_LONG_SLEEP)

            if self.captcha:
                self.captcha.check_and_handle(
                    f"切换课程'{title}'时出现验证码，请完成验证"
                )
            return True
        except Exception as e:
            logger.error("点击课程失败 '%s': %s", title, e)
            return False
