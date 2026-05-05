class LoginURLSelector:
    """Return index of login URL; fallback is index 0."""

    def __init__(self, prefer_upc: bool = False):
        self.prefer_upc = prefer_upc

    def select_index(self, urls, ctx) -> int:
        if self.prefer_upc or getattr(ctx.bot, "login_method", "") == "upc":
            return 1 if len(urls) > 1 else 0
        return 0
