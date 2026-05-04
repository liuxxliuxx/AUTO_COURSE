import logging
import random
import shutil
import time

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

from database import Database

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


class ZhiHuiShuBot:
    def __init__(self, base_url, username, password,
                 logged_url, video_url, login_method="zhihuishu",
                 time_limit_minutes=0,
                 captcha_event=None, captcha_done_event=None,
                 stop_event=None):
        self.driver = None
        self.db = Database()
        self.wait = None
        self.base_url = base_url
        self.username = username
        self.password = password
        self.logged_url = logged_url
        self.video_url = video_url
        self.login_method = login_method  # "zhihuishu" or "upc"
        self.time_limit_seconds = (time_limit_minutes or 0) * 60
        self.total_watched_seconds = 0
        self._captcha_event = captcha_event
        self._captcha_done = captcha_done_event
        self._stop_event = stop_event

    def _should_stop(self):
        """Check if stop was requested by GUI."""
        return self._stop_event and self._stop_event.is_set()

    # ---------- browser setup ----------

    def _create_driver(self):
        options = Options()
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-infobars")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)
        options.add_argument("--start-maximized")

        # Additional stealth
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-dev-shm-usage")

        prefs = {
            "credentials_enable_service": False,
            "profile.password_manager_enabled": False,
        }
        options.add_experimental_option("prefs", prefs)
        chromedriver_path = shutil.which("chromedriver")
        if chromedriver_path:
            service = Service(chromedriver_path)
        else:
            service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(options=options, service=service)
        driver.execute_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        return driver

    # ---------- login ----------

    def _find_element(self, by, values, timeout=10):
        """Try multiple selector values, return the first match."""
        for value in values:
            try:
                el = WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located((by, value))
                )
                logger.debug("Found element: %s=%s", by, value)
                return el
            except TimeoutException:
                continue
        return None

    def check_login(self):
        """Check if already logged in by comparing current URL to logged_URL."""
        self.driver.get(self.base_url)
        time.sleep(3)
        current_url = self.driver.current_url
        logger.info("当前 URL: %s", current_url)
        if self.logged_url and self.logged_url in current_url:
            logger.info("已登录，无需重新登录")
            return True
        logger.info("未登录，开始登录流程")
        return False

    def do_login(self):
        """Perform login with CAPTCHA handling."""
        time.sleep(2)

        # --- 1. Ensure we are on the phone-login tab ("手机号") ---
        phone_tab = self._find_element(
            By.CSS_SELECTOR,
            ["a.cur[href='#signin']", "#qSignin.cur", "a.cur"],
            timeout=3,
        )
        if not phone_tab:
            # Try clicking "手机号" tab link
            phone_tab = self._find_element(
                By.XPATH,
                ["//a[contains(text(),'手机号')]", "//a[@href='#signin']"],
                timeout=3,
            )
        if phone_tab:
            try:
                phone_tab.click()
                logger.info("已切换到手机号登录")
            except Exception:
                pass
        time.sleep(1)

        # --- 2. Fill username (phone number) ---
        username_input = self._find_element(
            By.CSS_SELECTOR,
            ["#lUsername", 'input[name="username"]', 'input[placeholder*="手机号"]'],
            timeout=5,
        )
        if username_input:
            username_input.clear()
            username_input.send_keys(self.username)
            logger.info("已填入账号")
        else:
            logger.error("未找到手机号输入框")
            self._notify_and_wait_captcha("未找到手机号输入框，请在浏览器中手动完成登录，然后点击GUI的'确认验证码已完成'按钮")

        # --- 3. Fill password ---
        password_input = self._find_element(
            By.CSS_SELECTOR,
            ["#lPassword", 'input[name="password"]', 'input[type="password"]'],
            timeout=5,
        )
        if password_input:
            password_input.clear()
            password_input.send_keys(self.password)
            logger.info("已填入密码")
        else:
            logger.error("未找到密码输入框")
            self._notify_and_wait_captcha("未找到密码输入框，请在浏览器中手动完成登录，然后点击GUI的'确认验证码已完成'按钮")

        # --- 4. Click login button ---
        # The login button is <span class="wall-sub-btn" onclick="imgSlidePop(...)">登&nbsp;&nbsp;录</span>
        time.sleep(1)
        login_btn = self._find_element(
            By.CSS_SELECTOR,
            [".wall-sub-btn", "span.wall-sub-btn"],
            timeout=5,
        )
        if not login_btn:
            login_btn = self._find_element(
                By.XPATH,
                [
                    "//span[contains(@class,'wall-sub-btn')]",
                    "//span[contains(text(),'登') and contains(@class,'wall')]",
                ],
                timeout=3,
            )

        if login_btn:
            # Click via JavaScript to avoid interactability issues
            self.driver.execute_script("arguments[0].click();", login_btn)
            logger.info("已点击登录按钮，等待滑块验证码出现...")
        else:
            logger.error("未找到登录按钮")
            self._notify_and_wait_captcha("未找到登录按钮，请在浏览器中手动点击登录并完成验证，然后点击GUI的'确认验证码已完成'按钮")

        # --- 5. Handle CAPTCHA after clicking login ---
        # The imgSlidePop() call shows a NetEase Yidun slider CAPTCHA.
        # Wait a moment for it to appear, then notify user via GUI.
        time.sleep(3)
        self._check_and_handle_captcha("登录时出现滑块验证码，请在浏览器中完成滑动验证")

        # --- 6. Wait for login redirect ---
        try:
            WebDriverWait(self.driver, 60).until(
                lambda d: self.logged_url in d.current_url
                if self.logged_url
                else True
            )
            logger.info("登录成功")
        except TimeoutException:
            # Maybe CAPTCHA needs re-handling
            logger.warning("等待登录跳转超时，再次检查验证码...")
            self._check_and_handle_captcha("登录仍在等待验证，请完成验证码")
            try:
                WebDriverWait(self.driver, 30).until(
                    lambda d: self.logged_url in d.current_url
                    if self.logged_url
                    else True
                )
                logger.info("登录成功")
            except TimeoutException:
                logger.warning("登录后未检测到 logged_URL，但继续执行")

    def do_login_upc(self):
        """Login via 数字石大 (UPC) SSO portal."""
        import json

        time.sleep(3)
        logger.info("CAS 页面 URL: %s", self.driver.current_url)

        try:
            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "iframe[src*='login-normal']")
                )
            )
            self.driver.switch_to.frame(
                self.driver.find_element(By.CSS_SELECTOR, "iframe[src*='login-normal']")
            )
            time.sleep(2)

            js_code = (
                "var app = document.querySelector('#app').__vue__;"
                "app.username = %s;"
                "app.password = %s;"
                "app.passwordLogin();"
            ) % (json.dumps(self.username), json.dumps(self.password))
            self.driver.execute_script(js_code)
            logger.info("已通过 JS 注入凭据并触发登录，等待跳转...")

            self.driver.switch_to.default_content()
        except (TimeoutException, NoSuchElementException) as e:
            logger.error("CAS 登录表单操作失败: %s", e)
            try:
                self.driver.switch_to.default_content()
            except Exception:
                pass
            raise

        # --- Wait for SSO redirect, then navigate to app ---
        time.sleep(5)
        forward_url = (
            "https://i.upc.edu.cn/dcp/forward.action"
            "?path=dcp/core/appstore/menu/jsp/redirect"
            "&appid=2c4f8d7e62e94fef93dd2f0c3b87a777&ac=3"
        )
        logger.info("正在跳转到应用页面...")
        self.driver.get(forward_url)
        time.sleep(5)

        # --- Handle CAPTCHA if any ---
        self._check_and_handle_captcha("登录时出现验证码，请完成验证")

        # --- Wait for redirect to logged_URL ---
        try:
            WebDriverWait(self.driver, 60).until(
                lambda d: self.logged_url in d.current_url
                if self.logged_url
                else True
            )
            logger.info("登录成功")
        except TimeoutException:
            logger.warning("等待登录跳转超时，再次检查验证码...")
            self._check_and_handle_captcha("登录仍在等待验证，请完成验证码")
            try:
                WebDriverWait(self.driver, 30).until(
                    lambda d: self.logged_url in d.current_url
                    if self.logged_url
                    else True
                )
                logger.info("登录成功")
            except TimeoutException:
                logger.warning("登录后未检测到 logged_URL，但继续执行")

    def _check_and_handle_captcha(self, message="请完成验证码"):
        """Check if CAPTCHA is present on the page and notify user if so.
        Only looks for ACTIVE captcha elements (iframes, visible popups) —
        NOT permanent hidden containers like #captchaYidun which are always in the DOM.
        """
        # ---- Primary check: active iframes (most reliable) ----
        try:
            iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
            for iframe in iframes:
                try:
                    src = iframe.get_attribute("src") or ""
                    if any(
                        kw in src.lower()
                        for kw in [
                            "captcha", "yidun", "turing", "cstaticdun",
                            "necaptcha", "verify",
                        ]
                    ):
                        if iframe.is_displayed():
                            logger.info("检测到验证码 iframe: %s", src)
                            self._notify_and_wait_captcha(message)
                            return True
                except Exception:
                    pass
        except Exception:
            pass

        # ---- Secondary: visible CAPTCHA popup elements ----
        popup_selectors = [
            ".yidun_popup",
            ".yidun_modal",
            ".yidun_popup__content",
            "#tcaptcha_transform_dy",
            "#lPwdError",
        ]
        for sel in popup_selectors:
            try:
                els = self.driver.find_elements(By.CSS_SELECTOR, sel)
                for e in els:
                    try:
                        if e.is_displayed() and e.size.get("width", 0) > 10:
                            logger.info("检测到验证码弹窗: %s", sel)
                            self._notify_and_wait_captcha(message)
                            return True
                    except Exception:
                        pass
            except Exception:
                pass

        # ---- Login page: image CAPTCHA (visible text input) ----
        try:
            captcha_input = self.driver.find_element(By.ID, "j-captcha-mobile")
            if captcha_input.is_displayed():
                logger.info("检测到登录页图片验证码输入框")
                self._notify_and_wait_captcha(message)
                return True
        except Exception:
            pass

        return False

    def _notify_and_wait_captcha(self, message):
        """Signal the GUI that a CAPTCHA needs user attention, then block until confirmed."""
        logger.warning(message)
        if self._captcha_event:
            self._captcha_event.set()
            self._captcha_done.clear()
            # Poll every 1s so stop_event can interrupt
            waited = 0
            while not self._captcha_done.wait(timeout=1):
                if self._should_stop():
                    logger.info("收到停止信号，放弃等待验证码")
                    self._captcha_done.clear()
                    self._captcha_event.clear()
                    return
                waited += 1
                if waited >= 300:
                    break
            self._captcha_done.clear()
            self._captcha_event.clear()
        logger.info("用户确认验证码已处理，继续运行")
        time.sleep(2)

    # ---------- course navigation ----------

    def navigate_to_course(self):
        """Navigate to the video course page."""
        logger.info("正在访问课程页面: %s", self.video_url)
        self.driver.get(self.video_url)
        time.sleep(5)

        # Handle initial dialogs that may appear simultaneously
        self._handle_initial_dialogs()

        self._check_and_handle_captcha("访问课程页面时出现验证码，请完成验证")

    def _handle_initial_dialogs(self):
        """Cross-detect and handle dialogs that appear on first page load.
        Alternates between checking 学前必读 and quiz dialogs —
        regardless of whether a close attempt succeeded, always moves on
        to the next check to avoid getting stuck on one type."""
        for attempt in range(10):
            found_any = False

            # --- Check 1: 学前必读 dialog ---
            try:
                dialog = self.driver.find_element(By.CSS_SELECTOR, "div.dialog-read")
                if dialog.is_displayed():
                    found_any = True
                    logger.info("检测到'学前必读'弹窗（第%d次尝试）", attempt + 1)
                    self._close_preschool_dialog()
                    time.sleep(1)
            except NoSuchElementException:
                pass

            # --- Check 2: quiz dialog (always runs, even if 学前必读 was just handled) ---
            quiz = self.find_quiz_dialog()
            if quiz:
                found_any = True
                logger.info("检测到弹题测验（第%d次尝试）", attempt + 1)
                self.handle_quiz_dialog(quiz)
                time.sleep(1)

            if not found_any:
                logger.debug("初始弹窗已全部处理完毕（经过%d次检查）", attempt + 1)
                break
        else:
            logger.warning("初始弹窗处理循环达到上限，继续执行")

    def _close_preschool_dialog(self):
        """Close the '学前必读' (Pre-study Reading) dialog if present."""
        try:
            dialog = self.driver.find_element(By.CSS_SELECTOR, "div.dialog-read")
            if dialog.is_displayed():
                logger.info("检测到'学前必读'弹窗，正在关闭...")
                # Click the close icon: <i class="iconfont iconguanbi">
                close_btn = self._find_element(
                    By.CSS_SELECTOR,
                    [
                        ".dialog-read i.iconguanbi",
                        ".dialog-read i.iconfont",
                        ".dialog-read .el-dialog__header i",
                    ],
                    timeout=3,
                )
                if close_btn:
                    close_btn.click()
                    logger.info("已关闭'学前必读'弹窗")
                else:
                    # Fallback: click the X via JavaScript on the dialog
                    self.driver.execute_script(
                        "var d=document.querySelector('.dialog-read');"
                        "var i=d&&d.querySelector('i.iconfont');"
                        "if(i)i.click();"
                    )
                    logger.info("已通过JS关闭'学前必读'弹窗")
                time.sleep(2)
        except NoSuchElementException:
            logger.debug("未检测到'学前必读'弹窗")
        except Exception as e:
            logger.debug("处理'学前必读'弹窗时出错（可能不存在）: %s", e)

    def get_unfinished_videos(self):
        """Return a list of WebElements for unfinished course videos.
        Only includes actual video items (li.video with catalogue_title, not small-lesson).
        Excludes items that have time_icofinish (already completed).
        Also excludes items already marked in the database.
        """
        # Find all video list items
        try:
            all_items = self.driver.find_elements(By.CSS_SELECTOR, "li.video")
        except Exception:
            logger.warning("未找到课程列表项")
            return []

        unfinished = []
        for item in all_items:
            try:
                # Skip if it's a small-lesson header (has no video)
                small_lesson = item.find_elements(By.CSS_SELECTOR, ".small-lesson")
                if small_lesson:
                    continue

                # Must have a catalogue_title
                title_el = item.find_elements(By.CSS_SELECTOR, ".catalogue_title")
                if not title_el:
                    continue

                title = title_el[0].text.strip()
                if not title:
                    continue

                # Skip if already completed (has time_icofinish)
                finished = item.find_elements(By.CSS_SELECTOR, ".time_icofinish")
                if finished:
                    logger.debug("已完成（页面标记）: %s", title)
                    continue

                unfinished.append((title, item))
                logger.info("待学习: %s", title)
            except Exception as e:
                logger.debug("解析课程项出错: %s", e)
                continue

        return unfinished

    def click_video(self, video_element, title):
        """Click a video item in the sidebar to load it."""
        logger.info("点击课程: %s", title)
        try:
            # Scroll into view
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block: 'center'});", video_element
            )
            time.sleep(0.5)
            video_element.click()
            time.sleep(3)

            # Check for CAPTCHA after clicking
            self._check_and_handle_captcha(f"切换课程'{title}'时出现验证码，请完成验证")
            return True
        except Exception as e:
            logger.error("点击课程失败 '%s': %s", title, e)
            return False

    # ---------- video playback ----------

    def play_video(self):
        """Click the play button using native WebDriver clicks (no JS injection)."""
        # Wait for the video player to fully initialize
        time.sleep(2)

        # --- Strategy 1: Click the big play button via ActionChains ---
        play_selectors = [
            ".vjs-big-play-button",
            ".playButton .bigPlayButton",
            "#playButton .bigPlayButton",
        ]
        for sel in play_selectors:
            try:
                btn = WebDriverWait(self.driver, 5).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, sel))
                )
                # Scroll into the player area naturally
                self.driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center',behavior:'auto'});",
                    btn,
                )
                time.sleep(0.3)
                # Use ActionChains for human-like click
                ActionChains(self.driver).move_to_element(btn).pause(0.2).click().perform()
                time.sleep(1)
                if self.is_video_playing():
                    logger.info("已通过ActionChains点击播放: %s", sel)
                    return True
            except TimeoutException:
                continue
            except Exception as e:
                logger.debug("ActionChains未成功 (%s): %s", sel, e)
                continue

        # --- Strategy 2: Click the control-bar play button ---
        try:
            ctrl_btn = WebDriverWait(self.driver, 3).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "button.vjs-play-control"))
            )
            ActionChains(self.driver).move_to_element(ctrl_btn).pause(0.2).click().perform()
            time.sleep(1)
            if self.is_video_playing():
                logger.info("已通过控制栏播放按钮播放")
                return True
        except Exception:
            pass

        # --- Strategy 3: Click the video element itself ---
        try:
            video_el = WebDriverWait(self.driver, 3).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "video"))
            )
            ActionChains(self.driver).move_to_element(video_el).click().perform()
            time.sleep(1)
            if self.is_video_playing():
                logger.info("已通过点击video元素播放")
                return True
        except Exception:
            pass

        # --- Strategy 4: Plain Selenium click as last resort ---
        for sel in [".vjs-big-play-button", "button.vjs-play-control", "#container video"]:
            try:
                btn = WebDriverWait(self.driver, 3).until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, sel))
                )
                btn.click()
                time.sleep(1)
                if self.is_video_playing():
                    logger.info("已通过Selenium click播放: %s", sel)
                    return True
            except Exception:
                continue

        logger.warning("未能点击播放按钮")
        return False

    def is_video_playing(self):
        """Check if video is currently playing."""
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');return v&&!v.paused&&!v.ended;"
            )
        except Exception:
            return False

    def _get_video_duration_seconds(self):
        """Get the current video's total duration in seconds."""
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');return v&&v.duration||0;"
            )
        except Exception:
            return 0

    def is_video_ended(self):
        """Check if the current video has ended."""
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');return v&&v.ended;"
            )
        except Exception:
            return False

    def get_video_progress(self):
        """Get current video progress as (current_time_str, duration_str).
        Reads directly from the <video> element via JS for accuracy."""
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

    # ---------- quiz handling ----------

    def find_quiz_dialog(self):
        """Find visible quiz (弹题测验) dialog, return WebElement or None."""
        try:
            dialogs = self.driver.find_elements(
                By.CSS_SELECTOR, "div.el-dialog[aria-label*='弹题']"
            )
            for d in dialogs:
                if d.is_displayed():
                    return d
        except Exception:
            pass

        # Fallback: look for open el-dialog with quiz content
        try:
            dialogs = self.driver.find_elements(By.CSS_SELECTOR, "div.el-dialog")
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

    def _answer_current_question(self, dialog):
        """Answer the currently displayed question inside the quiz dialog.
        Returns True if an option was selected, False otherwise."""
        options = dialog.find_elements(By.CSS_SELECTOR, ".topic-item")
        if not options:
            options = dialog.find_elements(
                By.XPATH, ".//li[contains(@class,'topic-item')]"
            )

        if not options:
            logger.info("未找到弹题选项")
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
            logger.info("已点击弹题选项")
        else:
            logger.warning("无法点击弹题选项")
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
                logger.info("确认选项已被选中（%d个active元素）", len(active_opts))
                return True
            # Retry clicking
            try:
                random.choice(options).click()
            except Exception:
                pass
            time.sleep(0.5)

        logger.warning("未检测到选项被选中")
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
                    logger.info("已关闭弹题对话框")
                    time.sleep(1)
                    return True
            except Exception:
                continue

        # Second pass: try buttons inside the dialog footer
        try:
            footer_btn = dialog.find_element(
                By.XPATH,
                ".//div[contains(@class,'dialog-footer')]//div[contains(@class,'btn')]"
            )
            footer_btn.click()
            logger.info("已通过底部按钮关闭弹题")
            time.sleep(1)
            return True
        except Exception:
            pass

        try:
            footer_btn = dialog.find_element(
                By.XPATH, ".//div[@class='btn'][contains(text(),'关闭')]"
            )
            footer_btn.click()
            logger.info("已通过底部'关闭'按钮关闭弹题")
            time.sleep(1)
            return True
        except Exception:
            pass

        logger.warning("未能关闭弹题对话框")
        return False

    def handle_quiz_dialog(self, dialog):
        """Handle a multi-question quiz popup: answer each question, click next
        after each answer, then close the dialog after the last question."""
        try:
            question_index = 0
            while True:
                question_index += 1
                logger.info("处理弹题第 %d 题", question_index)

                # --- Step 1: Answer the current question ---
                self._answer_current_question(dialog)
                time.sleep(0.5)

                # --- Step 2: Check if there is a next question ---
                try:
                    next_btn = dialog.find_element(By.CSS_SELECTOR, ".btn-next")
                    if next_btn.is_enabled() and next_btn.is_displayed():
                        logger.info("点击右箭头进入下一题")
                        next_btn.click()
                        time.sleep(1)
                        continue
                except Exception:
                    pass

                # No enabled next button → last question, close the dialog
                break

            # --- Step 3: Close the dialog ---
            return self._close_quiz_dialog(dialog)

        except Exception as e:
            logger.error("处理弹题时出错: %s", e)
            return False

    # ---------- main monitoring loop ----------

    def monitor_and_wait_for_video(self, title):
        """
        Monitor video playback:
        - Detect and handle quiz popups (frequent polling)
        - Detect and handle CAPTCHA (infrequent polling to avoid false positives)
        - Wait for video to end
        """
        logger.info("开始监控视频播放: %s", title)
        max_wait = 3600  # Max 60 minutes per video
        check_interval = 2
        captcha_check_interval = 30  # Only check CAPTCHA every 30s
        elapsed = 0
        last_captcha_check = -captcha_check_interval

        # Ensure video is playing
        if not self.is_video_playing():
            self.play_video()
            time.sleep(2)
            if not self.is_video_playing():
                self.play_video()
                time.sleep(3)

        while elapsed < max_wait:
            # 0. Check stop signal
            if self._should_stop():
                logger.info("收到停止信号，退出视频监控")
                return False

            # 1. Check for quiz popups (frequent)
            quiz_dialog = self.find_quiz_dialog()
            if quiz_dialog:
                logger.info("检测到弹题测验")
                self.handle_quiz_dialog(quiz_dialog)
                # After closing quiz, ensure video is still playing
                time.sleep(1)
                if not self.is_video_playing() and not self.is_video_ended():
                    self.play_video()
                continue

            # 2. Check for CAPTCHA (infrequent — every 30s)
            if elapsed - last_captcha_check >= captcha_check_interval:
                last_captcha_check = elapsed
                if self._check_and_handle_captcha("视频播放过程中出现验证码，请完成验证"):
                    time.sleep(2)
                    if not self.is_video_playing() and not self.is_video_ended():
                        self.play_video()
                    continue

            # 3. Check if video ended
            if self.is_video_ended():
                current, duration = self.get_video_progress()
                logger.info("视频播放完毕: %s (%s/%s)", title, current, duration)
                return True

            # 4. Ensure video stays playing (zhihuishu may auto-pause)
            if elapsed > 0 and elapsed % 10 == 0:
                if not self.is_video_playing() and not self.is_video_ended():
                    logger.debug("视频已暂停，尝试恢复播放")
                    self.play_video()

            # 5. Log progress periodically
            if elapsed % 30 == 0:
                current, duration = self.get_video_progress()
                logger.info("进度: %s/%s (已监控 %ds)", current, duration, elapsed)

            time.sleep(check_interval)
            elapsed += check_interval

        logger.warning("视频监控超时: %s", title)
        return False

    # ---------- main flow ----------

    def run(self):
        """Main entry point."""
        logger.info("=" * 50)
        logger.info("智慧树自动刷课脚本启动")
        logger.info("=" * 50)

        try:
            # 1. Initialize browser
            logger.info("正在启动浏览器...")
            self.driver = self._create_driver()
            logger.info("正在...")
            self.wait = WebDriverWait(self.driver, 10)
            logger.info("浏览器已启动")

            # 3. Check login / perform login
            if not self.check_login():
                if self.login_method == "upc":
                    self.do_login_upc()
                else:
                    self.do_login()

            # 4. Navigate to course page
            self.navigate_to_course()

            # 5. Get unfinished videos
            unfinished = self.get_unfinished_videos()
            if not unfinished:
                logger.info("所有课程已完成！")
                self._show_completion_report(0)
                return

            logger.info("共发现 %d 个未完成课程视频", len(unfinished))

            # 6. Process each video
            completed_this_run = 0
            for idx, (title, video_el) in enumerate(unfinished, 1):
                if self._should_stop():
                    logger.info("收到停止信号，停止处理后续课程")
                    break

                logger.info("=" * 40)
                logger.info("[%d/%d] 正在处理: %s", idx, len(unfinished), title)

                # Click the video in sidebar — retry with dialog handling on failure
                retry_count = 0
                while not self.click_video(video_el, title):
                    if self._should_stop():
                        break
                    retry_count += 1
                    logger.warning(
                        "点击课程失败（第%d次重试），执行交叉检测弹窗: %s",
                        retry_count, title,
                    )
                    self._handle_initial_dialogs()
                    time.sleep(1)
                if self._should_stop():
                    break

                # Play and monitor
                success = self.monitor_and_wait_for_video(title)

                # Accumulate watched duration
                video_dur = self._get_video_duration_seconds()
                self.total_watched_seconds += video_dur
                dur_min = int(video_dur // 60)
                dur_sec = int(video_dur % 60)
                total_min = int(self.total_watched_seconds // 60)
                total_sec = int(self.total_watched_seconds % 60)
                logger.info(
                    "本视频时长: %d分%d秒 | 累计观看: %d分%d秒",
                    dur_min, dur_sec, total_min, total_sec,
                )

                if success:
                    completed_this_run += 1
                    logger.info("已完成课程: %s", title)
                else:
                    logger.warning("课程超时，仍计入完成: %s", title)
                    completed_this_run += 1

                # Check time limit
                if self.time_limit_seconds > 0 and self.total_watched_seconds >= self.time_limit_seconds:
                    limit_min = self.time_limit_seconds // 60
                    logger.info(
                        "已达到刷课时长上限 %d 分钟（累计 %d分%d秒），停止刷课",
                        limit_min, total_min, total_sec,
                    )
                    break

                # Short pause between videos
                time.sleep(3)

            # 7. Report
            self._show_completion_report(completed_this_run)

        except KeyboardInterrupt:
            logger.info("用户中断脚本")
        except Exception as e:
            logger.error("脚本运行出错: %s", e, exc_info=True)
        finally:
            if self.driver:
                logger.info("正在关闭浏览器...")
                self.driver.quit()
            self.db.close()
            logger.info("脚本已退出")

    def _show_completion_report(self, count):
        logger.info("=" * 50)
        logger.info("本次运行完成 %d 个课程视频", count)
        logger.info("=" * 50)
