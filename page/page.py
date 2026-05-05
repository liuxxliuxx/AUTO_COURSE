from __future__ import annotations

from typing import Any, Callable, Iterable


class IPage:
    urls: list[str]
    url: str

    def run(self) -> None:
        raise NotImplementedError


class Page(IPage):
    def __init__(
        self,
        *,
        name: str,
        urls: Iterable[str] | None = None,
        events: Iterable | None = None,
        proxy_factory: Callable[["Page"], Any] | None = None,
    ):
        self.name = name
        self.urls = [u for u in (urls or []) if u]
        self.url = self.urls[0] if self.urls else ""
        self.events = list(events or [])
        self.state: dict[str, Any] = {}
        self._proxy_factory = proxy_factory

    def create_proxy(self):
        if self._proxy_factory is None:
            raise RuntimeError(f"page '{self.name}' missing proxy_factory")
        return self._proxy_factory(self)

    def run(self) -> None:
        ctx = self.create_proxy()
        if hasattr(ctx, "on_page_start"):
            ctx.on_page_start(self)

        for event in self.events:
            if not getattr(event, "is_loop", False):
                event.run(ctx)
                continue

            while True:
                event.run(ctx)
                if event.is_end(ctx):
                    break
                ctx.wait(ctx.get("loop_sleep_seconds", 1.0) or 1.0)

        if hasattr(ctx, "on_page_end"):
            ctx.on_page_end(self)
