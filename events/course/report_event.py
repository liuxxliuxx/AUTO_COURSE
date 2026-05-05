from __future__ import annotations

from events.base_event import IEvent


class ReportEvent(IEvent):
    is_loop = False

    def run(self, ctx) -> None:
        ctx.show_completion_report(ctx.get("completed_this_run", 0))
