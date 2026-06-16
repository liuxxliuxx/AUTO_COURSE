"""
音频捕获模块 —— 两种方式获取课程视频的音频轨道。

方式一：MediaRecorder 浏览器内录
    通过 video.captureStream() + MediaRecorder API 实时录制浏览器播放的音频，
    录完后通过 CDP 触发浏览器下载 WebM 文件，再用 ffmpeg 转 WAV。

方式二：直接下载视频提取音轨（类似 IDM）
    从 Selenium 提取浏览器 cookies 和 Referer，用 requests 直接下载
    CDN 上的 mp4 视频文件，然后用 ffmpeg 提取音频轨道。
    无需 1x 实时播放，下载速度取决于网速（比实时播放快很多）。
"""

import logging
import os
import shutil
import subprocess
import sys
import threading
import time as _time
import uuid

from src.constants import (
    TRANSCRIPTION_URL_RETRIES,
    TRANSCRIPTION_URL_RETRY_INTERVAL,
)

logger = logging.getLogger(__name__)


# ============================================================================
# ffmpeg 发现
# ============================================================================


def find_ffmpeg() -> str | None:
    """在系统中搜索 ffmpeg 可执行文件，返回绝对路径或 None。"""
    path = shutil.which("ffmpeg")
    if path:
        logger.info("在 PATH 中找到 ffmpeg: %s", path)
        return path

    candidates = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\ffmpeg.exe",
    ]
    conda_prefix = os.environ.get("CONDA_PREFIX", "")
    if conda_prefix:
        candidates.append(os.path.join(conda_prefix, "Library", "bin", "ffmpeg.exe"))
    scoop_dir = os.path.join(os.path.expanduser("~"), "scoop", "apps", "ffmpeg", "current")
    if os.path.isdir(scoop_dir):
        candidates.append(os.path.join(scoop_dir, "ffmpeg.exe"))
    candidates.append(r"C:\ProgramData\chocolatey\bin\ffmpeg.exe")
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if local_appdata:
        import glob
        candidates.extend(glob.glob(
            os.path.join(local_appdata, "Microsoft", "WinGet", "Packages", "*ffmpeg*", "ffmpeg.exe")
        ))
    for cand in candidates:
        if os.path.isfile(cand):
            logger.info("在常见路径中找到 ffmpeg: %s", cand)
            return cand

    logger.warning("未检测到 ffmpeg。请通过 conda install -c conda-forge ffmpeg 安装")
    return None


# ============================================================================
# 常量
# ============================================================================

_AUDIO_BYTES_PER_SECOND = 16000 * 1 * 2  # = 32000


def estimate_total_size(duration_seconds: float) -> int:
    return int(duration_seconds * _AUDIO_BYTES_PER_SECOND)


# ============================================================================
# MediaRecorder JS
# ============================================================================

_START_RECORDING_JS = """
// 注意：不要用 IIFE！Selenium execute_script 会把代码包在函数里。
if (window.__zhs_audio_chunks) return 'already_recording';
var video = document.querySelector('video');
if (!video) return 'no_video';
try {
    var stream = video.captureStream();

    // 诊断 track 状态
    var audioTracks = stream.getAudioTracks();
    var videoTracks = stream.getVideoTracks();
    var trackDiag = [];
    for (var t = 0; t < audioTracks.length; t++) {
        trackDiag.push('a:' + audioTracks[t].readyState);
    }
    for (var t = 0; t < videoTracks.length; t++) {
        trackDiag.push('v:' + videoTracks[t].readyState);
    }
    console.log('[zhs] tracks:', trackDiag.join(','),
                'playing:', !video.paused,
                'muted:', video.muted);

    // 提取纯音频流（只用 audio tracks 重建 MediaStream）
    // 因为原始 stream 含 video+audio，会导致 MediaRecorder 行为不确定
    var audioStream = null;
    var mime = null;
    try {
        audioStream = new MediaStream(audioTracks);
    } catch(e2) {
        return 'new_mediastream_error:' + e2.name + ':' + e2.message;
    }

    // 构造 MediaRecorder：不指定 mimeType，让浏览器选默认编码
    // 指定 mimeType 有时会导致 NotSupportedError (尤其在 track 来自 captureStream 时)
    try {
        window.__zhs_mediaRecorder = new MediaRecorder(audioStream);
        mime = window.__zhs_mediaRecorder.mimeType || 'default';
    } catch(e3) {
        return 'new_recorder_error:' + e3.name + ':' + e3.message;
    }

    window.__zhs_audio_chunks = [];
    window.__zhs_mediaRecorder.ondataavailable = function(e) {
        if (e.data && e.data.size > 0)
            window.__zhs_audio_chunks.push(e.data);
    };
    window.__zhs_mediaRecorder.onerror = function(e) {
        window.__zhs_recorder_error = e.error ? e.error.message : 'unknown';
    };

    // 不传 timeslice 参数（5000），避免某些 Chrome 版本的 bug
    window.__zhs_mediaRecorder.start();
    return 'ok:' + mime + ':' + trackDiag.join(',');
} catch(e) {
    return 'error:' + e.name + ':' + e.message;
}
"""

