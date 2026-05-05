import logging
import queue
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk

import keyring

from auto_scheduler import AutoScheduler
from course_bot import CourseBot
from sql.database import Database

KEYRING_SERVICE = "zhihuishu_auto_course"
KEYRING_USER_KEY = "zhanghao"
KEYRING_PASS_KEY = "mima"


class QueueLogHandler(logging.Handler):
    def __init__(self, log_queue):
        super().__init__()
        self.log_queue = log_queue
        self.setFormatter(logging.Formatter("%(asctime)s %(message)s", datefmt="%H:%M:%S"))

    def emit(self, record):
        self.log_queue.put(self.format(record))


class CourseGUI:
    def __init__(self, db_proxy=None):
        self.root = tk.Tk()
        self.root.title("课程自动播放")
        self.root.geometry("760x700")
        self.root.resizable(True, True)

        self.db = db_proxy or Database()
        self._video_history_data = []

        self.log_queue = queue.Queue()
        self.captcha_needed = threading.Event()
        self.captcha_done = threading.Event()
        self.stop_event = threading.Event()
        self.bot_thread = None
        self.running = False
        self._was_auto_started = False

        self.auto_scheduler = AutoScheduler(db_proxy=self.db)

        self._queue_handler = QueueLogHandler(self.log_queue)
        logging.getLogger().addHandler(self._queue_handler)

        self._build_ui()
        self._build_getters()
        self._load_saved_values()
        self._poll_log_queue()
        self._check_captcha_status()
        self._auto_scheduler_tick()
        self._auto_display_tick()
        self._check_bot_liveness()

    def _build_getters(self):
        self._getters = {
            "username": lambda: self.zhanghao_var.get().strip(),
            "password": lambda: self.mima_var.get(),
            "logged_url": lambda: self.logged_url_var.get().strip(),
            "video_url": lambda: self.video_url_var.get().strip(),
            "course_note": lambda: self.course_note_var.get().strip(),
            "time_limit_minutes": self._get_time_limit_minutes,
            "skip_completed_courses": lambda: bool(self.skip_completed_var.get()),
            "login_method": lambda: self.current_login_method,
            "running": lambda: self.running,
            "auto_enabled": lambda: bool(self.auto_enabled_var.get()),
            "auto_window_start": lambda: self.auto_window_start_var.get().strip(),
            "auto_window_end": lambda: self.auto_window_end_var.get().strip(),
            "auto_daily_target": self._get_daily_target_minutes,
        }

    def _get_time_limit_minutes(self):
        try:
            return int(self.time_limit_var.get() or "0")
        except ValueError:
            return 0

    def _get_daily_target_minutes(self):
        try:
            return int(self.auto_daily_target_var.get() or "0")
        except ValueError:
            return 0

    def get(self, key, default=None):
        getter = self._getters.get(key)
        if getter is None:
            return default
        try:
            return getter()
        except Exception:
            return default

    @staticmethod
    def _kr_get(key):
        try:
            return keyring.get_password(KEYRING_SERVICE, key) or ""
        except Exception:
            return ""

    @staticmethod
    def _kr_set(key, value):
        try:
            keyring.set_password(KEYRING_SERVICE, key, value)
        except Exception:
            pass

    def _load_saved_values(self):
        self._refresh_url_history()
        logged_history = self.db.get_url_history("logged")
        if logged_history:
            self.logged_url_var.set(logged_history[0][0])
        video_history = self.db.get_url_history("video")
        if video_history:
            self.video_url_var.set(video_history[0][0])
            self.course_note_var.set(video_history[0][1])
        self.zhanghao_var.set(self._kr_get(KEYRING_USER_KEY))
        self.mima_var.set(self._kr_get(KEYRING_PASS_KEY))
        self.time_limit_var.set(self.db.get_setting("time_limit", "0"))
        self.auto_enabled_var.set(self.db.get_setting("auto_enabled", "") == "true")
        self.auto_window_start_var.set(self.db.get_setting("auto_window_start", "06:00"))
        self.auto_window_end_var.set(self.db.get_setting("auto_window_end", "23:00"))
        self.auto_daily_target_var.set(self.db.get_setting("auto_daily_target", "0"))

    def _save_all_values(self):
        zhanghao = self.zhanghao_var.get()
        mima = self.mima_var.get()
        logged_url = self.logged_url_var.get()
        video_url = self.video_url_var.get()
        time_limit = self.time_limit_var.get()

        if zhanghao:
            self._kr_set(KEYRING_USER_KEY, zhanghao)
        if mima:
            self._kr_set(KEYRING_PASS_KEY, mima)

        self.db.set_setting("time_limit", time_limit)
        self.db.set_setting("auto_enabled", "true" if self.auto_enabled_var.get() else "false")
        self.db.set_setting("auto_window_start", self.auto_window_start_var.get().strip())
        self.db.set_setting("auto_window_end", self.auto_window_end_var.get().strip())
        self.db.set_setting("auto_daily_target", self.auto_daily_target_var.get().strip())
        self.db.save_url_history("logged", logged_url)
        self.db.save_url_history("video", video_url, self.course_note_var.get())
        self._refresh_url_history()

    def _refresh_url_history(self):
        logged_data = self.db.get_url_history("logged")
        self.logged_url_combo["values"] = [url for url, _ in logged_data]

        video_data = self.db.get_url_history("video")
        self._video_history_data = video_data
        self.video_url_combo["values"] = [f"({note}) {url}" if note else url for url, note in video_data]

    def _on_video_url_selected(self, _event):
        idx = self.video_url_combo.current()
        if 0 <= idx < len(self._video_history_data):
            url, note = self._video_history_data[idx]
            self.video_url_var.set(url)
            self.course_note_var.set(note)

    def _on_video_url_changed(self, *_args):
        current_url = self.video_url_var.get().strip()
        self.course_note_var.set(self.db.get_note_for_url(current_url))

    def _build_ui(self):
        self.current_login_method = "zhihuishu"
        acct_frame = ttk.LabelFrame(self.root, text="账号配置", padding=10)
        acct_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        ttk.Label(acct_frame, text="账号:").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.zhanghao_var = tk.StringVar()
        self.zhanghao_entry = ttk.Entry(acct_frame, textvariable=self.zhanghao_var, width=60)
        self.zhanghao_entry.grid(row=0, column=1, sticky=tk.EW, pady=2, padx=(0, 5))

        ttk.Label(acct_frame, text="密码:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.mima_var = tk.StringVar()
        self.mima_entry = ttk.Entry(acct_frame, textvariable=self.mima_var, show="*", width=60)
        self.mima_entry.grid(row=1, column=1, sticky=tk.EW, pady=2, padx=(0, 5))

        self.show_pwd_var = tk.BooleanVar(value=False)
        self.show_pwd_cb = ttk.Checkbutton(acct_frame, text="显示", variable=self.show_pwd_var, command=self._toggle_pwd_visibility)
        self.show_pwd_cb.grid(row=1, column=2, pady=2)
        acct_frame.columnconfigure(1, weight=1)

        url_frame = ttk.LabelFrame(self.root, text="课程配置", padding=10)
        url_frame.pack(fill=tk.X, padx=10, pady=5)

        ttk.Label(url_frame, text="登录后URL:").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.logged_url_var = tk.StringVar()
        self.logged_url_combo = ttk.Combobox(url_frame, textvariable=self.logged_url_var, width=77)
        self.logged_url_combo.grid(row=0, column=1, sticky=tk.EW, pady=2)

        ttk.Label(url_frame, text="课程视频URL:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.video_url_var = tk.StringVar()
        self.video_url_combo = ttk.Combobox(url_frame, textvariable=self.video_url_var, width=77)
        self.video_url_combo.grid(row=1, column=1, sticky=tk.EW, pady=2)
        self.video_url_combo.bind("<<ComboboxSelected>>", self._on_video_url_selected)
        self.video_url_var.trace_add("write", self._on_video_url_changed)

        ttk.Label(url_frame, text="课程备注:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.course_note_var = tk.StringVar()
        ttk.Entry(url_frame, textvariable=self.course_note_var, width=60).grid(row=2, column=1, sticky=tk.EW, pady=2)

        ttk.Label(url_frame, text="刷课时长(分钟):").grid(row=3, column=0, sticky=tk.W, pady=2)
        self.time_limit_var = tk.StringVar(value="0")
        ttk.Entry(url_frame, textvariable=self.time_limit_var, width=10).grid(row=3, column=1, sticky=tk.W, pady=2)
        ttk.Label(url_frame, text="0 表示不限时", foreground="gray").grid(row=3, column=1, sticky=tk.E, pady=2)

        self.skip_completed_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            url_frame,
            text="跳过已学课程",
            variable=self.skip_completed_var,
        ).grid(row=4, column=1, sticky=tk.W, pady=2)

        url_frame.columnconfigure(1, weight=1)

        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill=tk.X, padx=10, pady=5)

        self.start_course_btn = ttk.Button(btn_frame, text="启动（智慧树登录）", command=lambda: self._start_bot("zhihuishu"))
        self.start_course_btn.pack(side=tk.LEFT, padx=(0, 10))

        self.start_upc_btn = ttk.Button(btn_frame, text="启动（数字石大登录）", command=lambda: self._start_bot("upc"))
        self.start_upc_btn.pack(side=tk.LEFT, padx=(0, 10))

        self.stop_btn = ttk.Button(btn_frame, text="停止", command=self._stop_bot, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT)

        auto_frame = ttk.LabelFrame(self.root, text="自动刷课设置（数字石大）", padding=10)
        auto_frame.pack(fill=tk.X, padx=10, pady=5)

        self.auto_enabled_var = tk.BooleanVar(value=False)
        self.auto_enabled_cb = ttk.Checkbutton(
            auto_frame,
            text="自动使用数字石大登录",
            variable=self.auto_enabled_var,
            command=self._on_auto_config_changed,
        )
        self.auto_enabled_cb.grid(row=0, column=0, columnspan=4, sticky=tk.W, pady=2)

        ttk.Label(auto_frame, text="时间窗口:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.auto_window_start_var = tk.StringVar(value="06:00")
        self.auto_start_entry = ttk.Entry(auto_frame, textvariable=self.auto_window_start_var, width=6)
        self.auto_start_entry.grid(row=1, column=1, sticky=tk.W, pady=2, padx=(5, 0))
        self.auto_start_entry.bind("<FocusOut>", lambda e: self._validate_time_input("start"))
        ttk.Label(auto_frame, text=" —").grid(row=1, column=2, sticky=tk.W, pady=2)
        self.auto_window_end_var = tk.StringVar(value="23:00")
        self.auto_end_entry = ttk.Entry(auto_frame, textvariable=self.auto_window_end_var, width=6)
        self.auto_end_entry.grid(row=1, column=3, sticky=tk.W, pady=2, padx=(0, 5))
        self.auto_end_entry.bind("<FocusOut>", lambda e: self._validate_time_input("end"))
        ttk.Label(auto_frame, text="(HH:MM)", foreground="gray").grid(row=1, column=4, sticky=tk.W, pady=2)

        ttk.Label(auto_frame, text="每日目标:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.auto_daily_target_var = tk.StringVar(value="0")
        self.auto_daily_target_entry = ttk.Entry(auto_frame, textvariable=self.auto_daily_target_var, width=6)
        self.auto_daily_target_entry.grid(row=2, column=1, sticky=tk.W, pady=2, padx=(5, 0))
        self.auto_daily_target_var.trace_add("write", lambda *a: self._on_auto_config_changed())
        ttk.Label(auto_frame, text="分钟 (0 = 不限)", foreground="gray").grid(
            row=2, column=2, columnspan=3, sticky=tk.W, pady=2
        )

        self.auto_today_label = ttk.Label(
            auto_frame,
            text="今日已刷课时长：0.0 分钟",
            foreground="blue",
        )
        self.auto_today_label.grid(row=3, column=0, columnspan=5, sticky=tk.W, pady=(5, 2))

        status_frame = ttk.LabelFrame(self.root, text="运行状态", padding=10)
        status_frame.pack(fill=tk.X, padx=10, pady=5)

        self.status_label = ttk.Label(status_frame, text="就绪 - 点击启动开始运行", foreground="gray")
        self.status_label.pack(side=tk.LEFT, padx=(0, 20))

        self.captcha_btn = ttk.Button(status_frame, text="验证码已完成", command=self._on_confirm_captcha, state=tk.DISABLED)
        self.captcha_btn.pack(side=tk.RIGHT)

        self.captcha_hint = ttk.Label(status_frame, text="", foreground="red", wraplength=400)
        self.captcha_hint.pack(side=tk.RIGHT, padx=(0, 10))

        log_frame = ttk.LabelFrame(self.root, text="运行日志", padding=5)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(5, 10))

        self.log_area = scrolledtext.ScrolledText(log_frame, wrap=tk.WORD, state=tk.DISABLED, font=("Consolas", 9))
        self.log_area.pack(fill=tk.BOTH, expand=True)

    def _toggle_pwd_visibility(self):
        self.mima_entry.config(show="" if self.show_pwd_var.get() else "*")

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
        self.root.after(200, self._poll_log_queue)

    def _check_captcha_status(self):
        if self.captcha_needed.is_set():
            self.status_label.config(text="检测到验证码，请在浏览器中完成", foreground="red")
            self.captcha_btn.config(state=tk.NORMAL)
        self.root.after(500, self._check_captcha_status)

    def _on_confirm_captcha(self):
        self.captcha_done.set()
        self.captcha_needed.clear()
        self.captcha_btn.config(state=tk.DISABLED)
        self.captcha_hint.config(text="")
        self.status_label.config(text="运行中", foreground="green")

    def _start_bot(self, login_method, auto_started=False):
        if self.running:
            return
        self._was_auto_started = auto_started
        self.running = True
        self.stop_event.clear()
        self.captcha_needed.clear()
        self.captcha_done.clear()
        self.start_course_btn.config(state=tk.DISABLED)
        self.start_upc_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)

        base_url = "https://i.upc.edu.cn/" if login_method == "upc" else "https://onlineweb.zhihuishu.com/"
        login_name = "数字石大登录" if login_method == "upc" else "智慧树登录"
        self.status_label.config(text=f"正在初始化（{login_name}）...", foreground="green")
        self.current_login_method = login_method

        username = self.get("username", "")
        password = self.get("password", "")
        logged_url = self.get("logged_url", "")
        video_url = self.get("video_url", "")
        time_limit = self.get("time_limit_minutes", 0)
        auto_enabled = self.get("auto_enabled", False)
        daily_target = self.get("auto_daily_target", 0)

        self._save_all_values()

        if auto_enabled and login_method == "upc":
            today_watched = self.auto_scheduler.get_daily_watched_minutes()
            remaining = max(0, daily_target - int(today_watched))
            time_limit = remaining

        bot = CourseBot(
            base_url=base_url,
            username=username,
            password=password,
            logged_url=logged_url,
            video_url=video_url,
            login_method=login_method,
            time_limit_minutes=time_limit,
            captcha_event=self.captcha_needed,
            captcha_done_event=self.captcha_done,
            stop_event=self.stop_event,
            db_proxy=self.db,
            skip_completed_courses=self.get("skip_completed_courses", True),
            auto_mode=auto_enabled and login_method == "upc",
            daily_target_seconds=daily_target * 60,
        )
        bot.set_scheduler(self.auto_scheduler)
        self.bot_thread = threading.Thread(target=bot.run, daemon=True)
        self.bot_thread.start()

    def _stop_bot(self):
        self.running = False
        self._was_auto_started = False
        self.stop_event.set()
        self.captcha_done.set()
        self.captcha_needed.clear()
        if self.auto_enabled_var.get():
            self.auto_enabled_var.set(False)
            self._save_all_values()
        if self.auto_scheduler is not None:
            try:
                self.auto_scheduler.on_video_completed(db_proxy=self.db)
            except Exception:
                pass
        self.status_label.config(text="已停止", foreground="orange")
        self.start_course_btn.config(state=tk.NORMAL)
        self.start_upc_btn.config(state=tk.NORMAL)
        self.stop_btn.config(state=tk.DISABLED)
        self.captcha_btn.config(state=tk.DISABLED)

    def _sync_config_to_scheduler(self):
        if self.auto_scheduler is None:
            return
        self.auto_scheduler.configure(
            enabled=self.get("auto_enabled", False),
            window_start=self.get("auto_window_start", "06:00"),
            window_end=self.get("auto_window_end", "23:00"),
            daily_target_minutes=self.get("auto_daily_target", 0),
        )

    def _auto_scheduler_tick(self):
        try:
            self._sync_config_to_scheduler()
            if self.auto_scheduler is not None:
                if self.auto_scheduler.should_auto_start(self.running):
                    logging.info("Auto-scheduler: conditions met, auto-starting UPC login")
                    self._start_bot("upc", auto_started=True)
                elif self.auto_scheduler.should_auto_stop(
                    self.running, was_auto_started=self._was_auto_started
                ):
                    logging.info("Auto-scheduler: conditions unmet, auto-stopping")
                    self._stop_bot()
        except Exception:
            logging.warning("Auto-scheduler tick error", exc_info=True)
        finally:
            self.root.after(30000, self._auto_scheduler_tick)

    def _auto_display_tick(self):
        try:
            if self.auto_scheduler is not None:
                minutes = self.auto_scheduler.get_daily_watched_minutes()
                self.auto_today_label.config(
                    text=f"今日已刷课时长：{minutes:.1f} 分钟"
                )
        except Exception:
            pass
        finally:
            self.root.after(5000, self._auto_display_tick)

    def _check_bot_liveness(self):
        try:
            if self.running and self.bot_thread and not self.bot_thread.is_alive():
                logging.info("Bot thread finished, resetting state")
                if self.auto_scheduler is not None:
                    self.auto_scheduler.on_video_completed(db_proxy=self.db)
                self.running = False
                self._was_auto_started = False
                self.start_course_btn.config(state=tk.NORMAL)
                self.start_upc_btn.config(state=tk.NORMAL)
                self.stop_btn.config(state=tk.DISABLED)
                self.captcha_btn.config(state=tk.DISABLED)
                self.status_label.config(text="运行结束", foreground="gray")
        except Exception:
            pass
        finally:
            self.root.after(5000, self._check_bot_liveness)

    def _on_auto_config_changed(self):
        self._save_all_values()
        self._sync_config_to_scheduler()
        if not self.get("auto_enabled", False) and self.running and self._was_auto_started:
            self._stop_bot()
        else:
            self.root.after(1000, self._force_scheduler_recheck)

    def _force_scheduler_recheck(self):
        try:
            self._sync_config_to_scheduler()
            if self.auto_scheduler is not None:
                if self.auto_scheduler.should_auto_start(self.running):
                    self._start_bot("upc", auto_started=True)
                elif self.auto_scheduler.should_auto_stop(
                    self.running, was_auto_started=self._was_auto_started
                ):
                    self._stop_bot()
        except Exception:
            pass

    def _validate_time_input(self, which):
        var = self.auto_window_start_var if which == "start" else self.auto_window_end_var
        default = "06:00" if which == "start" else "23:00"
        value = var.get().strip()
        try:
            parts = value.split(":")
            if len(parts) != 2:
                raise ValueError
            h, m = int(parts[0]), int(parts[1])
            if not (0 <= h <= 23 and 0 <= m <= 59):
                raise ValueError
        except (ValueError, AttributeError):
            var.set(default)
        self._on_auto_config_changed()

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        self._stop_bot()
        self.db.close()
        self.root.destroy()
