from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from hdu_snap.config import PROJECT_ROOT
from hdu_snap.domain.models import RunStats, VectorScore
from hdu_snap.infrastructure.dictionary import DictionaryEngine
from hdu_snap.infrastructure.models import LLMEngine, VectorEngine
from hdu_snap.infrastructure.stores import DebugArtifactStore, PatchRuleStore, migrate_legacy_debug_files


def write_dictionary(path) -> None:
    path.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "word": "news",
                        "normalized_word": "news",
                        "raw_meaning": "新闻；消息",
                        "chinese_terms": ["新闻", "消息"],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_dictionary_and_patch_stores_use_injected_paths(tmp_path) -> None:
    dictionary_path = tmp_path / "dictionary.json"
    write_dictionary(dictionary_path)
    engine = DictionaryEngine(tmp_path / "db.sqlite", dictionary_path)
    result = engine.lookup_exact("新闻", {"A": "news", "B": "data", "C": "word", "D": "message"})
    assert result.decision and result.decision.target == "A"
    patch_store = PatchRuleStore(tmp_path / "patch.jsonc", seed_defaults=False)
    patch_store.upsert_rule("新闻", "news", "data", "test")
    assert patch_store.get_rules()[0]["answer_text"] == "news"


def test_release_patch_baseline_has_no_source_conflicts() -> None:
    rules = PatchRuleStore(PROJECT_ROOT / "patch_rules.jsonc", seed_defaults=False).get_rules()
    normalized_sources = [rule["source_text"].strip().casefold() for rule in rules]
    assert len(rules) >= 60
    assert len(normalized_sources) == len(set(normalized_sources))


def test_debug_store_and_legacy_migration(tmp_path) -> None:
    legacy = tmp_path / "debug_recent_500.json"
    legacy.write_text("[]", encoding="utf-8")
    migrate_legacy_debug_files(tmp_path)
    assert not legacy.exists()
    store = DebugArtifactStore(tmp_path / "debug_recent_10000.json", tmp_path / "debug_error_1000.json")
    store.append_recent({"item_id": 1})
    store.append_errors([{"item_id": 1}])
    assert len(store.recent_questions) == 1
    assert len(store.error_questions) == 1


def test_vector_threshold_and_llm_fallback(tmp_path) -> None:
    vector = VectorEngine("unused", tmp_path / "missing", top_score_threshold=0, margin_threshold=0)
    decision, ranked = vector.choose("news", {"A": "news", "B": "data", "C": "word", "D": "item"}, [])
    assert decision is not None
    assert ranked[0].letter == "A"


@pytest.mark.asyncio
async def test_llm_fallback_is_deterministic() -> None:
    llm = LLMEngine(None, "https://api.deepseek.com", "model", 1, 0)
    stats = RunStats()
    decision = await llm.choose(
        "news",
        {"A": "新闻", "B": "数据", "C": "项目", "D": "单词"},
        [VectorScore("A", "新闻", 0.4), VectorScore("B", "数据", 0.2)],
        stats,
    )
    assert decision.target == "A"
    assert decision.method == "向量兜底"
    assert stats.ai_call_count == 1


@pytest.mark.asyncio
async def test_llm_disables_thinking_for_single_letter_response() -> None:
    recorded_request = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            recorded_request.update(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="C"))],
            )

    llm = LLMEngine(None, "https://api.deepseek.com", "deepseek-v4-flash", 1, 0)
    llm.client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

    decision = await llm.choose(
        "管理，经营",
        {"A": "stimulus", "B": "accomplish", "C": "manage", "D": "finish"},
        [VectorScore("D", "finish", 0.7), VectorScore("C", "manage", 0.69)],
        RunStats(),
    )

    assert decision.target == "C"
    assert decision.method == "大模型决策"
    assert recorded_request["max_tokens"] == 8
    assert recorded_request["extra_body"] == {"thinking": {"type": "disabled"}}
