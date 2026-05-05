from __future__ import annotations

import logging

import global_state
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

        gui = global_state.get_gui()
        skip_completed = True
        if gui is not None:
            skip_completed = bool(gui.get("skip_completed_courses", True))

        if skip_completed and ctx.is_finished(video_el):
            logger.info("跳过已学课程: %s", title)
            new_unfinished, next_idx = ctx.rebuild_unfinished_after_play(
                title, skip_completed
            )
            ctx.set("unfinished", new_unfinished)
            ctx.set("video_index", next_idx)
            return

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

        # Snapshot finished courses so we can detect which one actually completed
        all_before = ctx.extract_videos()
        finished_before = {t for t, el in all_before if ctx.is_finished(el)}

        success = ctx.monitor_and_wait_for_video(title)
        ctx.bot.total_watched_seconds += ctx.get_video_duration_seconds()
        if hasattr(ctx.bot, "on_video_completed"):
            ctx.bot.on_video_completed(
                db_proxy=getattr(ctx.bot, "db", None)
            )

        # Detect which course actually finished (handles manual clicks)
        all_after = ctx.extract_videos()
        finished_after = {t for t, el in all_after if ctx.is_finished(el)}
        newly_finished = finished_after - finished_before
        actual_played = newly_finished.pop() if len(newly_finished) == 1 else title

        if success:
            logger.info("已完成课程: %s", actual_played)
        else:
            logger.warning("课程超时，仍计入完成: %s", actual_played)

        if getattr(ctx.bot, 'db', None) is not None:
            try:
                ctx.bot.db.save_finished_course(ctx.bot.video_url, actual_played)
            except Exception:
                logger.debug("记录已学课程失败: %s", actual_played)

        ctx.set("completed_this_run", ctx.get("completed_this_run", 0) + 1)

        new_unfinished, next_idx = ctx.rebuild_unfinished_after_play(
            actual_played, skip_completed
        )
        ctx.set("unfinished", new_unfinished)
        ctx.set("video_index", next_idx)

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

        if (
            getattr(ctx.bot, "auto_mode", False)
            and ctx.bot.daily_target_seconds > 0
        ):
            daily = ctx.bot.get_daily_watched_seconds()
            if daily >= ctx.bot.daily_target_seconds:
                logger.info(
                    "已达到每日刷课目标 %d 分钟，停止刷课",
                    ctx.bot.daily_target_seconds // 60,
                )
                return True

        return False
