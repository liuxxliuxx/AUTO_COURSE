#!/usr/bin/env python3
"""
SenseVoice STT Worker.

这是 v2 里**唯一**保留的 Python runtime，职责只有一个：

    WAV / audio  →  text

它不允许知道（handoff §21）：
    智慧树、课程 DOM、验证码、弹题、SQLite、调度器、
    Electron、Vue、账号密码、浏览器、Selenium、Chrome

协议（handoff §20）：stdin/stdout NDJSON，一行一条消息。

    Node → Python   {"id": "job-123", "input": "/tmp/course.wav"}
    Python → Node   {"id": "job-123", "success": true, "text": "..."}
    Python → Node   {"id": "job-123", "success": false, "error": "..."}

进程常驻，模型只加载一次，避免每节课都重新加载几百 MB 的权重。

启动完成（或加载失败）时会先推一条不带 id 的控制消息：

    {"type": "ready", "model": "SenseVoiceSmall", "device": "cpu"}
    {"type": "fatal", "error": "..."}

退出：收到 {"type": "shutdown"}，或 stdin 关闭。
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

MODEL_NAME = "SenseVoiceSmall"
MODEL_ID = "iic/SenseVoiceSmall"


def log(message: str) -> None:
    """日志一律走 stderr，stdout 只留给协议消息。"""
    print(message, file=sys.stderr, flush=True)


def emit(payload: dict[str, Any]) -> None:
    """向 Node 发一条协议消息。"""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_model():
    """加载 SenseVoice 模型。只在新进程启动时调用一次。"""
    import torch
    from funasr import AutoModel

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    log(f"正在加载 {MODEL_ID} (device={device})...")

    model = AutoModel(
        model=MODEL_ID,
        vad_model="fsmn-vad",
        vad_kwargs={"max_single_segment_time": 30000},
        device=device,
        hub="ms",
    )
    log("模型加载完成")
    return model, device


def transcribe(model, wav_path: str) -> str:
    """把一段 WAV 转成文本。"""
    result = model.generate(input=wav_path, language="auto")
    if not result:
        return ""

    first = result[0]
    text = first.get("text", "") if isinstance(first, dict) else str(first)

    # rich_transcription_postprocess 负责加标点并去掉富文本标签。
    # funasr 版本较老时没有这个函数，直接跳过。
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        text = rich_transcription_postprocess(text)
    except ImportError:
        pass

    return text.strip()


def handle_job(model, message: dict[str, Any]) -> None:
    job_id = message.get("id")
    wav_path = message.get("input", "")

    if not job_id or not wav_path:
        emit({"id": job_id or "", "success": False, "error": "缺少 id 或 input 字段"})
        return

    try:
        text = transcribe(model, wav_path)
        if not text:
            log(f"转录结果为空（可能无语音内容）: {wav_path}")
        emit({"id": job_id, "success": True, "text": text})
    except Exception as exc:  # noqa: BLE001 - 任何异常都要回给 Node，不能让 worker 挂掉
        log(f"转录失败 {wav_path}: {exc}")
        traceback.print_exc(file=sys.stderr)
        emit({"id": job_id, "success": False, "error": str(exc)})


def main() -> int:
    try:
        model, device = load_model()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        emit({"type": "fatal", "error": f"模型加载失败: {exc}"})
        return 1

    emit({"type": "ready", "model": MODEL_NAME, "device": device})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            log(f"收到非法 JSON: {exc}")
            emit({"type": "error", "error": f"非法 JSON: {exc}"})
            continue

        if message.get("type") == "shutdown":
            log("收到退出信号")
            break

        handle_job(model, message)

    log("Worker 退出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