# 停止录音 + 触发浏览器下载
_STOP_AND_DOWNLOAD_JS = """
// 注意：不要用 IIFE！execute_async_script 通过 callback 返回结果。
var filename = arguments[0];
var callback = arguments[arguments.length - 1];

if (!window.__zhs_mediaRecorder || !window.__zhs_audio_chunks) {
    callback('no_recorder');
    return;
}

var recorder = window.__zhs_mediaRecorder;
var chunks = window.__zhs_audio_chunks;
window.__zhs_mediaRecorder = null;
window.__zhs_audio_chunks = null;

function processChunks() {
    try {
        var totalSize = 0;
        chunks.forEach(function(b) { totalSize += b.size; });
        if (totalSize === 0) { callback('empty'); return; }

        var blob = new Blob(chunks, {type: 'audio/webm'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // 延迟 revoke 以确保下载开始
        setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
        callback('ok:' + totalSize);
    } catch(e) { callback('error:' + e.message); }
}

// 检查 recorder 是否已经处于 inactive 状态
// （视频结束后 captureStream 的 track 自动结束，MediaRecorder 也会自动停止）
if (recorder.state === 'inactive') {
    // 已经在 inactive 状态，直接处理已有的 chunks
    processChunks();
} else {
    // 正常情况：设置 onstop 回调，然后 stop
    recorder.onstop = processChunks;
    try {
        recorder.stop();
    } catch(e) {
        // stop() 可能因状态问题失败，直接处理 chunks
        processChunks();
    }
}
"""


# ============================================================================
# AudioRecorder
# ============================================================================


