"""
转录编排器 —— 协调音频下载和 STT 转录的全生命周期。

运行在 Bot 线程上，通过 multiprocessing 与 Worker 进程通信。

支持：
- 下载进度实时上报（字节数 / 百分比 / 速度）
- 阻塞等待当前视频转录完成后再继续下一个
- 转录完成后回调以保存课程进度
"""

import logging
import multiprocessing as mp
import os
import queue as std_queue
import re
import time
import uuid

from src.constants import (
    TRANSCRIPTION_DEBUG_KEEP_WAV,
    TRANSCRIPTION_DEFAULT_COURSE_NAME,
    TRANSCRIPTION_MIN_WAV_SIZE_BYTES,
    TRANSCRIPTION_ROOT_DIRNAME,
)
from src.transcriber.audio_capture import AudioRecorder, download_video_audio, find_ffmpeg
from src.transcriber.transcription_worker import transcription_worker_main

logger = logging.getLogger(__name__)


def sanitize_filename(name: str, max_length: int = 100) -> str:
    """清理文件名中的非法字符，确保可用于 Windows 文件系统。"""
    if not name:
        return TRANSCRIPTION_DEFAULT_COURSE_NAME
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'[_ ]{2,}', '_', name)
    name = name.strip('. ')
    if len(name) > max_length:
        name = name[:max_length]
    return name or TRANSCRIPTION_DEFAULT_COURSE_NAME


def _format_size(size_bytes: int) -> str:
    """将字节数格式化为人类可读字符串。"""
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    else:
        return f"{size_bytes / (1024 * 1024):.2f}MB"


# ============================================================================
# TranscriberManager
# ============================================================================


