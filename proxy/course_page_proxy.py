from __future__ import annotations

import json
import logging
import random
import time

from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import global_state

logger = logging.getLogger(__name__)


class CoursePageProxy:
    def __init__(self, page):
        self.page = page
        self.bot = page.state["bot"]
        self.role = page.state.get("role", "course")
        self.urls = page.urls
        self._quiz_counter = 0

    @property
    def driver(self):
        return global_state.GLOBAL_DRIVER or self.bot.driver

    def on_page_start(self, page):
        if self.bot.driver is None:
            self.bot.driver = self.bot.create_driver()
            global_state.set_globals(driver=self.bot.driver)
        if self.role == "login":
            self.open(self.pick_url())

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
        time.sleep(seconds)

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

    def should_stop(self) -> bool:
        return self.bot.should_stop()

    def _find_element(self, by, values, timeout=10):
        for value in values:
            try:
                return WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located((by, value))
                )
            except TimeoutException:
                continue
        return None

    def check_login(self):
        self.driver.get(self.bot.base_url)
        time.sleep(3)
        current_url = self.driver.current_url
        logger.info("当前URL: %s", current_url)
        if self.bot.logged_url and self.bot.logged_url in current_url:
            logger.info("已登录，无需重新登录")
            return True
        logger.info("未登录，开始登录流程")
        return False

    def do_login(self):
        time.sleep(2)
        phone_tab = self._find_element(
            By.CSS_SELECTOR,
            ["a.cur[href='#signin']", "#qSignin.cur", "a.cur"],
            timeout=3,
        )
        if not phone_tab:
            phone_tab = self._find_element(
                By.XPATH,
                ["//a[contains(text(),'手机号')]", "//a[@href='#signin']"],
                timeout=3,
            )
        if phone_tab:
            try:
                phone_tab.click()
            except Exception:
                pass
        time.sleep(1)

        username_input = self._find_element(
            By.CSS_SELECTOR,
            ["#lUsername", 'input[name="username"]', 'input[placeholder*="手机号"]'],
            timeout=5,
        )
        if username_input:
            username_input.clear()
            username_input.send_keys(self.bot.username)
        else:
            self._notify_and_wait_captcha("未找到手机号输入框，请手动完成登录后点击“验证码已完成”")

        password_input = self._find_element(
            By.CSS_SELECTOR,
            ["#lPassword", 'input[name="password"]', 'input[type="password"]'],
            timeout=5,
        )
        if password_input:
            password_input.clear()
            password_input.send_keys(self.bot.password)
        else:
            self._notify_and_wait_captcha("未找到密码输入框，请手动完成登录后点击“验证码已完成”")

        login_btn = self._find_element(
            By.CSS_SELECTOR,
            [".wall-sub-btn", "span.wall-sub-btn"],
            timeout=5,
        )
        if not login_btn:
            login_btn = self._find_element(
                By.XPATH,
                ["//span[contains(@class,'wall-sub-btn')]"],
                timeout=3,
            )
        if login_btn:
            self.driver.execute_script("arguments[0].click();", login_btn)
            logger.info("已点击登录按钮，等待验证码")
        else:
            self._notify_and_wait_captcha("未找到登录按钮，请手动登录后点击“验证码已完成”")

        time.sleep(3)
        self._check_and_handle_captcha("登录时出现验证码，请在浏览器中完成")
        self.wait_for_login_success()

    def do_login_upc(self):
        time.sleep(3)
        logger.info("开始数字石大登录")
        try:
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "iframe[src*='login-normal']"))
            )
            frame = self.driver.find_element(By.CSS_SELECTOR, "iframe[src*='login-normal']")
            self.driver.switch_to.frame(frame)
            time.sleep(1)

            js_code = (
                "var app = document.querySelector('#app').__vue__;"
                f"app.username = {json.dumps(self.bot.username)};"
                f"app.password = {json.dumps(self.bot.password)};"
                "app.passwordLogin();"
            )
            self.driver.execute_script(js_code)
            self.driver.switch_to.default_content()
        except Exception as exc:
            try:
                self.driver.switch_to.default_content()
            except Exception:
                pass
            raise exc

        time.sleep(5)
        forward_url = (
            "https://i.upc.edu.cn/dcp/forward.action"
            "?path=dcp/core/appstore/menu/jsp/redirect"
            "&appid=2c4f8d7e62e94fef93dd2f0c3b87a777&ac=3"
        )
        self.driver.get(forward_url)
        time.sleep(5)
        self._check_and_handle_captcha("登录时出现验证码，请在浏览器中完成")
        self.wait_for_login_success()

    def wait_for_login_success(self):
        try:
            WebDriverWait(self.driver, 60).until(
                lambda d: self.bot.logged_url in d.current_url if self.bot.logged_url else True
            )
            logger.info("登录成功")
        except TimeoutException:
            logger.warning("登录等待超时，继续后续流程")

    def _check_and_handle_captcha(self, message="请完成验证码"):
        try:
            iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
            for iframe in iframes:
                src = (iframe.get_attribute("src") or "").lower()
                if any(k in src for k in ["captcha", "yidun", "verify", "necaptcha"]):
                    if iframe.is_displayed():
                        self._notify_and_wait_captcha(message)
                        return True
        except Exception:
            pass

        for sel in [".yidun_popup", ".yidun_modal", ".yidun_popup__content", "#tcaptcha_transform_dy"]:
            try:
                for ele in self.driver.find_elements(By.CSS_SELECTOR, sel):
                    if ele.is_displayed():
                        self._notify_and_wait_captcha(message)
                        return True
            except Exception:
                pass
        return False

    def _notify_and_wait_captcha(self, message):
        logger.warning(message)
        if not self.bot.captcha_event:
            return
        self.bot.captcha_event.set()
        if self.bot.captcha_done_event:
            self.bot.captcha_done_event.clear()
        waited = 0
        while True:
            if self.should_stop():
                logger.info("收到停止信号，取消等待验证码")
                break
            if self.bot.captcha_done_event and self.bot.captcha_done_event.wait(timeout=1):
                break
            waited += 1
            if waited >= 300:
                break
        if self.bot.captcha_done_event:
            self.bot.captcha_done_event.clear()
        self.bot.captcha_event.clear()
        time.sleep(1)

    def navigate_to_course(self):
        logger.info("打开课程页面: %s", self.bot.video_url)
        self.driver.get(self.bot.video_url)
        time.sleep(5)
        self.handle_initial_dialogs()
        self._check_and_handle_captcha("打开课程页时出现验证码，请在浏览器中完成")

    def handle_initial_dialogs(self):
        for _ in range(10):
            found_any = False
            try:
                dialog = self.driver.find_element(By.CSS_SELECTOR, "div.dialog-read")
                if dialog.is_displayed():
                    found_any = True
                    self.close_preschool_dialog()
                    time.sleep(1)
            except NoSuchElementException:
                pass

            quiz = self.find_quiz_dialog()
            if quiz:
                found_any = True
                self.handle_quiz_dialog(quiz)
                time.sleep(1)

            if not found_any:
                break

    def close_preschool_dialog(self):
        try:
            dialog = self.driver.find_element(By.CSS_SELECTOR, "div.dialog-read")
            if not dialog.is_displayed():
                return
            close_btn = self._find_element(
                By.CSS_SELECTOR,
                [".dialog-read i.iconguanbi", ".dialog-read i.iconfont", ".dialog-read .el-dialog__header i"],
                timeout=3,
            )
            if close_btn:
                close_btn.click()
            else:
                self.driver.execute_script(
                    "var d=document.querySelector('.dialog-read');"
                    "var i=d&&d.querySelector('i.iconfont');if(i)i.click();"
                )
            time.sleep(1)
        except Exception:
            return

    def extract_videos(self):
        try:
            all_items = self.driver.find_elements(By.CSS_SELECTOR, "li.video")
        except Exception:
            logger.warning("未找到课程列表")
            return []

        videos = []
        for item in all_items:
            try:
                title_ele = item.find_elements(By.CSS_SELECTOR, ".catalogue_title")
                if not title_ele:
                    continue
                title = title_ele[0].text.strip()
                if not title:
                    continue
                videos.append((title, item))
            except Exception:
                continue
        return videos

    def is_finished(self, item) -> bool:
        try:
            return bool(item.find_elements(By.CSS_SELECTOR, ".time_icofinish"))
        except Exception:
            return False

    def get_unfinished_videos(self):
        return [(title, item) for title, item in self.extract_videos() if not self.is_finished(item)]

    def get_finished_courses(self):
        try:
            all_items = self.driver.find_elements(By.CSS_SELECTOR, "li.video")
        except Exception:
            return []

        finished = []
        for item in all_items:
            try:
                title_ele = item.find_elements(By.CSS_SELECTOR, ".catalogue_title")
                if not title_ele:
                    continue
                title = title_ele[0].text.strip()
                if not title:
                    continue
                if item.find_elements(By.CSS_SELECTOR, ".time_icofinish"):
                    finished.append(title)
            except Exception:
                continue
        return finished

    def click_video(self, video_element, title):
        logger.info("点击课程: %s", title)
        try:
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", video_element)
            time.sleep(0.5)
            try:
                video_element.click()
            except Exception:
                self.driver.execute_script("arguments[0].click();", video_element)
            time.sleep(3)
            self._check_and_handle_captcha(f"切换课程“{title}”时出现验证码，请在浏览器中完成")
            return True
        except Exception as exc:
            logger.warning("点击课程失败: %s (%s)", title, exc)
            return False

    def play_video(self):
        time.sleep(1)
        for sel in [".vjs-big-play-button", "button.vjs-play-control", "#container video"]:
            try:
                btn = WebDriverWait(self.driver, 3).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, sel))
                )
                ActionChains(self.driver).move_to_element(btn).pause(0.2).click().perform()
                time.sleep(1)
                if self.is_video_playing():
                    return True
            except Exception:
                continue
        return False

    def is_video_playing(self):
        try:
            return self.driver.execute_script("var v=document.querySelector('video');return !!(v&&!v.paused&&!v.ended);")
        except Exception:
            return False

    def is_video_ended(self):
        try:
            return self.driver.execute_script("var v=document.querySelector('video');return !!(v&&v.ended);")
        except Exception:
            return False

    def get_video_progress(self):
        try:
            current_raw = self.driver.execute_script(
                "var v=document.querySelector('video');"
                "if(!v||!v.duration)return '0:00';"
                "var m=Math.floor(v.currentTime/60);var s=Math.floor(v.currentTime%60);"
                "return m+':'+(s<10?'0':'')+s;"
            )
            duration_raw = self.driver.execute_script(
                "var v=document.querySelector('video');"
                "if(!v||!v.duration)return '0:00';"
                "var m=Math.floor(v.duration/60);var s=Math.floor(v.duration%60);"
                "return m+':'+(s<10?'0':'')+s;"
            )
            return current_raw, duration_raw
        except Exception:
            return "0:00", "0:00"

    def get_video_duration_seconds(self):
        try:
            return float(
                self.driver.execute_script("var v=document.querySelector('video');return (v&&v.duration)||0;")
            )
        except Exception:
            return 0.0

    def find_quiz_dialog(self):
        """Find visible quiz dialog, return WebElement or None."""
        # Strategy A: preferred selector from dev branch.
        try:
            dialogs = self.driver.find_elements(By.CSS_SELECTOR, "div.el-dialog[aria-label*='??']")
            for d in dialogs:
                if d.is_displayed():
                    logger.info(
                        "[QUIZ-DETECT] matched selector=aria-label*??, aria-label=%s class=%s",
                        d.get_attribute("aria-label"),
                        d.get_attribute("class"),
                    )
                    return d
        except Exception:
            pass

        # Strategy B: fallback by aria-label keywords.
        try:
            dialogs = self.driver.find_elements(By.CSS_SELECTOR, "div.el-dialog")
            for d in dialogs:
                if not d.is_displayed():
                    continue
                label = d.get_attribute("aria-label") or ""
                if any(k in label for k in ["??", "??", "??"]):
                    logger.info(
                        "[QUIZ-DETECT] matched fallback=aria-label keyword, aria-label=%s class=%s",
                        label,
                        d.get_attribute("class"),
                    )
                    return d
        except Exception:
            pass

        # Strategy C: fallback by structure to avoid text-encoding issues.
        try:
            dialogs = self.driver.find_elements(By.CSS_SELECTOR, "div.el-dialog")
            for d in dialogs:
                if not d.is_displayed():
                    continue
                has_topic = bool(d.find_elements(By.CSS_SELECTOR, ".topic-item"))
                has_next = bool(d.find_elements(By.CSS_SELECTOR, ".btn-next"))
                if has_topic or has_next:
                    logger.info(
                        "[QUIZ-DETECT] matched fallback=structure, has_topic=%s has_next=%s class=%s",
                        has_topic,
                        has_next,
                        d.get_attribute("class"),
                    )
                    return d
        except Exception:
            pass

        logger.debug("[QUIZ-DETECT] no visible quiz dialog found")
        return None

    def _answer_current_question(self, dialog):
        """Answer the currently displayed question inside the quiz dialog.
        Returns True if an option was selected, False otherwise."""
        options = dialog.find_elements(By.CSS_SELECTOR, ".topic-item")
        if not options:
            options = dialog.find_elements(
                By.XPATH, ".//li[contains(@class,'topic-item')]"
            )

        if not options:
            logger.info("[QUIZ-ANSWER] no option found")
            return False

        choice = random.choice(options)
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
            logger.info("[QUIZ-ANSWER] option clicked")
        else:
            logger.warning("[QUIZ-ANSWER] option click failed")
            return False

        # Verify at least one option is selected
        time.sleep(0.5)
        for _ in range(5):
            active_opts = dialog.find_elements(
                By.CSS_SELECTOR, ".topic-option-item.active"
            )
            if not active_opts:
                active_opts = dialog.find_elements(
                    By.CSS_SELECTOR, ".item-topic.active"
                )
            if active_opts:
                logger.info("[QUIZ-ANSWER] selected confirmed, active_count=%d", len(active_opts))
                return True
            try:
                random.choice(options).click()
            except Exception:
                pass
            time.sleep(0.5)

        logger.warning("[QUIZ-ANSWER] selected not confirmed")
        return False

    def _close_quiz_dialog(self, dialog):
        """Close the quiz dialog via various fallback strategies.
        Returns True if closed successfully."""
        close_selectors = [
            ".el-dialog__headerbtn",
            ".el-dialog__close",
            "button[aria-label='Close']",
        ]
        for sel in close_selectors:
            try:
                close_btn = dialog.find_element(By.CSS_SELECTOR, sel)
                if close_btn.is_displayed():
                    close_btn.click()
                    logger.info("[QUIZ-CLOSE] closed by selector=%s", sel)
                    time.sleep(1)
                    return True
            except Exception:
                continue

        try:
            footer_btn = dialog.find_element(
                By.XPATH,
                ".//div[contains(@class,'dialog-footer')]//div[contains(@class,'btn')]"
            )
            footer_btn.click()
            logger.info("[QUIZ-CLOSE] closed by footer button")
            time.sleep(1)
            return True
        except Exception:
            pass

        try:
            footer_btn = dialog.find_element(
                By.XPATH, ".//div[@class='btn'][contains(text(),'??')]"
            )
            footer_btn.click()
            logger.info("[QUIZ-CLOSE] closed by footer text button")
            time.sleep(1)
            return True
        except Exception:
            pass

        logger.warning("[QUIZ-CLOSE] close failed")
        return False

    def handle_quiz_dialog(self, dialog):
        """Handle a multi-question quiz popup: answer each question, click next
        after each answer, then close the dialog after the last question."""
        try:
            question_index = 0
            while True:
                # Re-locate dialog each round to avoid stale references after next-page switch.
                current_dialog = self.find_quiz_dialog() or dialog

                question_index += 1
                logger.info("[QUIZ-HANDLE] question_index=%d", question_index)

                self._answer_current_question(current_dialog)
                time.sleep(0.5)

                # Check if there is a next question
                try:
                    next_btn = current_dialog.find_element(By.CSS_SELECTOR, ".btn-next")
                    if next_btn.is_enabled() and next_btn.is_displayed():
                        logger.info(
                            "[QUIZ-NEXT] clickable selector=.btn-next class=%s text=%s",
                            next_btn.get_attribute("class"),
                            (next_btn.text or "").strip(),
                        )
                        try:
                            next_btn.click()
                        except Exception:
                            logger.warning("[QUIZ-NEXT] native click failed, use js click")
                            self.driver.execute_script("arguments[0].click();", next_btn)
                        time.sleep(1)
                        continue
                except Exception:
                    logger.info("[QUIZ-NEXT] next button not available, treat as last question")

                # Last question, close dialog.
                return self._close_quiz_dialog(current_dialog)

        except Exception as e:
            logger.error("[QUIZ-HANDLE] error: %s", e)
            return False

    def monitor_and_wait_for_video(self, title):
        logger.info("开始监控视频: %s", title)
        max_wait = 3600
        check_interval = 2
        captcha_check_interval = 30
        elapsed = 0
        last_captcha_check = -captcha_check_interval

        if not self.is_video_playing():
            self.play_video()
            time.sleep(2)

        while elapsed < max_wait:
            if self.should_stop():
                logger.info("收到停止信号，退出视频监控")
                return False

            quiz_dialog = self.find_quiz_dialog()
            if quiz_dialog:
                self._quiz_counter += 1
                logger.info("处理第%d个弹题", self._quiz_counter)
                self.handle_quiz_dialog(quiz_dialog)
                time.sleep(1)
                if not self.is_video_playing() and not self.is_video_ended():
                    self.play_video()
                continue

            if elapsed - last_captcha_check >= captcha_check_interval:
                last_captcha_check = elapsed
                if self._check_and_handle_captcha("视频播放中出现验证码，请在浏览器中完成"):
                    if not self.is_video_playing() and not self.is_video_ended():
                        self.play_video()
                    continue

            if self.is_video_ended():
                current, duration = self.get_video_progress()
                logger.info("视频播放完毕: %s (%s/%s)", title, current, duration)
                return True

            if elapsed % 30 == 0:
                current, duration = self.get_video_progress()
                logger.info("进度: %s/%s (已监控 %ds)", current, duration, elapsed)

            if elapsed > 0 and elapsed % 10 == 0:
                if not self.is_video_playing() and not self.is_video_ended():
                    self.play_video()

            time.sleep(check_interval)
            elapsed += check_interval

            if self.is_video_playing():
                try:
                    self.bot.add_realtime_seconds(check_interval)
                except Exception:
                    pass

        logger.warning("视频监控超时: %s", title)
        return False

    def show_completion_report(self, count):
        logger.info("=" * 50)
        logger.info("本次运行完成，已完成视频数量: %d", count)
        logger.info("=" * 50)
