"""
智慧树自动刷课 GUI 入口。

负责 Tkinter 主窗口、用户配置管理、Bot 线程生命周期、
以及日志/验证码事件的跨线程轮询。不包含任何刷课业务逻辑。
"""

import logging
import queue
import threading
import time
from datetime import datetime, time as dt_time

import tkinter as tk
from tkinter import scrolledtext, ttk

import keyring

from config import KEYRING_PASSWORD_KEY, KEYRING_SERVICE, KEYRING_USERNAME_KEY
from database import Database
from src.bot.bot_core import ZhiHuiShuBot
from src.constants import (
    AUTO_SCHEDULER_INTERVAL_MS,
    GUI_CAPTCHA_POLL_MS,
    GUI_LOG_POLL_MS,
    UPC_BASE_URL,
    ZHIHUISHU_BASE_URL,
)
from src.ui.log_handler import QueueLogHandler

logger = logging.getLogger(__name__)


class ZhiHuiShuGUI:
    """智慧树自动刷课主窗口。"""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("智慧树自动刷课")
        self.root.geometry("720x680")
        self.root.resizable(True, True)

        self.db = Database()
        self._video_history_data = []

        self.log_queue = queue.Queue()
        self.captcha_needed = threading.Event()
        self.captcha_done = threading.Event()
        self.stop_event = threading.Event()
        self.bot = None
        self.bot_thread = None
        self.running = False

        # 自动调度器状态
        self._last_recorded_seconds = 0
        self._todays_watched_seconds = 0
        self._today_date = ""

        self._queue_handler = QueueLogHandler(self.log_queue)
        logging.getLogger().addHandler(self._queue_handler)

        self._build_ui()
        self._load_saved_values()
        self._poll_log_queue()
        self._check_captcha_status()

    # ---------- keyring ----------

    @staticmethod
    def _keyring_get(key):
        try:
            return keyring.get_password(KEYRING_SERVICE, key) or ""
        except Exception:
            return ""

    @staticmethod
    def _keyring_set(key, value):
        try:
            keyring.set_password(KEYRING_SERVICE, key, value)
        except Exception:
            pass

    # ---------- load / save ----------

    def _load_saved_values(self):
        self._refresh_url_history()

        logged_history = self.db.get_url_history("logged")
        if logged_history:
            self.logged_url_var.set(logged_history[0][0])

        video_history = self.db.get_url_history("video")
        if video_history:
            self.video_url_var.set(video_history[0][0])
            self.course_note_var.set(video_history[0][1])

        self.username_var.set(self._keyring_get(KEYRING_USERNAME_KEY))
        self.password_var.set(self._keyring_get(KEYRING_PASSWORD_KEY))

        saved_limit = self.db.get_setting("time_limit", "")
        self.time_limit_var.set(saved_limit)

        # 加载登录方式
        saved_method = self.db.get_setting("login_method", "zhihuishu")
        self.login_method_var.set(
            "数字石大" if saved_method == "upc" else "智慧树"
        )

        # 加载自动调度器设置（自动模式默认不勾选，每次启动重置）
        self.auto_start_var.set(self.db.get_setting("auto_start_time", "06:00"))
        self.auto_end_var.set(self.db.get_setting("auto_end_time", "23:00"))
        self.auto_allday_var.set(self.db.get_setting("auto_allday", "0") == "1")

        # 加载今日进度并启动调度器轮询
        self._today_date = time.strftime("%Y-%m-%d")
        self._todays_watched_seconds = self.db.get_daily_progress(self._today_date)
        self._update_progress_label()
        self._auto_scheduler_tick()

    def _save_all_values(self):
        username = self.username_var.get()
        password = self.password_var.get()
        logged_url = self.logged_url_var.get()
        video_url = self.video_url_var.get()
        time_limit = self.time_limit_var.get()

        if username:
            self._keyring_set(KEYRING_USERNAME_KEY, username)
        if password:
            self._keyring_set(KEYRING_PASSWORD_KEY, password)
        self.db.set_setting("time_limit", time_limit)
        self.db.save_url_history("logged", logged_url)
        self.db.save_url_history("video", video_url, self.course_note_var.get())

        # 保存登录方式
        method_val = "upc" if self.login_method_var.get() == "数字石大" else "zhihuishu"
        self.db.set_setting("login_method", method_val)

        # 保存自动调度器设置
        self.db.set_setting("auto_mode", "1" if self.auto_mode_var.get() else "0")
        self.db.set_setting("auto_start_time", self.auto_start_var.get().strip() or "06:00")
        self.db.set_setting("auto_end_time", self.auto_end_var.get().strip() or "23:00")
        self.db.set_setting("auto_allday", "1" if self.auto_allday_var.get() else "0")

        self._refresh_url_history()

    def _refresh_url_history(self):
        logged_data = self.db.get_url_history("logged")
        self.logged_url_combo["values"] = [url for url, _ in logged_data]

        video_data = self.db.get_url_history("video")
        self._video_history_data = video_data
        self.video_url_combo["values"] = [
            f"（{note}）{url}" if note else url
            for url, note in video_data
        ]

    def _on_video_url_selected(self, event):
        idx = self.video_url_combo.current()
        if 0 <= idx < len(self._video_history_data):
            url, note = self._video_history_data[idx]
            self.video_url_var.set(url)
            self.course_note_var.set(note)

    def _on_video_url_changed(self, *args):
        current_url = self.video_url_var.get().strip()
        note = self.db.get_note_for_url(current_url)
        self.course_note_var.set(note)

    # ---------- UI ----------

    def _build_ui(self):
        # 账号配置
        acct_frame = ttk.LabelFrame(self.root, text="账号配置", padding=10)
        acct_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        ttk.Label(acct_frame, text="账号:").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.username_var = tk.StringVar()
        self.username_entry = ttk.Entry(acct_frame, textvariable=self.username_var, width=60)
        self.username_entry.grid(row=0, column=1, sticky=tk.EW, pady=2, padx=(0, 5))

        ttk.Label(acct_frame, text="密码:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.password_var = tk.StringVar()
        self.password_entry = ttk.Entry(acct_frame, textvariable=self.password_var, show="●", width=60)
        self.password_entry.grid(row=1, column=1, sticky=tk.EW, pady=2, padx=(0, 5))
        self.show_pwd_var = tk.BooleanVar(value=False)
        self.show_pwd_cb = ttk.Checkbutton(
            acct_frame, text="显示", variable=self.show_pwd_var,
            command=self._toggle_pwd_visibility,
        )
        self.show_pwd_cb.grid(row=1, column=2, pady=2)
        acct_frame.columnconfigure(1, weight=1)

        # 课程配置
        url_frame = ttk.LabelFrame(self.root, text="课程配置", padding=10)
        url_frame.pack(fill=tk.X, padx=10, pady=5)

        ttk.Label(url_frame, text="登录跳转URL:").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.logged_url_var = tk.StringVar()
        self.logged_url_combo = ttk.Combobox(url_frame, textvariable=self.logged_url_var, width=77)
        self.logged_url_combo.grid(row=0, column=1, sticky=tk.EW, pady=2)

        ttk.Label(url_frame, text="登录方式:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.login_method_var = tk.StringVar(value="zhihuishu")
        self.login_method_combo = ttk.Combobox(
            url_frame, textvariable=self.login_method_var,
            values=["智慧树", "数字石大"], state="readonly", width=15,
        )
        self.login_method_combo.grid(row=1, column=1, sticky=tk.W, pady=2)

        ttk.Label(url_frame, text="课程视频URL:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.video_url_var = tk.StringVar()
        self.video_url_combo = ttk.Combobox(url_frame, textvariable=self.video_url_var, width=77)
        self.video_url_combo.grid(row=2, column=1, sticky=tk.EW, pady=2)
        self.video_url_combo.bind("<<ComboboxSelected>>", self._on_video_url_selected)
        self.video_url_var.trace_add("write", self._on_video_url_changed)

        ttk.Label(url_frame, text="课程备注:").grid(row=3, column=0, sticky=tk.W, pady=2)
        self.course_note_var = tk.StringVar()
        ttk.Entry(url_frame, textvariable=self.course_note_var, width=60).grid(
            row=3, column=1, sticky=tk.EW, pady=2
        )

        # 刷课时长行（使用子 Frame 排布 Entry + 提示 + 今日进度）
        time_row = ttk.Frame(url_frame)
        time_row.grid(row=4, column=0, columnspan=2, sticky=tk.EW, pady=2)
        ttk.Label(time_row, text="刷课时长(分钟):").pack(side=tk.LEFT)
        self.time_limit_var = tk.StringVar(value="0")
        ttk.Entry(time_row, textvariable=self.time_limit_var, width=7).pack(
            side=tk.LEFT, padx=(5, 0)
        )
        ttk.Label(time_row, text="（0=不限）", foreground="gray").pack(
            side=tk.LEFT, padx=(2, 0)
        )
        self.auto_progress_label = ttk.Label(
            time_row, text="今日已刷课时长：0 分钟", foreground="blue"
        )
        self.auto_progress_label.pack(side=tk.RIGHT)

        # 跳过已学课程复选框
        self.skip_completed_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            url_frame, text="跳过已学课程（取消勾选后将依次学习全部课程）",
            variable=self.skip_completed_var,
        ).grid(row=5, column=0, columnspan=2, sticky=tk.W, pady=(5, 0))

        url_frame.columnconfigure(1, weight=1)

        # 自动设置
        auto_frame = ttk.LabelFrame(self.root, text="自动设置", padding=10)
        auto_frame.pack(fill=tk.X, padx=10, pady=5)

        self.auto_mode_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            auto_frame, text="自动使用数字石大登录",
            variable=self.auto_mode_var,
            command=self._on_auto_mode_toggled,
        ).grid(row=0, column=0, columnspan=5, sticky=tk.W, pady=(0, 5))

        ttk.Label(auto_frame, text="允许运行时间:").grid(
            row=1, column=0, sticky=tk.W, pady=2
        )
        self.auto_start_var = tk.StringVar(value="06:00")
        self.auto_start_entry = ttk.Entry(
            auto_frame, textvariable=self.auto_start_var, width=7,
        )
        self.auto_start_entry.grid(row=1, column=1, sticky=tk.W, pady=2)
        ttk.Label(auto_frame, text="至").grid(row=1, column=2, pady=2)
        self.auto_end_var = tk.StringVar(value="23:00")
        self.auto_end_entry = ttk.Entry(
            auto_frame, textvariable=self.auto_end_var, width=7,
        )
        self.auto_end_entry.grid(row=1, column=3, sticky=tk.W, pady=2)

        self.auto_allday_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            auto_frame, text="全天", variable=self.auto_allday_var,
            command=self._on_allday_toggled,
        ).grid(row=1, column=4, sticky=tk.W, pady=2, padx=(10, 0))

        auto_frame.columnconfigure(4, weight=1)

        # 操作按钮
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill=tk.X, padx=10, pady=5)

        self.start_btn = ttk.Button(
            btn_frame, text="启动", command=self._on_start_clicked,
        )
        self.start_btn.pack(side=tk.LEFT, padx=(0, 10))

        self.stop_btn = ttk.Button(btn_frame, text="停止", command=self._stop_bot, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT)

        # 运行状态
        status_frame = ttk.LabelFrame(self.root, text="运行状态", padding=10)
        status_frame.pack(fill=tk.X, padx=10, pady=5)

        self.status_label = ttk.Label(
            status_frame, text="● 就绪", foreground="gray"
        )
        self.status_label.pack(side=tk.LEFT, padx=(0, 20))

        self.captcha_btn = ttk.Button(
            status_frame, text="没有需确认的验证码",
            command=self._on_confirm_captcha, state=tk.DISABLED,
        )
        self.captcha_btn.pack(side=tk.RIGHT)

        self.captcha_hint = ttk.Label(status_frame, text="", foreground="red", wraplength=400)
        self.captcha_hint.pack(side=tk.RIGHT, padx=(0, 10))

        # 日志区域
        log_frame = ttk.LabelFrame(self.root, text="运行日志", padding=5)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(5, 10))

        self.log_area = scrolledtext.ScrolledText(
            log_frame, wrap=tk.WORD, state=tk.DISABLED, font=("Consolas", 9),
        )
        self.log_area.pack(fill=tk.BOTH, expand=True)

    def _toggle_pwd_visibility(self):
        self.password_entry.config(show="" if self.show_pwd_var.get() else "●")

    # ---------- log polling ----------

    def _poll_log_queue(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.log_area.config(state=tk.NORMAL)
                self.log_area.insert(tk.END, msg + "\n")
                self.log_area.see(tk.END)
                self.log_area.config(state=tk.DISABLED)
        except queue.Empty:
            pass
        self.root.after(GUI_LOG_POLL_MS, self._poll_log_queue)

    # ---------- CAPTCHA ----------

    def _check_captcha_status(self):
        if self.running and self.captcha_needed.is_set():
            self.status_label.config(
                text="⚠ 检测到验证码 — 请在浏览器中完成验证", foreground="red"
            )
            self.captcha_btn.config(state=tk.NORMAL)
        self.root.after(GUI_CAPTCHA_POLL_MS, self._check_captcha_status)

    def _on_confirm_captcha(self):
        self.captcha_done.set()
        self.captcha_needed.clear()
        self.captcha_btn.config(state=tk.DISABLED)
        self.captcha_hint.config(text="")
        self.status_label.config(text="● 正在刷课", foreground="green")

    # ---------- Bot lifecycle ----------

    def _validate_inputs(self, login_method):
        """校验启动前必填字段，返回 (is_valid, error_message)。"""
        username = self.username_var.get().strip()
        password = self.password_var.get()
        video_url = self.video_url_var.get().strip()

        if not username:
            return False, "账号不能为空"
        if not password:
            return False, "密码不能为空"
        if not video_url:
            return False, "课程视频URL不能为空"

        # UPC 登录需要 logged_url 用于跳转检测
        if login_method == "upc":
            logged_url = self.logged_url_var.get().strip()
            if not logged_url:
                return False, "数字石大登录需要填写'登录跳转URL'"

        return True, ""

    def _on_start_clicked(self):
        """启动按钮回调。自动模式下固定 UPC 登录。"""
        if self.auto_mode_var.get():
            self._start_bot("upc", auto_start=True)
        else:
            method = "upc" if self.login_method_var.get() == "数字石大" else "zhihuishu"
            self._start_bot(method)

    def _start_bot(self, login_method, auto_start=False):
        if self.running:
            return

        # 启动前校验
        valid, error_msg = self._validate_inputs(login_method)
        if not valid:
            self.status_label.config(
                text=f"⚠ {error_msg}", foreground="red"
            )
            return

        self.running = True
        self.stop_event.clear()
        self.captcha_needed.clear()
        self.captcha_done.clear()
        self.start_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)

        if login_method == "upc":
            base_url = UPC_BASE_URL
            login_label = "数字石大"
        else:
            base_url = ZHIHUISHU_BASE_URL
            login_label = "智慧树"

        self.status_label.config(
            text=f"● 正在初始化（{login_label}）...", foreground="green",
        )

        username = self.username_var.get().strip()
        password = self.password_var.get()
        logged_url = self.logged_url_var.get().strip()
        video_url = self.video_url_var.get().strip()

        # 自动模式：由调度器管理停止时机，不设单次时长上限
        if auto_start:
            time_limit = 0
        else:
            try:
                time_limit = int(self.time_limit_var.get() or "0")
            except ValueError:
                time_limit = 0

        self._save_all_values()

        self.bot = ZhiHuiShuBot(
            base_url=base_url,
            username=username,
            password=password,
            logged_url=logged_url,
            video_url=video_url,
            login_method=login_method,
            time_limit_minutes=time_limit,
            skip_completed=self.skip_completed_var.get(),
            captcha_event=self.captcha_needed,
            captcha_done_event=self.captcha_done,
            stop_event=self.stop_event,
        )

        # 连接钩子：将视频进度写入数据库
        self._last_recorded_seconds = 0
        captured_bot = self.bot

        def _on_video_end(title, success):
            if captured_bot is None:
                return
            delta = captured_bot.total_watched_seconds - self._last_recorded_seconds
            if delta > 0:
                self._last_recorded_seconds = captured_bot.total_watched_seconds
                today = time.strftime("%Y-%m-%d")
                self.db.add_daily_progress(today, delta)
                self._todays_watched_seconds += delta

        def _on_bot_stop():
            if captured_bot is None:
                return
            delta = captured_bot.total_watched_seconds - self._last_recorded_seconds
            if delta > 0:
                self._last_recorded_seconds = captured_bot.total_watched_seconds
                today = time.strftime("%Y-%m-%d")
                self.db.add_daily_progress(today, delta)
                self._todays_watched_seconds += delta

        self.bot.on_video_end = _on_video_end
        self.bot.on_bot_stop = _on_bot_stop

        self.bot_thread = threading.Thread(target=self.bot.run, daemon=True)
        self.bot_thread.start()

    def _stop_bot(self, auto_uncheck=True):
        """停止 Bot。

        auto_uncheck: 是否同时取消勾选"自动使用数字石大登录"。
                      用户手动停止 / 课程全部学完 → True；
                      调度器因时间/目标临时停止 → False。
        """
        self.running = False
        self.stop_event.set()
        # 注意：不能同时 set captcha_done，否则验证码等待循环会误判为"用户已确认"
        # 只设 stop_event，让 CaptchaHandler._notify_and_wait 通过 _should_stop 自行退出
        self.captcha_needed.clear()
        if auto_uncheck:
            self.auto_mode_var.set(False)
        self.status_label.config(text="● 已停止", foreground="red")
        self.start_btn.config(state=tk.NORMAL)
        self.stop_btn.config(state=tk.DISABLED)
        self.captcha_btn.config(state=tk.DISABLED)

    # ---------- auto-scheduler ----------

    def _on_auto_mode_toggled(self):
        """自动模式切换：勾选时灰掉登录方式下拉，取消时停止刷课。"""
        if self.auto_mode_var.get():
            self.login_method_combo.config(state=tk.DISABLED)
        else:
            self.login_method_combo.config(state="readonly")
            if self.running:
                logger.info("自动设置：已取消自动模式，停止当前刷课")
                self._stop_bot(auto_uncheck=False)

    def _on_allday_toggled(self):
        """全天复选框切换：勾选时灰掉时间输入框。"""
        if self.auto_allday_var.get():
            self.auto_start_entry.config(state=tk.DISABLED)
            self.auto_end_entry.config(state=tk.DISABLED)
        else:
            self.auto_start_entry.config(state=tk.NORMAL)
            self.auto_end_entry.config(state=tk.NORMAL)

    def _update_progress_label(self):
        """刷新'今日已刷课时长'标签。"""
        minutes = self._todays_watched_seconds // 60
        self.auto_progress_label.config(
            text=f"今日已刷课时长：{minutes} 分钟"
        )

    @staticmethod
    def _time_in_range(now, start_str, end_str):
        """判断当前时间是否在允许范围内，支持跨夜窗口（如 22:00-02:00）。"""
        try:
            sh, sm = map(int, start_str.strip().split(":"))
            eh, em = map(int, end_str.strip().split(":"))
        except (ValueError, AttributeError):
            return True  # 格式异常时默认允许运行

        start = dt_time(sh, sm)
        end = dt_time(eh, em)

        if start <= end:
            return start <= now <= end
        else:
            return now >= start or now <= end

    def _auto_scheduler_tick(self):
        """调度器入口，每 30 秒由 root.after 触发。"""
        try:
            self._auto_scheduler_evaluate()
        finally:
            self.root.after(AUTO_SCHEDULER_INTERVAL_MS, self._auto_scheduler_tick)

    def _auto_scheduler_evaluate(self):
        """核心调度逻辑（仅在主线程执行）。"""
        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        now_time = now.time()

        # 跨天：重新加载今日进度
        if self._today_date != today:
            self._today_date = today
            self._todays_watched_seconds = self.db.get_daily_progress(today)

        bot_alive = self.bot_thread is not None and self.bot_thread.is_alive()

        # 检测 Bot 自然结束（线程已退出但 running 仍为 True）
        if self.running and not bot_alive:
            self.running = False
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)
            self.captcha_btn.config(state=tk.DISABLED)
            # 如果本轮几乎没有进度，说明课程已学完，取消自动模式
            if self._last_recorded_seconds < 60:
                self.auto_mode_var.set(False)
                logger.info("自动调度：本轮进度不足 60 秒，课程已学完，取消自动模式")

        # 刷新今日进度（捕获钩子写入的增量）
        self._todays_watched_seconds = self.db.get_daily_progress(today)
        self._update_progress_label()

        if not self.auto_mode_var.get():
            return

        # 解析参数（读取统一的刷课时长）
        try:
            target_min = int(self.time_limit_var.get() or "0")
        except ValueError:
            target_min = 0
        target_seconds = target_min * 60

        if self.auto_allday_var.get():
            in_range = True
        else:
            in_range = self._time_in_range(
                now_time,
                self.auto_start_var.get(),
                self.auto_end_var.get(),
            )

        if bot_alive:
            # 更新运行状态（仅在非验证码状态下覆盖初始化提示）
            if not self.captcha_needed.is_set():
                cur = self.status_label.cget("text")
                if "初始化" in cur or "就绪" in cur or "运行" in cur:
                    self.status_label.config(
                        text="● 正在刷课", foreground="green"
                    )

            # 正在运行 → 评估是否需要停止
            if not in_range:
                logger.info(
                    "自动调度：当前时间 %s 超出允许范围，停止刷课",
                    now.strftime("%H:%M"),
                )
                self._stop_bot(auto_uncheck=False)
                self.status_label.config(
                    text="● 不在允许运行时间内", foreground="orange"
                )
            elif target_seconds > 0 and self._todays_watched_seconds >= target_seconds:
                logger.info(
                    "自动调度：今日已刷 %d/%d 分钟，已达到目标，停止刷课",
                    self._todays_watched_seconds // 60, target_min,
                )
                self._stop_bot(auto_uncheck=False)
                self.status_label.config(
                    text="● 今日自动刷课已到目标时长", foreground="orange"
                )
        else:
            # 未运行 → 评估是否需要启动
            if not in_range:
                return
            if target_seconds <= 0:
                return
            if self._todays_watched_seconds >= target_seconds:
                return

            logger.info(
                "自动调度：满足条件，自动启动 UPC 刷课（今日已刷 %d/%d 分钟）",
                self._todays_watched_seconds // 60, target_min,
            )
            self._start_bot("upc", auto_start=True)

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        self._stop_bot()
        self.db.close()
        self.root.destroy()


if __name__ == "__main__":
    gui = ZhiHuiShuGUI()
    gui.run()
