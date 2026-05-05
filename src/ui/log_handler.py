"""
GUI 日志处理器 —— 将 logging 记录投递到队列，供 Tkinter 线程轮询显示。
"""

import logging


class QueueLogHandler(logging.Handler):
    """将日志记录格式化后发送到 queue.Queue，供 GUI 线程消费。"""

    def __init__(self, log_queue):
        super().__init__()
        self.log_queue = log_queue
        self.setFormatter(
            logging.Formatter("%(asctime)s %(message)s", datefmt="%H:%M:%S")
        )

    def emit(self, record):
        self.log_queue.put(self.format(record))
