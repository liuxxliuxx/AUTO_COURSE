from __future__ import annotations

from events.base_event import IEvent


class InitBrowserEvent(IEvent):
    is_loop = False

    def run(self, ctx) -> None:
        # Browser init moved into proxy.on_page_start for decoupling.
        return None
