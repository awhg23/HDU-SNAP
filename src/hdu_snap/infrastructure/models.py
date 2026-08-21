from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from hdu_snap.domain.models import LETTER_ORDER, RunStats, TierDecision

logger = logging.getLogger("hdu-snap")


class LLMEngine:
    def __init__(
        self,
        api_key: str | None,
        base_url: str,
        model: str,
        timeout_seconds: float,
        max_retries: int,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.client = self._build_client()

    def _build_client(self) -> Any | None:
        if not self.api_key:
            logger.warning("DEEPSEEK_API_KEY is not configured, llm tier will use deterministic fallback")
            return None
        try:
            from openai import AsyncOpenAI
        except ImportError:
            logger.warning("openai package is not installed, llm tier will use deterministic fallback")
            return None
        return AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout_seconds)

    async def choose(
        self,
        source_text: str,
        options: dict[str, str],
        stats: RunStats,
    ) -> TierDecision:
        stats.record_ai_call()
        if self.client is None:
            return self._fallback("LLM unavailable")
        option_lines = "\n".join(f"{letter}. {options[letter]}" for letter in LETTER_ORDER)
        prompt = (
            "你是英文词汇学习题的判题助手。\n"
            f"源文本: {source_text}\n候选项:\n{option_lines}\n\n"
            "请从 A/B/C/D 中选择最贴切的翻译项。\n只输出一个大写字母，不要解释。"
        )
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 2):
            try:
                completion = await self.client.chat.completions.create(
                    model=self.model,
                    temperature=0,
                    max_tokens=8,
                    # DeepSeek V4 enables thinking mode by default. A one-letter
                    # classification should not spend its output budget on CoT,
                    # otherwise ``content`` can be empty even after a 200 response.
                    extra_body={"thinking": {"type": "disabled"}},
                    messages=[
                        {"role": "system", "content": "你是严格的英语翻译选择题助手，只输出 A/B/C/D 单个字母。"},
                        {"role": "user", "content": prompt},
                    ],
                )
                content = completion.choices[0].message.content or ""
                match = re.search(r"[ABCD]", content.upper())
                if not match:
                    raise ValueError(f"invalid LLM response: {content!r}")
                return TierDecision(target=match.group(0), method="大模型决策", detail=f"attempt={attempt}, raw={content.strip()}")
            except Exception as exc:  # pragma: no cover - network dependent
                last_error = exc
                logger.warning("llm request failed (attempt %s): %s", attempt, type(exc).__name__)
                await asyncio.sleep(0.6 * attempt)
        return self._fallback(f"LLM retries exhausted ({type(last_error).__name__})")

    @staticmethod
    def _fallback(reason: str) -> TierDecision:
        return TierDecision(
            target=LETTER_ORDER[0],
            method="确定性兜底",
            detail=f"{reason}; deterministic fallback selected A",
        )
