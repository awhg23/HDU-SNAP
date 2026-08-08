from __future__ import annotations

import asyncio
import logging
import re
import sys
import time
from typing import Any

from hdu_snap.api.contracts import ReviewResultItemPayload
from hdu_snap.domain.models import LETTER_ORDER, RunStats, RuntimeOptions, TierDecision
from hdu_snap.domain.text import clean_option_text, clean_source_text, normalize_text
from hdu_snap.infrastructure.dictionary import DictionaryEngine
from hdu_snap.infrastructure.models import LLMEngine, VectorEngine
from hdu_snap.infrastructure.stores import DebugArtifactStore, PatchRuleStore

logger = logging.getLogger("hdu-snap")


class SolverPipeline:
    def __init__(
        self,
        dictionary_engine: DictionaryEngine,
        vector_engine: VectorEngine,
        llm_engine: LLMEngine,
        patch_store: PatchRuleStore,
        debug_store: DebugArtifactStore,
        runtime: RuntimeOptions,
        stats: RunStats | None = None,
    ) -> None:
        self.dictionary_engine = dictionary_engine
        self.vector_engine = vector_engine
        self.llm_engine = llm_engine
        self.patch_store = patch_store
        self.debug_store = debug_store
        self.runtime = runtime
        self.stats = stats or RunStats()
        self.session_records: list[dict[str, Any]] = []

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
        decision = self._lookup_patch_override(source_text, options)
        if decision is None:
            dictionary_result = self.dictionary_engine.lookup_exact(source_text, options)
            decision = dictionary_result.decision
            if decision is None and dictionary_result.force_tier3:
                ranked = self.vector_engine.rank(source_text, options, [])
                decision = await self.llm_engine.choose(source_text, options, ranked, self.stats)
                if dictionary_result.force_reason:
                    decision.detail = f"{dictionary_result.force_reason}; {decision.detail or ''}".strip("; ")
            if decision is None:
                hints = self.dictionary_engine.fetch_translations(source_text)
                decision, ranked = self.vector_engine.choose(source_text, options, hints)
                if decision is None:
                    decision = await self.llm_engine.choose(source_text, options, ranked, self.stats)
        self._print_validation_log(item_id, source_text, options, decision)
        self._record_debug_log(item_id, source_text, options, decision, session_id)
        self.stats.record_item()
        return decision

    @staticmethod
    def _print_validation_log(item_id: int, source_text: str, options: dict[str, str], decision: TierDecision) -> None:
        option_line = " | ".join(f"{letter}. {options[letter]}" for letter in LETTER_ORDER)
        print("[节点校验日志]")
        print(f"第{item_id}题: {source_text}")
        print(f"候选项: {option_line}")
        print(f"处理方式: {decision.method}")
        print(f"决策结果: {decision.target}")
        print("------------------------")

    def print_final_summary(self, total_items: int) -> None:
        print("========================")
        print("[自动化测试运行结束]")
        print(f"总计处理测试项: {total_items} 个")
        print(f"触发大模型 (Tier 3) 决策总次数: {self.stats.ai_call_count} 次")
        print("状态: 挂起，等待人工确认表单...")
        print("========================")

    def _record_debug_log(
        self,
        item_id: int,
        source_text: str,
        options: dict[str, str],
        decision: TierDecision,
        session_id: str | None,
    ) -> None:
        if not self.runtime.is_debug:
            return
        record = {
            "timestamp": int(time.time()),
            "session_id": session_id,
            "item_id": item_id,
            "source_text": source_text,
            "options": {letter: options[letter] for letter in LETTER_ORDER},
            "target": decision.target,
            "method": decision.method,
            "detail": decision.detail,
        }
        self.session_records.append(record)
        self.debug_store.append_recent(record)

    async def collect_debug_feedback(self) -> None:
        if not self.runtime.is_debug or not self.session_records or not sys.stdin or not sys.stdin.isatty():
            return
        prompt = (
            "调试模式：请输入本轮答错题的“题号:正确选项字母”，多个用空格或逗号分隔；"
            "例如 12:B 45:D。如果没有错题，直接按回车："
        )
        raw = (await asyncio.to_thread(input, prompt)).strip()
        if not raw:
            return
        answer_map: dict[int, str] = {}
        for token in re.split(r"[\s,，]+", raw):
            match = re.fullmatch(r"(\d+)\s*[:=：>\-]\s*([ABCDabcd])", token)
            if match:
                answer_map[int(match.group(1))] = match.group(2).upper()
        record_map = {record["item_id"]: record for record in self.session_records}
        errors = []
        for item_id, correct_target in answer_map.items():
            record = record_map.get(item_id)
            if record:
                errors.append(
                    ReviewResultItemPayload(
                        item_id=item_id,
                        source_text=record["source_text"],
                        options=record["options"],
                        wrong_target=record["target"],
                        correct_target=correct_target,
                        wrong_option_text=record["options"][record["target"]],
                        correct_option_text=record["options"][correct_target],
                        method=record["method"],
                    )
                )
        self.ingest_review_results(errors)

    def ingest_review_results(
        self,
        errors: list[ReviewResultItemPayload],
        session_id: str | None = None,
    ) -> dict[str, int]:
        if not errors:
            return {"errors": 0, "patches": 0}
        record_index = {
            (record.get("session_id"), record["item_id"]): record
            for record in [*self.session_records, *self.debug_store.recent_questions]
        }
        matched = []
        for error in errors:
            original = record_index.get((session_id, error.item_id)) or record_index.get((None, error.item_id))
            matched.append(
                {
                    "timestamp": int(time.time()),
                    "session_id": session_id,
                    "item_id": error.item_id,
                    "source_text": error.source_text,
                    "options": {letter: error.options[letter] for letter in LETTER_ORDER},
                    "target": error.wrong_target,
                    "method": (original or {}).get("method") or error.method or "未知方法",
                    "detail": f"结果页自动采集: 错选={error.wrong_target}->{error.wrong_option_text}, 正选={error.correct_target}->{error.correct_option_text}",
                    "wrong_target": error.wrong_target,
                    "wrong_option_text": error.wrong_option_text,
                    "correct_target": error.correct_target,
                    "correct_option_text": error.correct_option_text,
                }
            )
        self.debug_store.append_errors(matched)
        for record in matched:
            self.patch_store.upsert_rule(
                source_text=record["source_text"],
                answer_text=record["correct_option_text"],
                wrong_answer_text=record["wrong_option_text"],
                note=(
                    f"结果页自动补丁: 第{record['item_id']}题, "
                    f"错选={record['wrong_target']}->{record['wrong_option_text']}, "
                    f"正选={record['correct_target']}->{record['correct_option_text']}"
                ),
            )
        logger.info("review results ingested: errors=%s, patches=%s", len(matched), len(matched))
        return {"errors": len(matched), "patches": len(matched)}
