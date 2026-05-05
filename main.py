"""
智慧树自动刷课 GUI 入口。

负责 Tkinter 主窗口、用户配置管理、Bot 线程生命周期、
以及日志/验证码事件的跨线程轮询。不包含任何刷课业务逻辑。
"""

import logging
import queue
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk

import keyring

from config import KEYRING_PASSWORD_KEY, KEYRING_SERVICE, KEYRING_USERNAME_KEY
from database import Database
from src.bot.bot_core import ZhiHuiShuBot
from src.constants import GUI_CAPTCHA_POLL_MS, GUI_LOG_POLL_MS, UPC_BASE_URL, ZHIHUISHU_BASE_URL
from src.ui.log_handler import QueueLogHandler


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
        self.bot_thread = None
        self.running = False

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

        ttk.Label(url_frame, text="课程视频URL:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.video_url_var = tk.StringVar()
        self.video_url_combo = ttk.Combobox(url_frame, textvariable=self.video_url_var, width=77)
        self.video_url_combo.grid(row=1, column=1, sticky=tk.EW, pady=2)
        self.video_url_combo.bind("<<ComboboxSelected>>", self._on_video_url_selected)
        self.video_url_var.trace_add("write", self._on_video_url_changed)

        ttk.Label(url_frame, text="课程备注:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.course_note_var = tk.StringVar()
        ttk.Entry(url_frame, textvariable=self.course_note_var, width=60).grid(
            row=2, column=1, sticky=tk.EW, pady=2
        )

        ttk.Label(url_frame, text="刷课时长(分钟):").grid(row=3, column=0, sticky=tk.W, pady=2)
        self.time_limit_var = tk.StringVar(value="0")
        ttk.Entry(url_frame, textvariable=self.time_limit_var, width=10).grid(
            row=3, column=1, sticky=tk.W, pady=2
        )
        ttk.Label(url_frame, text="（0=不限，达到时长后自动停止）", foreground="gray").grid(
            row=3, column=1, sticky=tk.E, pady=2
        )

        # 跳过已学课程复选框（默认勾选，保持原有行为）
        self.skip_completed_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            url_frame, text="跳过已学课程（取消勾选后将依次学习全部课程）",
            variable=self.skip_completed_var,
        ).grid(row=4, column=0, columnspan=2, sticky=tk.W, pady=(5, 0))

        url_frame.columnconfigure(1, weight=1)

        # 操作按钮
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill=tk.X, padx=10, pady=5)

        self.start_zhihuishu_btn = ttk.Button(
            btn_frame, text="启动并通过智慧树登录",
            command=lambda: self._start_bot("zhihuishu"),
        )
        self.start_zhihuishu_btn.pack(side=tk.LEFT, padx=(0, 10))

        self.start_upc_btn = ttk.Button(
            btn_frame, text="启动并通过数字石大登录",
            command=lambda: self._start_bot("upc"),
        )
        self.start_upc_btn.pack(side=tk.LEFT, padx=(0, 10))

        self.stop_btn = ttk.Button(btn_frame, text="停止", command=self._stop_bot, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT)

        # 运行状态
        status_frame = ttk.LabelFrame(self.root, text="运行状态", padding=10)
        status_frame.pack(fill=tk.X, padx=10, pady=5)

        self.status_label = ttk.Label(
            status_frame, text="● 就绪 - 点击'开始运行'启动脚本", foreground="gray"
        )
        self.status_label.pack(side=tk.LEFT, padx=(0, 20))

        self.captcha_btn = ttk.Button(
            status_frame, text="确认验证码已完成",
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
        if self.captcha_needed.is_set():
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
        self.status_label.config(text="● 正在运行", foreground="green")

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

    def _start_bot(self, login_method):
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
        self.start_zhihuishu_btn.config(state=tk.DISABLED)
        self.start_upc_btn.config(state=tk.DISABLED)
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
        try:
            time_limit = int(self.time_limit_var.get() or "0")
        except ValueError:
            time_limit = 0

        self._save_all_values()

        bot = ZhiHuiShuBot(
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
        self.bot_thread = threading.Thread(target=bot.run, daemon=True)
        self.bot_thread.start()

    def _stop_bot(self):
        self.running = False
        self.stop_event.set()
        self.captcha_done.set()
        self.captcha_needed.clear()
        self.status_label.config(text="● 已停止", foreground="orange")
        self.start_zhihuishu_btn.config(state=tk.NORMAL)
        self.start_upc_btn.config(state=tk.NORMAL)
        self.stop_btn.config(state=tk.DISABLED)
        self.captcha_btn.config(state=tk.DISABLED)

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
