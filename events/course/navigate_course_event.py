from __future__ import annotations

import global_state
from events.base_event import IEvent


class NavigateCourseEvent(IEvent):
    is_loop = False

    def run(self, ctx) -> None:
        ctx.navigate_to_course()
        videos = ctx.extract_videos()

        gui = global_state.get_gui()
        skip_completed = True
        if gui is not None:
            skip_completed = bool(gui.get("skip_completed_courses", True))

        if skip_completed:
            videos = [(title, item) for title, item in videos if not ctx.is_finished(item)]

        ctx.set("unfinished", videos)
        ctx.set("video_index", 0)
        ctx.set("completed_this_run", 0)
