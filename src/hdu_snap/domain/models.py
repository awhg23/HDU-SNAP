from __future__ import annotations

from dataclasses import dataclass

LETTER_ORDER = ("A", "B", "C", "D")


@dataclass
class TierDecision:
    target: str
    method: str
    confidence: float | None = None
    detail: str | None = None


@dataclass
class DictionaryLookupResult:
    decision: TierDecision | None = None
    force_tier3: bool = False
    force_reason: str | None = None


@dataclass
class VectorScore:
    letter: str
    text: str
    score: float


@dataclass
class RunStats:
    processed_items: int = 0
    ai_call_count: int = 0

    def record_item(self) -> None:
        self.processed_items += 1

    def record_ai_call(self) -> None:
        self.ai_call_count += 1


@dataclass
class RuntimeOptions:
    mode: str = "normal"
    answer_count: int = 100

    @property
    def is_debug(self) -> bool:
        return self.mode == "debug"