class AudioRecorder:
    """通过浏览器 MediaRecorder API 录制视频音频轨道。

    录音完成后通过 CDP downloadBehavior 将 WebM 文件直接写入磁盘，
    避免通过 Selenium JS 返回值传输大量 base64 数据。
    """

    def __init__(self, driver, ffmpeg_path: str):
        self._driver = driver
        self._ffmpeg_path = ffmpeg_path
        self._recording = False
        self._output_wav: str | None = None
        self._webm_file: str | None = None
        self._webm_expected_name = "zhs_audio.webm"
        self._download_dir: str = ""
        self._total_duration_sec: float = 0.0
        self._recording_start_time: float = 0.0
        self._expected_total: int = 0

        # 进度
        self._lock = threading.Lock()
        self._last_size: int = 0
        self._last_size_time: float = 0.0
        self._speed_smooth: float = 0.0

    # ------------------------------------------------------------------
    # 录制生命周期
    # ------------------------------------------------------------------

    def start_recording(
        self, output_wav: str, download_dir: str, total_duration_sec: float = 0.0,
    ) -> bool:
        """启动录音（优先 MediaRecorder，失败则用 WASAPI 系统音频捕获）。

        Args:
            output_wav: 最终 WAV 文件路径
            download_dir: CDP 下载目录
            total_duration_sec: 视频时长（用于进度估算）
        """
        self._output_wav = output_wav
        self._download_dir = download_dir
        self._total_duration_sec = total_duration_sec
        self._expected_total = (
            estimate_total_size(total_duration_sec) if total_duration_sec > 0 else 0
        )
        self._recording_start_time = _time.time()
        self._last_size = 0
        self._last_size_time = 0.0
        self._speed_smooth = 0.0

        os.makedirs(os.path.dirname(output_wav), exist_ok=True)
        os.makedirs(download_dir, exist_ok=True)

        # 1. 先诊断浏览器能力
        self._diagnose_capture_capability()

        # 2. 尝试 MediaRecorder
        try:
            self._driver.execute_cdp_cmd("Browser.setDownloadBehavior", {
                "behavior": "allow",
                "downloadPath": os.path.abspath(download_dir),
                "eventsEnabled": True,
            })
        except Exception as e:
            logger.warning("CDP downloadBehavior 失败: %s", e)

        result = self._driver.execute_script(_START_RECORDING_JS)
        logger.info("MediaRecorder 启动: %s", result)

        if result and (str(result) == "already_recording" or str(result).startswith("ok:")):
            self._recording = True
            return True

        # 3. MediaRecorder 失败，尝试 WASAPI 系统音频
        logger.info("MediaRecorder 不可用 (%s)，尝试WASAPI...", result)
        ok = self._start_wasapi_recording()
        if ok:
            self._recording = True
            return True

        logger.warning("所有录音方式均失败")
        return False

    def _diagnose_capture_capability(self) -> None:
        """诊断浏览器录制能力，辅助调试。"""
        try:
            info = self._driver.execute_script("""
                var v = document.querySelector('video');
                if (!v) return 'NO_VIDEO_ELEMENT';
                var info = {
                    src: (v.src||v.currentSrc||'').substring(0,80),
                    crossOrigin: v.crossOrigin || '(empty)',
                    hasCaptureStream: !!v.captureStream,
                    readyState: v.readyState,
                    networkState: v.networkState,
                    muted: v.muted,
                    audioTracks: v.audioTracks ? v.audioTracks.length : 'N/A',
                };
                try {
                    var s = v.captureStream();
                    info.captureOK = true;
                    info.audioTracksFromStream = s.getAudioTracks().length;
                } catch(e) {
                    info.captureOK = false;
                    info.captureError = e.name + ': ' + e.message;
                }
                return JSON.stringify(info);
            """)
            logger.info("Capture 诊断: %s", info)
        except Exception as e:
            logger.warning("Capture 诊断失败: %s", e)

    # ------------------------------------------------------------------
    # WASAPI 系统音频回环（MediaRecorder 备选方案）
    # ------------------------------------------------------------------

    def _find_wasapi_loopback_device(self) -> int | None:
        """查找 WASAPI 回环设备索引。

        策略（按优先级）：
        1. 名称含 "loopback"/"stereo mix"/"立体声混音" 的输入设备（任意 host API）
        2. WASAPI host API 的默认输出设备（用 loopback 模式打开）
        用 callback 模式录制（兼容 WDM-KS 等不支持 blocking read 的 host API）。
        """
        try:
            import sounddevice as sd
        except ImportError:
            logger.warning("sounddevice 未安装，无法使用 WASAPI")
            return None

        devices = sd.query_devices()
        hostapis = sd.query_hostapis()

        # 打印所有设备信息便于调试
        logger.info("=== 音频设备列表 ===")
        for i, dev in enumerate(devices):
            hostapi_name = hostapis[dev["hostapi"]]["name"] if dev["hostapi"] < len(hostapis) else "?"
            logger.info(
                "  [%d] \"%s\" | in=%d out=%d | %s | default=%s",
                i, dev["name"],
                dev["max_input_channels"], dev["max_output_channels"],
                hostapi_name,
                "in" if i == sd.default.device[0] else "out" if i == sd.default.device[1] else "",
            )

        # 策略 1：按名称搜索回环/立体声混音设备（含 WDM-KS，用 callback 模式）
        for i, dev in enumerate(devices):
            name = dev.get("name", "").lower()
            max_in = dev.get("max_input_channels", 0)
            if max_in > 0 and ("loopback" in name or "stereo mix" in name or "立体声混音" in name):
                api_name = hostapis[dev["hostapi"]]["name"].lower() if dev["hostapi"] < len(hostapis) else ""
                logger.info("找到立体声混音设备 [%d]: %s (hostapi=%s, callback模式)", i, dev["name"], api_name)
                self._wasapi_use_callback = ("wdm-ks" in api_name)
                self._wasapi_channels = min(max_in, 2)
                return i

        # 策略 2：在 WASAPI host API 下查找默认输出设备，用 loopback 模式捕获
        wasapi_api_idx = None
        for idx, api in enumerate(hostapis):
            if "wasapi" in api["name"].lower():
                wasapi_api_idx = idx
                break

        if wasapi_api_idx is not None:
            default_out = sd.default.device[1]
            if default_out is not None and default_out >= 0:
                dev = devices[default_out]
                if dev["hostapi"] == wasapi_api_idx and dev["max_output_channels"] > 0:
                    logger.info(
                        "使用 WASAPI 默认输出设备 [%d]: %s (loopback)",
                        default_out, dev["name"],
                    )
                    self._wasapi_use_callback = False
                    self._wasapi_channels = min(dev["max_output_channels"], 2)
                    return default_out

            # 备选：任意 WASAPI 输出设备
            for i, dev in enumerate(devices):
                if dev["hostapi"] != wasapi_api_idx:
                    continue
                if dev["max_output_channels"] > 0:
                    logger.info("使用 WASAPI 输出设备 [%d]: %s (loopback)", i, dev["name"])
                    self._wasapi_use_callback = False
                    self._wasapi_channels = min(dev["max_output_channels"], 2)
                    return i

        logger.warning("未找到任何 WASAPI 回环/立体声混音设备，WASAPI 录音不可用")
        return None

    def _start_wasapi_recording(self) -> bool:
        """启动 WASAPI 系统音频录制（后台线程）。"""
        try:
            import sounddevice as sd
        except ImportError:
            logger.warning("sounddevice 未安装。安装: pip install sounddevice numpy")
            return False

        device_idx = self._find_wasapi_loopback_device()
        if device_idx is None:
            return False

        self._wasapi_device = device_idx
        self._wasapi_frames = []
        self._wasapi_samplerate = 16000
        self._wasapi_running = True
        self._wasapi_thread = threading.Thread(
            target=self._wasapi_record_thread, daemon=True
        )
        self._wasapi_thread.start()
        mode = "callback" if getattr(self, "_wasapi_use_callback", False) else "blocking"
        logger.info("WASAPI 录音已启动 (device=%d, %dch, 16kHz, %s)", device_idx, self._wasapi_channels, mode)
        return True

    def _wasapi_record_thread(self) -> None:
        """WASAPI 录音线程。

        对 WDM-KS 等不支持 blocking read 的 host API 使用 callback 模式，
        其他情况使用 blocking read（更简单可靠）。
        """
        try:
            import sounddevice as sd
            import numpy as np

            use_callback = getattr(self, "_wasapi_use_callback", False)
            channels = getattr(self, "_wasapi_channels", 2)

            if use_callback:
                self._wasapi_record_callback(channels)
            else:
                self._wasapi_record_blocking(channels)
        except Exception as e:
            logger.error("WASAPI 录音线程出错: %s", e)

    def _wasapi_record_callback(self, channels: int) -> None:
        """Callback 模式录制（兼容 WDM-KS 等 host API）。"""
        import sounddevice as sd
        import numpy as np

        def callback(indata, frames, time_info, status):
            if status:
                logger.debug("WASAPI callback status: %s", status)
            if self._wasapi_running:
                # 立体声 → 取第一声道（或平均）
                if channels >= 2:
                    mono = indata[:, 0].copy()
                else:
                    mono = indata.copy().flatten()
                self._wasapi_frames.append(mono)

        blocksize = 4096
        with sd.InputStream(
            samplerate=self._wasapi_samplerate,
            channels=channels,
            device=self._wasapi_device,
            dtype=np.int16,
            blocksize=blocksize,
            callback=callback,
        ) as stream:
            while self._wasapi_running:
                _time.sleep(0.5)
            # 给 callback 一点时间处理最后的数据
            _time.sleep(0.2)

    def _wasapi_record_blocking(self, channels: int) -> None:
        """Blocking read 模式录制。"""
        import sounddevice as sd
        import numpy as np

        blocksize = 4096
        with sd.InputStream(
            samplerate=self._wasapi_samplerate,
            channels=channels,
            device=self._wasapi_device,
            dtype=np.int16,
            blocksize=blocksize,
        ) as stream:
            while self._wasapi_running:
                data, _ = stream.read(blocksize)
                # 立体声 → 取第一声道
                if channels >= 2:
                    mono = data[:, 0].copy()
                else:
                    mono = data.copy().flatten()
                self._wasapi_frames.append(mono)

            # 读取剩余缓冲区
            stream.read(blocksize)

    def _stop_wasapi_and_save(self) -> bool:
        """停止 WASAPI 录音并保存为 WAV。"""
        self._wasapi_running = False
        if hasattr(self, "_wasapi_thread") and self._wasapi_thread:
            self._wasapi_thread.join(timeout=5)

        if not hasattr(self, "_wasapi_frames") or not self._wasapi_frames:
            return False

        try:
            import numpy as np
            import wave

            all_data = np.concatenate(self._wasapi_frames)
            wav_path = self._output_wav
            if not wav_path:
                return False

            with wave.open(wav_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)  # 16-bit
                wf.setframerate(self._wasapi_samplerate)
                wf.writeframes(all_data.tobytes())

            file_size = os.path.getsize(wav_path)
            logger.info("WASAPI WAV 已保存: %s (%d bytes)", wav_path, file_size)
            return file_size > 0
        except Exception as e:
            logger.error("WASAPI 保存 WAV 失败: %s", e)
            return False

    def stop_and_collect(self) -> bool:
        """停止录音并保存音频文件。

        路径判断：
        - 如果是 WASAPI 录音 → 直接保存 WAV
        - 如果是 MediaRecorder → 触发下载 WebM + 等待文件就绪

        Returns:
            True — 音频文件已成功写入磁盘
        """
        if not self._recording:
            return False

        # ---- WASAPI 路径 ----
        if hasattr(self, "_wasapi_running") and self._wasapi_running:
            ok = self._stop_wasapi_and_save()
            self._recording = False
            if ok:
                self._webm_file = None  # WASAPI 直接写 WAV，无需转换
                return True
            return False

        # ---- MediaRecorder 路径 ----
        self._webm_expected_name = f"zhs_{uuid.uuid4().hex[:8]}.webm"

        try:
            result = self._driver.execute_async_script(
                _STOP_AND_DOWNLOAD_JS, self._webm_expected_name
            )
        except Exception as e:
            logger.error("MediaRecorder 停止/下载失败: %s", e)
            self._recording = False
            return False

        logger.info("MediaRecorder 下载触发: %s", result)

        if not result or not str(result).startswith("ok:"):
            logger.warning("MediaRecorder 结果异常: %s", result)
            self._recording = False
            return False

        self._webm_file = self._wait_for_download()
        if self._webm_file:
            file_size = os.path.getsize(self._webm_file)
            logger.info("WebM 文件已就绪: %s (%d bytes)", self._webm_file, file_size)
            self._recording = False
            return True
        else:
            logger.error("等待 WebM 下载超时")
            self._recording = False
            return False

    def _wait_for_download(self, timeout: float = 60.0) -> str | None:
        """等待 WebM 文件出现在下载目录。

        等待文件出现且文件大小稳定（不再增长）。
        """
        if not self._download_dir:
            return None

        expected = self._webm_expected_name
        full_path = os.path.join(self._download_dir, expected)

        waited = 0.0
        poll_interval = 0.5
        last_size = -1
        stable_count = 0

        while waited < timeout:
            if os.path.isfile(full_path):
                try:
                    current_size = os.path.getsize(full_path)
                except OSError:
                    _time.sleep(poll_interval)
                    waited += poll_interval
                    continue

                if current_size > 0 and current_size == last_size:
                    stable_count += 1
                    if stable_count >= 3:  # 连续3次大小不变 = 下载完成
                        return full_path
                else:
                    stable_count = 0
                    last_size = current_size

            _time.sleep(poll_interval)
            waited += poll_interval

        # 超时后如果文件存在且有内容，仍返回
        if os.path.isfile(full_path) and os.path.getsize(full_path) > 0:
            return full_path
        return None

    # ------------------------------------------------------------------
    # 进度
    # ------------------------------------------------------------------

    def get_progress(self) -> dict:
        """获取录制进度。MediaRecorder 以 1x 速度录制，进度即时间比例。"""
        now = _time.time()

        # 检查 WebM 文件大小（如果有的话）
        current_size = 0
        if self._webm_file and os.path.isfile(self._webm_file):
            try:
                current_size = os.path.getsize(self._webm_file)
            except OSError:
                pass

        # 速度
        with self._lock:
            if self._last_size_time > 0 and (now - self._last_size_time) >= 0.5:
                elapsed = now - self._last_size_time
                size_diff = current_size - self._last_size
                instant_speed = size_diff / elapsed if elapsed > 0 else 0.0
                self._speed_smooth = (
                    0.7 * instant_speed + 0.3 * self._speed_smooth
                    if self._speed_smooth > 0 else instant_speed
                )
                self._last_size = current_size
                self._last_size_time = now
            elif self._last_size_time == 0:
                self._last_size = current_size
                self._last_size_time = now

        speed_str = ""
        if self._speed_smooth > 100:
            ratio = self._speed_smooth / 32000.0
            speed_str = f"{ratio:.2f}x" if ratio < 1 else f"{ratio:.1f}x"

        # 百分比 = 已录制时间 / 总时长
        percent = 0.0
        if self._total_duration_sec > 0 and self._recording_start_time > 0:
            elapsed = now - self._recording_start_time
            percent = min(round(elapsed / self._total_duration_sec * 100, 1), 99.9)

        return {
            "current_size": current_size,
            "estimated_total": self._expected_total,
            "percent": percent,
            "speed": speed_str,
            "running": self._recording,
            "done": not self._recording and current_size > 0,
            "total_duration_sec": self._total_duration_sec,
        }

    # ------------------------------------------------------------------
    # ffmpeg WebM → WAV
    # ------------------------------------------------------------------

    def convert_webm_to_wav(self) -> bool:
        """将音频转为 16kHz mono PCM WAV（如果需要的话）。

        - WASAPI 路径：已直接输出 WAV，跳过转换
        - MediaRecorder 路径：WebM → ffmpeg → WAV
        """
        # WASAPI 已直接输出 WAV，无需转换
        if self._webm_file is None and self._output_wav and os.path.isfile(self._output_wav):
            logger.info("WAV 已就绪（WASAPI 直出）: %s", self._output_wav)
            return True

        if not self._webm_file or not os.path.isfile(self._webm_file):
            logger.error("WebM 文件不存在，无法转换")
            return False
        if not self._output_wav:
            return False

        cmd = [
            self._ffmpeg_path,
            "-y",
            "-i", self._webm_file,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            "-loglevel", "error",
            self._output_wav,
        ]

        logger.info("ffmpeg: WebM → WAV (16kHz mono)...")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                logger.error("ffmpeg 转换失败: %s", result.stderr[:500])
                return False
            if os.path.isfile(self._output_wav) and os.path.getsize(self._output_wav) > 0:
                size = os.path.getsize(self._output_wav)
                logger.info("WAV 转换完成: %s (%d bytes)", self._output_wav, size)
                # 清理 WebM
                try:
                    os.remove(self._webm_file)
                except OSError:
                    pass
                self._webm_file = None
                return True
            return False
        except subprocess.TimeoutExpired:
            logger.error("ffmpeg 转换超时")
            return False
        except Exception as e:
            logger.error("ffmpeg 转换出错: %s", e)
            return False

    @property
    def output_path(self) -> str | None:
        return self._output_wav


