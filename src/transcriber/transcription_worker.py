"""
转录工作进程入口 —— 在独立 multiprocessing.Process 中运行 FunASR 推理。

职责：
    1. 加载 SenseVoiceSmall 模型（仅一次）
    2. 从 input_queue 接收 WAV 文件路径和元数据
    3. 转录并将结果放入 output_queue
    4. 收到 sentinel (None) 后优雅退出
"""

import logging
import os
import queue
import sys
import traceback
from multiprocessing import Event, Queue

logger = logging.getLogger(__name__)


def _load_model():
    """加载 FunASR SenseVoiceSmall 模型（含 VAD）。

    此函数在 worker 进程中调用，模型常驻内存直到进程退出。
    """
    try:
        import torch
        from funasr import AutoModel
    except ImportError as e:
        logger.error(
            "FunASR 未安装。请在 zhihuishu conda 环境中运行:\n"
            "  pip install funasr modelscope\n"
            "  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu"
        )
        raise

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    logger.info("转录 Worker: 使用设备 %s", device)
    logger.info("转录 Worker: 正在加载 SenseVoiceSmall 模型（首次使用需下载 ~300MB）...")

    model = AutoModel(
        model="iic/SenseVoiceSmall",
        vad_model="fsmn-vad",
        vad_kwargs={"max_single_segment_time": 30000},
        device=device,
        hub="ms",
    )
    logger.info("转录 Worker: 模型加载完成")
    return model


def _do_transcribe(model, wav_path: str) -> str:
    """对单个 WAV 文件执行转录，返回纯文本。"""
    result = model.generate(input=wav_path, language="auto")
    if not result or len(result) == 0:
        return ""

    # result 形如 [{"text": "转录文本...", "timestamp": ...}]
    first = result[0]
    text = first.get("text", "") if isinstance(first, dict) else str(first)

    # 使用 FunASR 内置的后处理（添加标点）
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        text = rich_transcription_postprocess(text)
    except ImportError:
        pass

    return text.strip()


# ============================================================================
# Worker 进程入口
# ============================================================================


def transcription_worker_main(
    input_queue: Queue,
    output_queue: Queue,
    stop_event: Event,
):
    """multiprocessing.Process 的 target 函数。

    Args:
        input_queue: 接收 (wav_path, metadata_dict) 或 None (sentinel)
        output_queue: 发送 ("ok"|"error", wav_path, metadata, text_or_error)
        stop_event: 外部请求停止
    """
    # spawn 上下文中日志配置不会继承，需在此重新配置
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )

    try:
        model = _load_model()
    except Exception:
        logger.error("转录 Worker: 模型加载失败，Worker 退出")
        traceback.print_exc()
        # 通知主进程
        try:
            output_queue.put(("fatal", "", {}, "模型加载失败: " + traceback.format_exc()))
        except Exception:
            pass
        return

    logger.info("转录 Worker: 就绪，等待任务...")

    while not stop_event.is_set():
        try:
            task = input_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        if task is None:
            logger.info("转录 Worker: 收到退出信号")
            break

        wav_path, metadata = task

        try:
            logger.info("转录 Worker: 开始转录 %s", os.path.basename(wav_path))
            text = _do_transcribe(model, wav_path)

            if text:
                logger.info(
                    "转录 Worker: 完成 %s（文本长度 %d 字）",
                    metadata.get("video_title", "?"), len(text),
                )
            else:
                logger.warning(
                    "转录 Worker: %s 转录结果为空（可能无语音内容）",
                    metadata.get("video_title", "?"),
                )

            output_queue.put(("ok", wav_path, metadata, text))

        except Exception as e:
            logger.error("转录 Worker: 处理 %s 时出错: %s", wav_path, e)
            traceback.print_exc()
            output_queue.put(("error", wav_path, metadata, str(e)))

    logger.info("转录 Worker: 退出")
