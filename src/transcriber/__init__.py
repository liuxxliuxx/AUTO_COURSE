"""
语音转文字 (Speech-to-Text) 子包。

提供从浏览器视频中提取音频、下载、并使用 FunASR SenseVoiceSmall
进行高准确率中文语音转文字的功能。

主要入口:
    TranscriberManager — 编排器，由 ZhiHuiShuBot 集成使用
"""

from src.transcriber.transcription_manager import TranscriberManager

__all__ = ["TranscriberManager"]
