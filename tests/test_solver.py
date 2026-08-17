from __future__ import annotations

from types import SimpleNamespace

import pytest

from hdu_snap.application.solver import SolverPipeline
from hdu_snap.domain.models import DictionaryLookupResult, RuntimeOptions, TierDecision


class PatchStore:
    def __init__(self, rules=None):
        self.rules = rules or []

    def get_rules(self):
        return self.rules

    def upsert_rule(self, **_kwargs):
        return None


class DebugStore:
    recent_questions = []

    def append_recent(self, _record):
        return None

    def append_errors(self, _records):
        return None


class Dictionary:
    def __init__(self, result=None):
        self.result = result or DictionaryLookupResult()

    def lookup_exact(self, _source, _options):
        return self.result

class LLM:
    async def choose(self, _source, _options, stats):
        stats.record_ai_call()
        return TierDecision("A", "大模型决策")


def pipeline(dictionary=None, patch_store=None):
    return SolverPipeline(
        dictionary or Dictionary(),
        LLM(),
        patch_store or PatchStore(),
        DebugStore(),
        RuntimeOptions(),
    )


@pytest.mark.asyncio
async def test_patch_rule_has_highest_priority() -> None:
    solver = pipeline(patch_store=PatchStore([{"source_text": "新闻", "answer_text": "news", "note": ""}]))
    decision = await solver.solve(1, "新闻", {"A": "data", "B": "news", "C": "word", "D": "item"})
    assert decision.target == "B"
    assert decision.method == "补丁规则"


@pytest.mark.asyncio
async def test_dictionary_conflict_forces_llm() -> None:
    solver = pipeline(Dictionary(DictionaryLookupResult(force_tier3=True, force_reason="conflict")))
    decision = await solver.solve(1, "news", {"A": "新闻", "B": "消息", "C": "数据", "D": "项目"})
    assert decision.method == "大模型决策"
    assert "conflict" in (decision.detail or "")