class TranscriberManager:
    """语音转文字编排器。

    Args:
        driver: Selenium WebDriver 实例
        gui_status_queue: 用于向 GUI 推送状态更新（dict: {text, color}）
        on_progress_saved: 转录完成后的回调 (course_note, video_title)
        use_download: True=直接下载视频提取音轨（仅转录模式），False=MediaRecorder实时录制
    """

    def __init__(
        self,
        driver,
        gui_status_queue: std_queue.Queue | None = None,
        on_progress_saved=None,
        should_stop=None,
        use_download: bool = False,
    ):
        self._driver = driver
        self._gui_queue = gui_status_queue
        self._on_progress_saved = on_progress_saved
        self._should_stop = should_stop or (lambda: False)
        self._use_download = use_download

        # ---- ffmpeg ----
        self._ffmpeg_path = find_ffmpeg()
        self._has_ffmpeg = self._ffmpeg_path is not None

        # 仅在实时录制模式需要 AudioRecorder；下载模式不需要
        if use_download:
            self._recorder = None  # 不使用 MediaRecorder
        else:
            self._recorder = (
                AudioRecorder(driver, self._ffmpeg_path)
                if self._has_ffmpeg
                else None
            )

        # ---- 路径配置 ----
        self._base_dir: str = ""
        self._output_root: str = ""
        self._temp_dir: str = ""
        self._course_name: str = TRANSCRIPTION_DEFAULT_COURSE_NAME
        self._course_dir: str = ""

        # ---- multiprocessing Worker ----
        self._ctx = mp.get_context("spawn")
        self._input_queue: mp.Queue = self._ctx.Queue()
        self._output_queue: mp.Queue = self._ctx.Queue()
        self._worker_stop = self._ctx.Event()
        self._worker: mp.Process | None = None

        # ---- 当前任务状态 ----
        self._current_recorder: AudioRecorder | None = None
        self._current_title: str = ""
        self._active_download_wav: str | None = None
        self._pending_jobs: dict[str, dict] = {}  # wav_path → metadata
        self._completed_count: int = 0
        self._failed_count: int = 0
        self._worker_healthy: bool = False

        # 阻塞等待用
        self._current_job_wav: str | None = None
        self._current_job_done: bool = False

        # ---- 启动 Worker ----
        if self._has_ffmpeg:
            self._start_worker()

    # ======================================================================
    # 公开属性
    # ======================================================================

    @property
    def available(self) -> bool:
        """转录是否可用。

        下载模式：需要 ffmpeg + worker 健康。
        实时录制模式：需要 AudioRecorder + worker 健康。
        """
        if self._use_download:
            return self._has_ffmpeg and self._worker_healthy
        return self._recorder is not None and self._worker_healthy

    @property
    def completed_count(self) -> int:
        return self._completed_count

    @property
    def pending_count(self) -> int:
        return len(self._pending_jobs)

    # ======================================================================
    # 路径配置
    # ======================================================================

    def set_base_dir(self, path: str) -> None:
        self._base_dir = path
        self._output_root = os.path.join(path, TRANSCRIPTION_ROOT_DIRNAME)
        self._temp_dir = os.path.join(self._output_root, ".temp")
        self._rebuild_course_dir()

    def set_course_name(self, name: str) -> None:
        self._course_name = sanitize_filename(name) if name else TRANSCRIPTION_DEFAULT_COURSE_NAME
        self._rebuild_course_dir()

    def _rebuild_course_dir(self) -> None:
        if self._output_root:
            self._course_dir = os.path.join(self._output_root, self._course_name)

    def _ensure_dirs(self) -> None:
        if self._temp_dir:
            os.makedirs(self._temp_dir, exist_ok=True)
        if self._course_dir:
            os.makedirs(self._course_dir, exist_ok=True)

    # ======================================================================
    # Worker 生命周期
    # ======================================================================

    def _start_worker(self) -> None:
        try:
            self._worker = self._ctx.Process(
                target=transcription_worker_main,
                args=(self._input_queue, self._output_queue, self._worker_stop),
                daemon=True,
            )
            self._worker.start()
            self._worker_healthy = True
            logger.info("转录 Worker 进程已启动 (PID=%d)", self._worker.pid)
        except Exception as e:
            logger.error("启动转录 Worker 失败: %s", e)
            self._worker_healthy = False
            self._push_status("转录: Worker 启动失败", "red")

    def _restart_worker_if_needed(self) -> None:
        if self._worker is None:
            return
        if not self._worker.is_alive():
            logger.warning("转录 Worker 进程已退出，尝试重启...")
            self._worker_stop.clear()
            self._start_worker()
            if self._worker_healthy:
                self._push_status(
                    f"转录: 已恢复 ({self._completed_count} 节已完成)", "blue"
                )

    # ======================================================================
    # 下载进度
    # ======================================================================

    def get_download_progress(self) -> dict:
        """获取当前录制进度（非阻塞）。"""
        if self._current_recorder is None:
            return {
                "title": "", "current_size": 0, "estimated_total": 0,
                "percent": 0.0, "speed": "", "running": False, "done": False,
            }
        prog = self._current_recorder.get_progress()
        prog["title"] = self._current_title
        return prog

    # ======================================================================
    # 视频生命周期回调（在 Bot 线程上调用）
    # ======================================================================

    def on_video_begin(self, title: str) -> None:
        """视频开始播放时：启动 MediaRecorder 录音。"""
        if not self.available:
            return

        self._current_title = title
        self._current_recorder = None
        self._current_job_wav = None
        self._current_job_done = False
        self._active_download_wav = None

        # 获取视频时长用于进度估算
        duration = 0.0
        try:
            dur = self._driver.execute_script(
                "var v=document.querySelector('video');return v&&v.duration||0;"
            )
            duration = float(dur) if dur else 0.0
        except Exception:
            pass

        # 生成本次录制的 WAV 路径
        self._ensure_dirs()
        wav_name = f"{uuid.uuid4().hex}.wav"
        wav_path = os.path.join(self._temp_dir, wav_name)

        # 启动 MediaRecorder
        ok = self._recorder.start_recording(
            wav_path, download_dir=self._temp_dir, total_duration_sec=duration,
        )
        if ok:
            self._active_download_wav = wav_path
            self._current_recorder = self._recorder
            self._push_download_progress()
        else:
            logger.warning("MediaRecorder 启动失败，跳过 '%s' 的转录", title)
            self._push_status(f"转录: 无法录音 ({title})", "orange")

    def on_video_end(self, title: str) -> None:
        """视频播放结束：停止录音 + CDP 下载 WebM + ffmpeg 转 WAV + 入队转录。"""
        if not self.available or self._current_recorder is None:
            self._current_job_done = True
            return

        wav_path = self._active_download_wav
        recorder = self._current_recorder

        # 停止录音并触发下载（阻塞等待文件就绪）
        logger.info("停止录音并等待 WebM 下载...")
        ok = recorder.stop_and_collect()

        if not ok:
            logger.error("录音/下载失败，跳过 '%s' 的转录", title)
            self._failed_count += 1
            self._current_job_done = True
            self._current_recorder = None
            self._active_download_wav = None
            self._push_status(
                f"转录: {self._completed_count} 完成 {self._failed_count} 失败", "red"
            )
            self._cleanup_temp(wav_path)
            return

        # ffmpeg 转换 WebM → WAV
        logger.info("转换 WebM → WAV...")
        self._push_status(f"转录: 转换音频中 [{title[:20]}]", "blue")
        ok = recorder.convert_webm_to_wav()

        self._current_recorder = None
        self._active_download_wav = None

        if not ok:
            logger.error("WebM→WAV 转换失败，跳过 '%s' 的转录", title)
            self._failed_count += 1
            self._current_job_done = True
            self._push_status(
                f"转录: {self._completed_count} 完成 {self._failed_count} 失败", "red"
            )
            self._cleanup_temp(wav_path)
            return

        # 检查 WAV 文件
        if not wav_path or not os.path.isfile(wav_path):
            self._failed_count += 1
            self._current_job_done = True
            self._cleanup_temp(wav_path)
            return

        wav_size = os.path.getsize(wav_path)
        if wav_size < TRANSCRIPTION_MIN_WAV_SIZE_BYTES:
            logger.warning("音频文件过小 (%d bytes)，可能无音频轨道", wav_size)
            self._failed_count += 1
            self._current_job_done = True
            self._push_status(
                f"转录: {self._completed_count} 完成 {self._failed_count} 失败", "orange"
            )
            self._cleanup_temp(wav_path)
            return

        # 入队转录任务
        self._ensure_dirs()
        safe_title = sanitize_filename(title)
        txt_path = os.path.join(self._course_dir, f"{safe_title}.txt")

        metadata = {
            "course_name": self._course_name,
            "video_title": title,
            "output_txt": txt_path,
        }

        self._input_queue.put((wav_path, metadata))
        self._pending_jobs[wav_path] = metadata
        self._current_job_wav = wav_path
        self._push_status(
            f"转录: 转文字中 [{title[:20]}]", "blue"
        )

    def _push_download_progress(self) -> None:
        """从 recorder 读取录制进度并推送到 GUI 队列。"""
        if self._current_recorder is None:
            return
        prog = self._current_recorder.get_progress()
        title = self._current_title or "?"

        current_str = _format_size(prog["current_size"])
        total_str = _format_size(prog["estimated_total"]) if prog["estimated_total"] > 0 else "?"

        if prog["running"]:
            text = (
                f"转录: 录音中 [{title[:20]}] {current_str} "
                f"({prog['percent']:.0f}%)"
            )
        elif prog["done"]:
            text = f"转录: 录音完成 [{title[:20]}] {current_str}"
        else:
            text = f"转录: 准备录音 [{title[:20]}]"

        self._push_status(text, "blue")

    # ======================================================================
    # 直接下载视频提取音轨（类似 IDM，用于仅转录模式）
    # ======================================================================

    def transcribe_via_download(self, title: str) -> bool:
        """下载视频 → 提取音轨 → 入队转录 → 阻塞等待完成。

        无需 1x 实时播放，下载速度取决于网速。
        用于仅转录模式——跳过视频监控，直接获取音频。

        Returns:
            True 表示转录已入队并完成
        """
        if not self.available:
            return False

        self._ensure_dirs()

        # 1. 获取当前视频的媒体 URL（重试等待视频元素加载 src）
        video_url = ""
        for attempt in range(10):
            try:
                video_url = self._driver.execute_script(
                    "var v=document.querySelector('video');"
                    "return v&&(v.src||v.currentSrc)||'';"
                ) or ""
            except Exception as e:
                logger.error("获取视频 URL 失败: %s", e)
                break
            if video_url and video_url.startswith("http"):
                break
            time.sleep(2)

        if not video_url or not video_url.startswith("http"):
            logger.error("视频 URL 无效（%d次重试后）: %s", attempt + 1, video_url[:120])
            self._push_status(f"转录: URL无效 [{title[:20]}]", "red")
            self._failed_count += 1
            self._current_job_done = True
            return False

        logger.info("准备下载视频音频: %s", title)

        # 2. 下载 + 提取音轨
        wav_path = os.path.join(self._temp_dir, f"{uuid.uuid4().hex}.wav")
        self._push_status(
            f"转录: 下载中 [{title[:20]}]", "blue"
        )

        ok = download_video_audio(
            self._driver, video_url, wav_path, self._ffmpeg_path,
        )

        if not ok:
            logger.error("下载/提取音轨失败: %s", title)
            self._failed_count += 1
            self._current_job_done = True
            self._push_status(
                f"转录: {self._completed_count} 完成 {self._failed_count} 失败", "red"
            )
            self._cleanup_temp(wav_path)
            return False

        # 检查文件大小
        if os.path.getsize(wav_path) < TRANSCRIPTION_MIN_WAV_SIZE_BYTES:
            logger.warning("音频文件过小，跳过转录: %s", title)
            self._failed_count += 1
            self._current_job_done = True
            self._cleanup_temp(wav_path)
            return False

        # 3. 入队转录 + 等待完成
        safe_title = sanitize_filename(title)
        txt_path = os.path.join(self._course_dir, f"{safe_title}.txt")
        metadata = {
            "course_name": self._course_name,
            "video_title": title,
            "output_txt": txt_path,
        }

        self._input_queue.put((wav_path, metadata))
        self._pending_jobs[wav_path] = metadata
        self._current_job_wav = wav_path
        self._current_job_done = False
        self._push_status(
            f"转录: 转文字中 [{title[:20]}]", "blue"
        )

        # 阻塞等待转录完成
        self.wait_for_current_job()
        return True

    # ======================================================================
    # 阻塞等待转录完成
    # ======================================================================

    def wait_for_current_job(self, timeout: int = 3600) -> bool:
        """阻塞等待当前视频的转录任务完成。

        在视频循环中每一轮结束后调用，确保转文字完成后再刷下一节课。

        Returns:
            True 表示转录完成（或无需等待），False 表示超时或收到停止信号
        """
        if not self.available:
            return True

        if self._current_job_done and self._current_job_wav is None:
            return True

        waited = 0
        poll_interval = 1.0  # 每秒检查一次

        while waited < timeout:
            # 检查外部停止信号
            if self._should_stop():
                logger.info("收到停止信号，放弃等待转录")
                self._current_job_wav = None
                self._current_job_done = True
                return False

            # 处理结果队列
            self._drain_output_queue()

            if self._current_job_done or (
                self._current_job_wav is not None
                and self._current_job_wav not in self._pending_jobs
            ):
                self._current_job_wav = None
                self._current_job_done = True
                return True

            time.sleep(poll_interval)
            waited += poll_interval

        logger.warning("等待转录完成超时 (%ds)", timeout)
        self._current_job_wav = None
        self._current_job_done = True
        return False

    def _drain_output_queue(self) -> None:
        """处理所有已完成的结果（非阻塞）。"""
        # 先 drain 结果队列（可能包含 fatal 消息），再决定是否重启
        self._drain_output_queue_only()

        if self._worker_healthy:
            self._restart_worker_if_needed()

    def _drain_output_queue_only(self) -> None:
        """仅从 output_queue 中取出已完成任务，不触发 worker 重启。"""
        while True:
            try:
                result = self._output_queue.get_nowait()
            except std_queue.Empty:
                break

            status, wav_path, metadata, text = result
            video_title = metadata.get("video_title", "?")
            txt_path = metadata.get("output_txt", "")
            course_name = metadata.get("course_name", "")

            if status == "fatal":
                self._failed_count += 1
                self._worker_healthy = False
                logger.error("转录 Worker 致命错误: %s", text)
                self._push_status("转录: Worker 致命错误，已停用", "red")
            elif status == "ok":
                try:
                    os.makedirs(os.path.dirname(txt_path), exist_ok=True)
                    self._write_transcript(txt_path, metadata, text)
                    self._completed_count += 1
                    logger.info("转录完成: %s → %s", video_title, txt_path)
                    self._push_status(
                        f"转录: 已完成 {self._completed_count} 节", "green"
                    )

                    # 回调：保存课程进度
                    if self._on_progress_saved:
                        try:
                            self._on_progress_saved(course_name, video_title)
                        except Exception as e:
                            logger.debug("保存课程进度回调失败: %s", e)
                except Exception as e:
                    logger.error("写入转录文件失败 %s: %s", txt_path, e)
                    self._failed_count += 1
            else:
                self._failed_count += 1
                logger.error("转录失败: %s, 错误: %s", video_title, text)

            self._pending_jobs.pop(wav_path, None)
            self._cleanup_temp(wav_path)

    # ======================================================================
    # 结果轮询（Bot 线程定期调用，非阻塞）
    # ======================================================================

    def poll_results(self) -> None:
        """非阻塞检查转录结果（内部调用 _drain_output_queue）。"""
        self._drain_output_queue()

    def _write_transcript(self, txt_path: str, metadata: dict, text: str) -> None:
        from datetime import datetime
        course_name = metadata.get("course_name", "")
        video_title = metadata.get("video_title", "")

        header = (
            f"# 课程: {course_name}\n"
            f"# 课时: {video_title}\n"
            f"# 转录时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"# 模型: SenseVoiceSmall\n"
            f"\n"
        )

        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(header)
            f.write(text)
            f.write("\n")

    # ======================================================================
    # 清理与关闭
    # ======================================================================

    def shutdown(self) -> None:
        logger.info("转录管理器正在关闭...")

        if self._current_recorder is not None:
            self._current_recorder = None

        self._worker_stop.set()
        try:
            self._input_queue.put(None)
        except Exception:
            pass

        if self._worker is not None:
            self._worker.join(timeout=10)
            if self._worker.is_alive():
                logger.warning("转录 Worker 未在 10s 内退出，强制终止")
                self._worker.terminate()
                self._worker.join(timeout=5)
            self._worker = None

        self._worker_healthy = False
        logger.info("转录管理器已关闭（完成 %d 节，失败 %d 节）",
                     self._completed_count, self._failed_count)

    @staticmethod
    def _cleanup_temp(wav_path: str | None) -> None:
        if TRANSCRIPTION_DEBUG_KEEP_WAV:
            return  # 调试模式：保留所有 WAV 文件
        if wav_path and os.path.isfile(wav_path):
            try:
                os.remove(wav_path)
            except OSError as e:
                logger.debug("清理临时文件失败 %s: %s", wav_path, e)

    # ======================================================================
    # GUI 状态推送
    # ======================================================================

    def _push_status(self, text: str, color: str) -> None:
        if self._gui_queue is not None:
            try:
                self._gui_queue.put_nowait({"text": text, "color": color})
            except std_queue.Full:
                pass
