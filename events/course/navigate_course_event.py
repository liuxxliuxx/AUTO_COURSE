from __future__ import annotations

from events.base_event import IEvent


class NavigateCourseEvent(IEvent):
    is_loop = False

    def run(self, ctx) -> None:
        ctx.bot.navigate_to_course()
        ctx.set("unfinished", ctx.bot.get_unfinished_videos())
        ctx.set("video_index", 0)
        ctx.set("completed_this_run", 0)
