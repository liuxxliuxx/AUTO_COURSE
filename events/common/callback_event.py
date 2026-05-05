from __future__ import annotations

from events.base_event import IEvent


class CallbackEvent(IEvent):
    def __init__(self, callback, is_loop: bool = False):
        self._callback = callback
        self.is_loop = is_loop

    def run(self, ctx) -> None:
        self._callback(ctx)
