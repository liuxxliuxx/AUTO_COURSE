"""
视频播放控制模块 —— 负责视频的播放、暂停恢复、进度检测。
"""

import logging
import time

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from src.constants import (
    LONG_SLEEP,
    MEDIUM_SLEEP,
    PLAY_BTN_CSS,
    PLAY_CONTROL_BTN_CSS,
    VIDEO_ELEMENT_CSS,
    VIDEO_SRC_EXTRACTION_JS,
    WAIT_MEDIUM,
    WAIT_SHORT,
)

logger = logging.getLogger(__name__)


class VideoController:
    """视频播放控制器。

    封装视频的播放、暂停检测、进度获取、结束判断等操作。
    """

    def __init__(self, driver):
        self.driver = driver

    def play(self):
        """尝试多种策略点击播放按钮，返回是否成功开始播放。

        策略按顺序：
        1. ActionChains 点击大播放按钮（模拟真人）
        2. 点击控制栏播放按钮
        3. 点击 <video> 元素本身
        4. 普通 Selenium click（兜底）
        """
        time.sleep(LONG_SLEEP)

        # 策略 1: ActionChains 模拟真人点击
        for sel in PLAY_BTN_CSS:
            try:
                btn = WebDriverWait(self.driver, WAIT_MEDIUM).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, sel))
                )
                self.driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center',behavior:'auto'});",
                    btn,
                )
                time.sleep(0.3)
                ActionChains(self.driver).move_to_element(btn).pause(0.2).click().perform()
                time.sleep(MEDIUM_SLEEP)
                if self.is_playing():
                    logger.info("已通过ActionChains点击播放: %s", sel)
                    return True
            except TimeoutException:
                continue
            except Exception as e:
                logger.debug("ActionChains未成功 (%s): %s", sel, e)
                continue

        # 策略 2: 控制栏播放按钮
        try:
            ctrl_btn = WebDriverWait(self.driver, WAIT_SHORT).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, PLAY_CONTROL_BTN_CSS))
            )
            ActionChains(self.driver).move_to_element(ctrl_btn).pause(0.2).click().perform()
            time.sleep(MEDIUM_SLEEP)
            if self.is_playing():
                logger.info("已通过控制栏播放按钮播放")
                return True
        except Exception:
            pass

        # 策略 3: 点击 video 元素
        try:
            video_el = WebDriverWait(self.driver, WAIT_SHORT).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, VIDEO_ELEMENT_CSS))
            )
            ActionChains(self.driver).move_to_element(video_el).click().perform()
            time.sleep(MEDIUM_SLEEP)
            if self.is_playing():
                logger.info("已通过点击video元素播放")
                return True
        except Exception:
            pass

        # 策略 4: 普通 Selenium click 兜底
        for sel in [PLAY_BTN_CSS[0], PLAY_CONTROL_BTN_CSS, "#container video"]:
            try:
                btn = WebDriverWait(self.driver, WAIT_SHORT).until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, sel))
                )
                btn.click()
                time.sleep(MEDIUM_SLEEP)
                if self.is_playing():
                    logger.info("已通过Selenium click播放: %s", sel)
                    return True
            except Exception:
                continue

        logger.warning("未能点击播放按钮")
        return False

    def is_playing(self):
        """检查视频是否正在播放（非暂停非结束）。"""
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');return v&&!v.paused&&!v.ended;"
            )
        except Exception:
            return False

    def is_ended(self):
        """检查视频是否已播放完毕。"""
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');return v&&v.ended;"
            )
        except Exception:
            return False

    def get_duration_seconds(self):
        """获取当前视频的总时长（秒）。"""
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');return v&&v.duration||0;"
            )
        except Exception:
            return 0

    def get_progress(self):
        """获取当前播放进度，返回 (current_time_str, duration_str)。"""
        try:
            current_raw = self.driver.execute_script(
                "var v=document.querySelector('video');"
                "if(!v||!v.duration)return '0:00';"
                "var m=Math.floor(v.currentTime/60);"
                "var s=Math.floor(v.currentTime%60);"
                "return m+':'+(s<10?'0':'')+s;"
            )
            duration_raw = self.driver.execute_script(
                "var v=document.querySelector('video');"
                "if(!v||!v.duration)return '0:00';"
                "var m=Math.floor(v.duration/60);"
                "var s=Math.floor(v.duration%60);"
                "return m+':'+(s<10?'0':'')+s;"
            )
            return current_raw, duration_raw
        except Exception:
            return "0:00", "0:00"

    def get_media_url(self):
        """获取当前视频的媒体流 URL 和浏览器 Cookie。

        通过 JS 注入从 <video> 元素的 src/currentSrc 或 <source> 子元素
        中提取媒体 URL。排除 blob: URL（MSE 流，无法外部下载）。

        Returns:
            (media_url, cookie_header_string) — 如果提取失败返回 ("", "")
        """
        try:
            url = self.driver.execute_script(VIDEO_SRC_EXTRACTION_JS)
        except Exception:
            return "", ""

        if not url:
            return "", ""

        # 构建 Cookie 头
        try:
            cookies = self.driver.get_cookies()
            cookie_str = "; ".join(
                f"{c['name']}={c['value']}" for c in cookies if c.get("name")
            )
        except Exception:
            cookie_str = ""

        return url, cookie_str
