import logging
import queue
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk

import keyring

from database import Database
from zhihuishu_bot import ZhiHuiShuBot

KEYRING_SERVICE = "zhihuishu_auto_course"
KEYRING_USER_KEY = "zhanghao"
KEYRING_PASS_KEY = "mima"


class QueueLogHandler(logging.Handler):
    """Logging handler that sends records to a queue for GUI display."""

    def __init__(self, log_queue):
        super().__init__()
        self.log_queue = log_queue
        self.setFormatter(logging.Formatter("%(asctime)s %(message)s", datefmt="%H:%M:%S"))

    def emit(self, record):
        self.log_queue.put(self.format(record))


class ZhiHuiShuGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("智慧树自动刷课")
        self.root.geometry("720x680")
        self.root.resizable(True, True)

        # Database
        self.db = Database()
        self._video_history_data = []  # [(url, note), ...] for ComboboxSelected lookup

        # Thread communication
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

    # ---------- keyring helpers ----------

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

    # ---------- load / save ----------

    def _load_saved_values(self):
        """Load previously saved config from keyring and DB."""
        self._refresh_url_history()
        # Auto-fill with latest URL from history
        logged_history = self.db.get_url_history("logged")
        if logged_history:
            self.logged_url_var.set(logged_history[0][0])
        video_history = self.db.get_url_history("video")
        if video_history:
            self.video_url_var.set(video_history[0][0])
            self.course_note_var.set(video_history[0][1])
        self.zhanghao_var.set(self._kr_get(KEYRING_USER_KEY))
        self.mima_var.set(self._kr_get(KEYRING_PASS_KEY))
        saved_limit = self.db.get_setting("time_limit", "")
        self.time_limit_var.set(saved_limit)

    def _save_all_values(self):
        """Persist current field values to keyring and DB."""
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
        """When user picks a video URL from the dropdown, fill URL and note fields."""
        idx = self.video_url_combo.current()
        if 0 <= idx < len(self._video_history_data):
            url, note = self._video_history_data[idx]
            self.video_url_var.set(url)
            self.course_note_var.set(note)

    def _on_video_url_changed(self, *args):
        """When the video URL text changes, sync the note field from DB."""
        current_url = self.video_url_var.get().strip()
        note = self.db.get_note_for_url(current_url)
        self.course_note_var.set(note)

    # ---------- UI construction ----------

    def _build_ui(self):
        # === Row 0: Account config ===
        acct_frame = ttk.LabelFrame(self.root, text="账号配置", padding=10)
        acct_frame.pack(fill=tk.X, padx=10, pady=(10, 5))

        ttk.Label(acct_frame, text="账号:").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.zhanghao_var = tk.StringVar()
        self.zhanghao_entry = ttk.Entry(acct_frame, textvariable=self.zhanghao_var, width=60)
        self.zhanghao_entry.grid(row=0, column=1, sticky=tk.EW, pady=2, padx=(0, 5))

        ttk.Label(acct_frame, text="密码:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.mima_var = tk.StringVar()
        self.mima_entry = ttk.Entry(
            acct_frame, textvariable=self.mima_var, show="●", width=60
        )
        self.mima_entry.grid(row=1, column=1, sticky=tk.EW, pady=2, padx=(0, 5))
        self.show_pwd_var = tk.BooleanVar(value=False)
        self.show_pwd_cb = ttk.Checkbutton(
            acct_frame, text="显示", variable=self.show_pwd_var,
            command=self._toggle_pwd_visibility,
        )
        self.show_pwd_cb.grid(row=1, column=2, pady=2)

        acct_frame.columnconfigure(1, weight=1)

        # === Row 1: Course URL config ===
        url_frame = ttk.LabelFrame(self.root, text="课程配置", padding=10)
        url_frame.pack(fill=tk.X, padx=10, pady=5)

        ttk.Label(url_frame, text="登录跳转URL:").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.logged_url_var = tk.StringVar()
        self.logged_url_combo = ttk.Combobox(
            url_frame, textvariable=self.logged_url_var, width=77
        )
        self.logged_url_combo.grid(row=0, column=1, sticky=tk.EW, pady=2)

        ttk.Label(url_frame, text="课程视频URL:").grid(row=1, column=0, sticky=tk.W, pady=2)
        self.video_url_var = tk.StringVar()
        self.video_url_combo = ttk.Combobox(
            url_frame, textvariable=self.video_url_var, width=77
        )
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

        url_frame.columnconfigure(1, weight=1)

        # === Row 2: Buttons ===
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

        # === Row 3: Status + CAPTCHA ===
        status_frame = ttk.LabelFrame(self.root, text="运行状态", padding=10)
        status_frame.pack(fill=tk.X, padx=10, pady=5)

        self.status_label = ttk.Label(
            status_frame, text="● 就绪 - 点击'开始运行'启动脚本", foreground="gray"
        )
        self.status_label.pack(side=tk.LEFT, padx=(0, 20))

        self.captcha_btn = ttk.Button(
            status_frame,
            text="确认验证码已完成",
            command=self._on_confirm_captcha,
            state=tk.DISABLED,
        )
        self.captcha_btn.pack(side=tk.RIGHT)

        self.captcha_hint = ttk.Label(status_frame, text="", foreground="red", wraplength=400)
        self.captcha_hint.pack(side=tk.RIGHT, padx=(0, 10))

        # === Row 4: Log area ===
        log_frame = ttk.LabelFrame(self.root, text="运行日志", padding=5)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(5, 10))

        self.log_area = scrolledtext.ScrolledText(
            log_frame, wrap=tk.WORD, state=tk.DISABLED, font=("Consolas", 9),
        )
        self.log_area.pack(fill=tk.BOTH, expand=True)

    def _toggle_pwd_visibility(self):
        self.mima_entry.config(show="" if self.show_pwd_var.get() else "●")

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
        self.root.after(200, self._poll_log_queue)

    # ---------- CAPTCHA status ----------

    def _check_captcha_status(self):
        if self.captcha_needed.is_set():
            self.status_label.config(
                text="⚠ 检测到验证码 — 请在浏览器中完成验证", foreground="red"
            )
            self.captcha_btn.config(state=tk.NORMAL)
        self.root.after(500, self._check_captcha_status)

    def _on_confirm_captcha(self):
        self.captcha_done.set()
        self.captcha_needed.clear()
        self.captcha_btn.config(state=tk.DISABLED)
        self.captcha_hint.config(text="")
        self.status_label.config(text="● 正在运行", foreground="green")

    # ---------- Bot lifecycle ----------

    def _start_bot(self, login_method):
        if self.running:
            return
        self.running = True
        self.stop_event.clear()
        self.captcha_needed.clear()
        self.captcha_done.clear()
        self.start_zhihuishu_btn.config(state=tk.DISABLED)
        self.start_upc_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)

        # Hardcoded base URL per login method
        if login_method == "upc":
            base_url = "https://i.upc.edu.cn/"
        else:
            base_url = "https://onlineweb.zhihuishu.com/"

        self.status_label.config(
            text="● 正在初始化 (%s)..." % ("数字石大" if login_method == "upc" else "智慧树"),
            foreground="green",
        )

        username = self.zhanghao_var.get().strip()
        password = self.mima_var.get()
        logged_url = self.logged_url_var.get().strip()
        video_url = self.video_url_var.get().strip()
        try:
            time_limit = int(self.time_limit_var.get() or "0")
        except ValueError:
            time_limit = 0

        # Save to persistent storage
        self._save_all_values()

        bot = ZhiHuiShuBot(
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
