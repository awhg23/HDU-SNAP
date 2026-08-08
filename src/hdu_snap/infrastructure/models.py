from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

from hdu_snap.domain.models import LETTER_ORDER, RunStats, TierDecision, VectorScore
from hdu_snap.domain.text import char_ngram_vector, cosine_similarity, sparse_cosine_similarity

logger = logging.getLogger("hdu-snap")


class VectorEngine:
    def __init__(
        self,
        model_name: str,
        model_dir: Path,
        top_score_threshold: float,
        margin_threshold: float,
    ) -> None:
        self.model_name = model_name
        self.model_dir = model_dir
        self.top_score_threshold = top_score_threshold
        self.margin_threshold = margin_threshold
        self.mode = "fallback"
        self.status_detail = "using built-in sparse similarity fallback"
        self.model = self._load_model()

    def _load_model(self) -> Any | None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            self.status_detail = "sentence-transformers not installed"
            logger.warning("sentence-transformers is not installed, vector tier will use fallback scorer")
            return None
        if not self.model_dir.exists():
            self.status_detail = f"model directory missing: {self.model_dir}"
            logger.warning("vector model directory not found, fallback scorer enabled: %s", self.model_dir)
            return None
        try:
            model = SentenceTransformer(str(self.model_dir), local_files_only=True)
            self.mode = "embedding"
            self.status_detail = f"loaded local embedding model from {self.model_dir}"
            logger.info("vector embedding model active: %s", self.model_dir)
            return model
        except Exception as exc:  # pragma: no cover - local runtime dependent
            self.status_detail = f"failed to load local model: {exc}"
            logger.warning("embedding model unavailable locally, fallback scorer enabled: %s", exc)
            return None

    def rank(self, source_text: str, options: dict[str, str], dictionary_hints: list[str]) -> list[VectorScore]:
        reference_text = "；".join(dictionary_hints) if dictionary_hints else source_text
        if self.model is not None:
            texts = [reference_text, *[options[letter] for letter in LETTER_ORDER]]
            embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            source_embedding = list(map(float, embeddings[0]))
            ranked = [
                VectorScore(
                    letter=letter,
                    text=options[letter],
                    score=cosine_similarity(source_embedding, list(map(float, embeddings[index]))),
                )
                for index, letter in enumerate(LETTER_ORDER, start=1)
            ]
            return sorted(ranked, key=lambda item: item.score, reverse=True)
        source_vector = char_ngram_vector(reference_text)
        ranked = [
            VectorScore(letter=letter, text=text, score=sparse_cosine_similarity(source_vector, char_ngram_vector(text)))
            for letter, text in options.items()
        ]
        return sorted(ranked, key=lambda item: item.score, reverse=True)

    def choose(
        self,
        source_text: str,
        options: dict[str, str],
        dictionary_hints: list[str],
    ) -> tuple[TierDecision | None, list[VectorScore]]:
        ranked = self.rank(source_text, options, dictionary_hints)
        if not ranked:
            return None, []
        best = ranked[0]
        second = ranked[1] if len(ranked) > 1 else VectorScore(letter="?", text="", score=0.0)
        margin = best.score - second.score
        if best.score >= self.top_score_threshold and margin >= self.margin_threshold:
            return (
                TierDecision(
                    target=best.letter,
                    method="向量相似度",
                    confidence=round(best.score, 4),
                    detail=f"top={best.score:.4f}, second={second.score:.4f}, margin={margin:.4f}",
                ),
                ranked,
            )
        return None, ranked


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
        vector_ranked: list[VectorScore],
        stats: RunStats,
    ) -> TierDecision:
        stats.record_ai_call()
        if self.client is None:
            return self._fallback(vector_ranked, "LLM unavailable")
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
        return self._fallback(vector_ranked, f"LLM retries exhausted ({type(last_error).__name__})")

    @staticmethod
    def _fallback(vector_ranked: list[VectorScore], reason: str) -> TierDecision:
        best = vector_ranked[0]
        second_score = vector_ranked[1].score if len(vector_ranked) > 1 else 0.0
        return TierDecision(
            target=best.letter,
            method="向量兜底",
            confidence=round(best.score, 4),
            detail=f"{reason}, fallback to deterministic top-1 candidate (top={best.score:.4f}, second={second_score:.4f})",
        )
