from __future__ import annotations

from abc import ABC, abstractmethod


class IEvent(ABC):
    is_loop: bool = False

    @abstractmethod
    def run(self, ctx) -> None:
        raise NotImplementedError

    def is_end(self, ctx) -> bool:
        return True
