from __future__ import annotations

import logging

from events.base_event import IEvent

logger = logging.getLogger(__name__)


class VideoPlaybackLoopEvent(IEvent):
    is_loop = True

    def run(self, ctx) -> None:
        unfinished = ctx.get("unfinished", [])
        idx = ctx.get("video_index", 0)
        if idx >= len(unfinished):
            return

        title, video_el = unfinished[idx]
        logger.info("=" * 40)
        logger.info("[%d/%d] 正在处理: %s", idx + 1, len(unfinished), title)

        retry_count = 0
        while not ctx.click_video(video_el, title):
            if ctx.should_stop():
                return
            retry_count += 1
            logger.warning("点击课程失败（第%d次重试）: %s", retry_count, title)
            ctx.handle_initial_dialogs()
            ctx.wait(1)

        success = ctx.monitor_and_wait_for_video(title)
        ctx.bot.total_watched_seconds += ctx.get_video_duration_seconds()
        if success:
            logger.info("已完成课程: %s", title)
        else:
            logger.warning("课程超时，仍计入完成: %s", title)
        ctx.set("completed_this_run", ctx.get("completed_this_run", 0) + 1)
        ctx.set("video_index", idx + 1)

    def is_end(self, ctx) -> bool:
        if ctx.should_stop():
            return True

        unfinished = ctx.get("unfinished", [])
        idx = ctx.get("video_index", 0)
        if idx >= len(unfinished):
            return True

        if (
            ctx.bot.time_limit_seconds > 0
            and ctx.bot.total_watched_seconds >= ctx.bot.time_limit_seconds
        ):
            limit_min = ctx.bot.time_limit_seconds // 60
            total_min = int(ctx.bot.total_watched_seconds // 60)
            total_sec = int(ctx.bot.total_watched_seconds % 60)
            logger.info(
                "已达到刷课时长上限 %d 分钟（累计 %d分%d秒），停止刷课",
                limit_min,
                total_min,
                total_sec,
            )
            return True
        return False
