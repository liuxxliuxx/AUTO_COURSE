class GUICallbackProxy:
    def __init__(self, page):
        self.page = page
        self.gui = page.state["gui"]

    def wait(self, seconds: float):
        return None

    def get(self, key, default=None):
        return self.page.state.get(key, default)

    def set(self, key, value):
        self.page.state[key] = value
