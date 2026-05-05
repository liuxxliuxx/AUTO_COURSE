from __future__ import annotations

from events.base_event import IEvent


class EnsureLoginEvent(IEvent):
    is_loop = False

    def run(self, ctx) -> None:
        if ctx.bot.check_login():
            return
        if ctx.bot.login_method == "upc":
            ctx.bot.do_login_upc()
        else:
            ctx.bot.do_login()