# ============================================================================
# 直接下载视频提取音轨（类似 IDM 的工作方式）
# ============================================================================


def download_video_audio(driver, video_url: str, output_wav: str, ffmpeg_path: str) -> bool:
    """从浏览器提取 cookies，用 requests 直接下载视频，ffmpeg 提取音轨。

    模仿 IDM 的工作原理：带上浏览器会话的 cookies 和 Referer，
    绕过 CDN 的 403 鉴权检查。

    Args:
        driver: Selenium WebDriver（用于提取 cookies 和 User-Agent）
        video_url: 视频资源 URL（从 video.src 获取）
        output_wav: 输出 WAV 文件的绝对路径
        ffmpeg_path: ffmpeg 可执行文件路径

    Returns:
        True 表示 WAV 已成功生成
    """
    import requests

    if not video_url or not video_url.startswith("http"):
        logger.error("无效的视频 URL: %s", video_url)
        return False

    # 1. 从浏览器提取 cookies
    try:
        selenium_cookies = driver.get_cookies()
    except Exception as e:
        logger.error("无法获取浏览器 cookies: %s", e)
        return False

    # 转换为 requests 可用的 dict
    cookies_dict = {}
    for c in selenium_cookies:
        # 只保留和 video URL 域名匹配的 cookie（或全部保留让 requests 自行匹配）
        cookies_dict[c["name"]] = c["value"]

    # 2. 构造请求头（模拟浏览器）
    user_agent = driver.execute_script("return navigator.userAgent;") or (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    )
    current_page = driver.execute_script("return window.location.href;") or ""
    headers = {
        "User-Agent": user_agent,
        "Referer": current_page or "https://studyvideoh5.zhihuishu.com/",
        "Origin": (
            current_page.rsplit("/", 2)[0] if current_page
            else "https://studyvideoh5.zhihuishu.com"
        ),
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Range": "bytes=0-",  # 部分 CDN 需要 Range 头
    }

    logger.info("开始下载视频: %s", video_url[:100])

    # 3. 下载视频（流式写入临时文件）
    tmp_video = output_wav + ".mp4.tmp"
    try:
        resp = requests.get(
            video_url,
            headers=headers,
            cookies=cookies_dict,
            stream=True,
            timeout=(30, 600),  # (connect, read) 超时
        )
        resp.raise_for_status()

        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        last_log = 0
        with open(tmp_video, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):  # 1MB
                f.write(chunk)
                downloaded += len(chunk)
                # 每 10MB 输出一次进度
                if downloaded - last_log >= 10 * 1024 * 1024:
                    last_log = downloaded
                    if total:
                        pct = downloaded / total * 100
                        logger.info(
                            "下载进度: %.1fMB / %.1fMB (%.0f%%)",
                            downloaded / 1048576, total / 1048576, pct,
                        )
                    else:
                        logger.info("下载进度: %.1fMB", downloaded / 1048576)

        file_size = os.path.getsize(tmp_video)
        if file_size < 1024 * 1024:  # < 1MB 可能不是视频
            logger.error("下载文件过小 (%d bytes)，可能鉴权失败", file_size)
            os.remove(tmp_video)
            return False

        logger.info("视频下载完成: %.1fMB", file_size / 1048576)

    except requests.RequestException as e:
        logger.error("视频下载失败: %s", e)
        if os.path.exists(tmp_video):
            os.remove(tmp_video)
        return False

    # 4. ffmpeg 提取音轨 → 16kHz mono WAV
    logger.info("提取音轨: %s → %s", os.path.basename(tmp_video), os.path.basename(output_wav))
    os.makedirs(os.path.dirname(output_wav), exist_ok=True)

    cmd = [
        ffmpeg_path, "-y",
        "-i", tmp_video,
        "-vn",                     # 丢弃视频流
        "-acodec", "pcm_s16le",    # 16-bit PCM
        "-ar", "16000",            # 16kHz
        "-ac", "1",                # mono
        "-loglevel", "error",
        output_wav,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            logger.error("ffmpeg 提取音轨失败: %s", result.stderr[:500])
            return False

        if os.path.isfile(output_wav) and os.path.getsize(output_wav) > 0:
            wav_size = os.path.getsize(output_wav)
            duration = wav_size / 32000  # 16kHz * 16bit * 1ch = 32000 bytes/s
            logger.info("音轨提取完成: %s (%.2fMB, ~%d:%02d)",
                        os.path.basename(output_wav),
                        wav_size / 1048576,
                        int(duration // 60), int(duration % 60))
        else:
            logger.error("WAV 输出为空")
            return False
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg 提取音轨超时（视频可能较大）")
        return False
    finally:
        # 清理临时视频文件
        try:
            os.remove(tmp_video)
        except OSError:
            pass

    return True
