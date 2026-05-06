"""
Bot 主编排器 —— 组合各子模块，实现完整的刷课主循环。

职责：协调浏览器、登录、课程导航、视频播放、弹题、验证码等模块，
     按顺序执行刷课流程，并负责进度累计和时长控制。
"""

import logging
import time

from selenium.webdriver.support.ui import WebDriverWait

from src.bot.browser import create_driver
from src.bot.captcha import CaptchaHandler
from src.bot.course import CourseNavigator
from src.bot.login.upc import UPCLogin
from src.bot.login.zhihuishu import ZhihuishuLogin
from src.bot.quiz import QuizHandler
from src.bot.video import VideoController
from src.constants import (
    EXTRA_LONG_SLEEP,
    LONG_SLEEP,
    MEDIUM_SLEEP,
    VIDEO_MONITOR_CAPTCHA_INTERVAL,
    VIDEO_MONITOR_CHECK_INTERVAL,
    VIDEO_MONITOR_MAX_WAIT,
    WAIT_DEFAULT,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


class ZhiHuiShuBot:
    """刷课 Bot 主编排器。

    输入：账号密码、URL、登录方式、时长限制、线程事件
    输出：通过 logging 输出运行日志，通过 threading.Event 通知 GUI 验证码状态
    """

    def __init__(
        self,
        base_url,
        username,
        password,
        logged_url,
        video_url,
        login_method="zhihuishu",
        time_limit_minutes=0,
        skip_completed=True,
        captcha_event=None,
        captcha_done_event=None,
        stop_event=None,
        chrome_binary=None,
        chromedriver_binary=None,
    ):
        self.base_url = base_url
        self.username = username
        self.password = password
        self.logged_url = logged_url
        self.video_url = video_url
        self.login_method = login_method
        self.time_limit_seconds = (time_limit_minutes or 0) * 60
        self.skip_completed = skip_completed
        self.chrome_binary = chrome_binary
        self.chromedriver_binary = chromedriver_binary
        self.total_watched_seconds = 0
        self._last_monitor_elapsed = 0

        self._captcha_event = captcha_event
        self._captcha_done = captcha_done_event
        self._stop_event = stop_event

        # 子模块实例（run() 中初始化，因为需要先创建 driver）
        self.driver = None
        self.wait = None
        self.captcha = None
        self.quiz = None
        self.video = None
        self.course = None
        self.login_strategy = None

        # --- Hook 回调（供外部扩展，默认无操作） ---
        self.on_bot_start = lambda *a, **kw: None
        self.on_login_success = lambda *a, **kw: None
        self.on_video_start = lambda title, *a, **kw: None
        self.on_video_end = lambda title, success, *a, **kw: None
        self.on_quiz_found = lambda *a, **kw: None
        self.on_captcha_needed = lambda *a, **kw: None
        self.on_time_limit_reached = lambda *a, **kw: None
        self.on_bot_stop = lambda *a, **kw: None

    def _should_stop(self):
        return self._stop_event and self._stop_event.is_set()

    # ========================================================================
    # 主循环
    # ========================================================================

    def run(self):
        """Bot 主入口。

        流程：启动浏览器 → 登录 → 导航到课程页 → 逐个播放视频 → 清理
        """
        logger.info("=" * 50)
        logger.info("智慧树自动刷课脚本启动")
        logger.info("=" * 50)

        try:
            self.on_bot_start()

            # 1. 启动浏览器并初始化各子模块
            self._init_modules()

            # 2. 登录
            if not self.login_strategy.check_already_logged_in():
                self.login_strategy.do_login()
            self.on_login_success()

            # 3. 导航到课程页面
            self.course.navigate(self.video_url)

            # 4. 获取第一个待处理视频（None 表示从列表头开始）
            title, video_el = self.course.get_next_video_after(None)
            if not title:
                logger.info("所有课程已完成！")
                self._show_completion_report(0)
                return

            label = "未完成" if self.skip_completed else "全部"
            logger.info("开始依次处理%s课程视频", label)

            # 5. 逐个处理视频（每轮从上一个视频的下方查找下一个）
            completed_this_run = 0
            seq = 0
            while title and video_el:
                if self._should_stop():
                    logger.info("收到停止信号，停止处理后续课程")
                    break

                seq += 1
                logger.info("=" * 40)
                logger.info("[%d] 正在处理: %s", seq, title)
                self.on_video_start(title)

                # 点击视频（失败重试，交叉处理弹窗）
                if not self._click_video_with_retry(video_el, title):
                    if self._should_stop():
                        break

                # 播放并监控
                success = self._monitor_single_video(title)

                # 累计时长
                self._accumulate_duration()

                self.on_video_end(title, success)

                if success:
                    completed_this_run += 1
                    logger.info("已完成课程: %s", title)
                else:
                    logger.warning("课程超时，仍计入完成: %s", title)
                    completed_this_run += 1

                # 检查时长限制
                if self._time_limit_reached():
                    break

                time.sleep(EXTRA_LONG_SLEEP)

                # 从当前视频的下方查找下一个待处理视频
                title, video_el = self.course.get_next_video_after(title)

            self._show_completion_report(completed_this_run)

        except KeyboardInterrupt:
            logger.info("用户中断脚本")
        except Exception as e:
            logger.error("脚本运行出错: %s", e, exc_info=True)
        finally:
            self.on_bot_stop()
            if self.driver:
                logger.info("正在关闭浏览器...")
                self.driver.quit()
            logger.info("脚本已退出")

    # ========================================================================
    # 初始化
    # ========================================================================

    def _init_modules(self):
        """初始化 WebDriver 和各子模块并注入依赖。"""
        logger.info("正在启动浏览器...")
        self.driver = create_driver(
            chrome_binary=self.chrome_binary,
            chromedriver_binary=self.chromedriver_binary,
        )
        self.wait = WebDriverWait(self.driver, WAIT_DEFAULT)
        logger.info("浏览器已启动")

        # 按依赖顺序创建子模块
        self.captcha = CaptchaHandler(
            self.driver,
            captcha_event=self._captcha_event,
            captcha_done_event=self._captcha_done,
            stop_event=self._stop_event,
        )
        self.quiz = QuizHandler(self.driver)
        self.video = VideoController(self.driver)
        self.course = CourseNavigator(
            self.driver,
            captcha_handler=self.captcha,
            quiz_handler=self.quiz,
            skip_completed=self.skip_completed,
        )

        # 根据登录方式选择策略
        if self.login_method == "upc":
            self.login_strategy = UPCLogin(
                self.driver,
                self.username,
                self.password,
                self.base_url,
                self.logged_url,
                captcha_handler=self.captcha,
            )
        else:
            self.login_strategy = ZhihuishuLogin(
                self.driver,
                self.username,
                self.password,
                self.base_url,
                self.logged_url,
                captcha_handler=self.captcha,
            )

    # ========================================================================
    # 视频处理
    # ========================================================================

    def _click_video_with_retry(self, video_el, title):
        """点击视频项，失败时重试并交叉处理弹窗。"""
        retry_count = 0
        while not self.course.click_video(video_el, title):
            if self._should_stop():
                return False
            retry_count += 1
            logger.warning(
                "点击课程失败（第%d次重试），执行交叉检测弹窗: %s",
                retry_count, title,
            )
            self.course._handle_initial_dialogs()
            time.sleep(MEDIUM_SLEEP)
        return True

    def _monitor_single_video(self, title):
        """监控单个视频的播放全程。

        在循环中同时处理弹题、验证码、暂停恢复、结束检测。
        """
        logger.info("开始监控视频播放: %s", title)

        elapsed = 0
        last_captcha_check = -VIDEO_MONITOR_CAPTCHA_INTERVAL

        # 确保视频在播放
        if not self.video.is_playing():
            self.video.play()
            time.sleep(LONG_SLEEP)
            if not self.video.is_playing():
                self.video.play()
                time.sleep(EXTRA_LONG_SLEEP)

        while elapsed < VIDEO_MONITOR_MAX_WAIT:
            if self._should_stop():
                logger.info("收到停止信号，退出视频监控")
                self._last_monitor_elapsed = elapsed
                return False

            # 弹题检测（高频）
            quiz_dialog = self.quiz.find_dialog()
            if quiz_dialog:
                logger.info("检测到弹题测验")
                self.on_quiz_found()
                self.quiz.handle(quiz_dialog)
                time.sleep(MEDIUM_SLEEP)
                if not self.video.is_playing() and not self.video.is_ended():
                    self.video.play()
                continue

            # 验证码检测（低频，避免误报）
            if elapsed - last_captcha_check >= VIDEO_MONITOR_CAPTCHA_INTERVAL:
                last_captcha_check = elapsed
                if self.captcha.check_and_handle(
                    "视频播放过程中出现验证码，请完成验证"
                ):
                    self.on_captcha_needed()
                    time.sleep(LONG_SLEEP)
                    if not self.video.is_playing() and not self.video.is_ended():
                        self.video.play()
                    continue

            # 视频结束检测
            if self.video.is_ended():
                current, duration = self.video.get_progress()
                logger.info("视频播放完毕: %s (%s/%s)", title, current, duration)
                self._last_monitor_elapsed = elapsed
                return True

            # 防止自动暂停（每 10s 检查）
            if elapsed > 0 and elapsed % 10 == 0:
                if not self.video.is_playing() and not self.video.is_ended():
                    logger.debug("视频已暂停，尝试恢复播放")
                    self.video.play()

            # 定期日志
            if elapsed % 30 == 0:
                current, duration = self.video.get_progress()
                logger.info("进度: %s/%s (已监控 %ds)", current, duration, elapsed)

            time.sleep(VIDEO_MONITOR_CHECK_INTERVAL)
            elapsed += VIDEO_MONITOR_CHECK_INTERVAL

        logger.warning("视频监控超时: %s", title)
        self._last_monitor_elapsed = elapsed
        return False

    def _accumulate_duration(self):
        """累计实际播放耗时并输出日志。

        使用监控循环实际耗时而非视频 DOM 时长，
        因为用户可能拖动进度条导致识别不准。
        """
        video_dur = self._last_monitor_elapsed
        self.total_watched_seconds += video_dur
        dur_min = int(video_dur // 60)
        dur_sec = int(video_dur % 60)
        total_min = int(self.total_watched_seconds // 60)
        total_sec = int(self.total_watched_seconds % 60)
        logger.info(
            "本视频耗时: %d分%d秒 | 累计观看: %d分%d秒",
            dur_min, dur_sec, total_min, total_sec,
        )

    def _time_limit_reached(self):
        """检查是否达到刷课时长上限。"""
        if self.time_limit_seconds > 0 and self.total_watched_seconds >= self.time_limit_seconds:
            limit_min = self.time_limit_seconds // 60
            total_min = int(self.total_watched_seconds // 60)
            total_sec = int(self.total_watched_seconds % 60)
            logger.info(
                "已达到刷课时长上限 %d 分钟（累计 %d分%d秒），停止刷课",
                limit_min, total_min, total_sec,
            )
            self.on_time_limit_reached()
            return True
        return False

    def _show_completion_report(self, count):
        logger.info("=" * 50)
        logger.info("本次运行完成 %d 个课程视频", count)
        logger.info("=" * 50)
