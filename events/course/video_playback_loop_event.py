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
            logger.info("??????: %s", title)
            ctx.set("video_index", idx + 1)
            return

        logger.info("=" * 40)
        logger.info("[%d/%d] ????: %s", idx + 1, len(unfinished), title)

        retry_count = 0
        while not ctx.click_video(video_el, title):
            if ctx.should_stop():
                return
            retry_count += 1
            logger.warning("????????%d????: %s", retry_count, title)
            ctx.handle_initial_dialogs()
            ctx.wait(1)

        success = ctx.monitor_and_wait_for_video(title)
        ctx.bot.total_watched_seconds += ctx.get_video_duration_seconds()
        if success:
            logger.info("?????: %s", title)
        else:
            logger.warning("??????????: %s", title)

        if getattr(ctx.bot, 'db', None) is not None:
            try:
                ctx.bot.db.save_finished_course(ctx.bot.video_url, title)
            except Exception:
                logger.debug("????????: %s", title)

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
                "????????? %d ????? %d?%d???????",
                limit_min,
                total_min,
                total_sec,
            )
            return True
        return False
