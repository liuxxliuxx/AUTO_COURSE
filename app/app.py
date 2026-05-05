from __future__ import annotations

class App:
    def __init__(self, pages):
        self.pages = list(pages)

    def run(self):
        for page in self.pages:
            page.run()
