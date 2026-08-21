from __future__ import annotations

import sys
from io import TextIOBase

from hdu_snap.domain.models import LETTER_ORDER, RunStats, TierDecision
from hdu_snap.domain.text import clean_option_text, clean_source_text, normalize_text
from hdu_snap.infrastructure.dictionary import DictionaryEngine
from hdu_snap.infrastructure.models import LLMEngine
from hdu_snap.infrastructure.stores import PatchRuleStore


class SolverPipeline:
    """Shared one-question solver used by packaged desktop sidecars."""

    def __init__(
        self,
        dictionary_engine: DictionaryEngine,
        llm_engine: LLMEngine,
        patch_store: PatchRuleStore,
        stats: RunStats | None = None,
        validation_stream: TextIOBase | None = None,
    ) -> None:
        self.dictionary_engine = dictionary_engine
        self.llm_engine = llm_engine
        self.patch_store = patch_store
        self.stats = stats or RunStats()
        self.validation_stream = validation_stream or sys.stdout

    def _lookup_patch_override(self, source_text: str, options: dict[str, str]) -> TierDecision | None:
        normalized_source = normalize_text(clean_source_text(source_text))
        for rule in self.patch_store.get_rules():
            if normalize_text(clean_source_text(rule["source_text"])) != normalized_source:
                continue
            normalized_answer = normalize_text(clean_option_text(rule["answer_text"]))
            for letter in LETTER_ORDER:
                if normalize_text(clean_option_text(options.get(letter, ""))) == normalized_answer:
                    detail = f"{source_text} -> {options[letter]} (patch override)"
                    if rule.get("note"):
                        detail += f"; {rule['note']}"
                    return TierDecision(target=letter, method="补丁规则", confidence=1.0, detail=detail)
        return None

    async def solve(
        self,
        item_id: int,
        source_text: str,
        options: dict[str, str],
        session_id: str | None = None,
    ) -> TierDecision:
        del session_id  # Compatibility only; desktop normal runs never persist per-item data.
        decision = self._lookup_patch_override(source_text, options)
        if decision is None:
            dictionary_result = self.dictionary_engine.lookup_exact(source_text, options)
            decision = dictionary_result.decision
            if decision is None:
                decision = await self.llm_engine.choose(source_text, options, self.stats)
                if dictionary_result.force_reason:
                    decision.detail = f"{dictionary_result.force_reason}; {decision.detail or ''}".strip("; ")
        self._print_validation_log(item_id, source_text, options, decision)
        self.stats.record_item()
        return decision

    def _print_validation_log(
        self,
        item_id: int,
        source_text: str,
        options: dict[str, str],
        decision: TierDecision,
    ) -> None:
        option_line = " | ".join(f"{letter}. {options[letter]}" for letter in LETTER_ORDER)
        print("[节点校验日志]", file=self.validation_stream)
        print(f"第{item_id}题: {source_text}", file=self.validation_stream)
        print(f"候选项: {option_line}", file=self.validation_stream)
        print(f"处理方式: {decision.method}", file=self.validation_stream)
        print(f"决策结果: {decision.target}", file=self.validation_stream)
        print("------------------------", file=self.validation_stream)
