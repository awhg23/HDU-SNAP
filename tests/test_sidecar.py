from __future__ import annotations

import json
from pathlib import Path

import pytest

from hdu_snap.sidecar import CoreRuntime
from hdu_snap.sidecar import CoreNotInitializedError
from hdu_snap.sidecar import dispatch
from hdu_snap.infrastructure.stores import DEFAULT_PATCH_RULES, PatchRuleStore


def build_resources(tmp_path: Path) -> Path:
    resources = tmp_path / "resources"
    dictionary = resources / "CET" / "Data.lexicon.cache.json"
    dictionary.parent.mkdir(parents=True)
    dictionary.write_text(
        """
        {
          "metadata": {},
          "entries": [
            {
              "word": "manage",
              "normalized_word": "manage",
              "raw_meaning": "管理，经营",
              "chinese_terms": ["管理，经营"]
            }
          ]
        }
        """,
        encoding="utf-8",
    )
    (resources / "patch_rules.jsonc").write_text(
        json.dumps(
            {
                "rules": [
                    *DEFAULT_PATCH_RULES,
                    {
                        "source_text": "打包补丁",
                        "answer_text": "bundled",
                        "wrong_answer_text": "legacy",
                        "note": "test bundle",
                    },
                ]
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return resources


@pytest.mark.asyncio
async def test_sidecar_exposes_a_recoverable_not_initialized_error() -> None:
    runtime = CoreRuntime()
    with pytest.raises(CoreNotInitializedError, match="core_not_initialized"):
        await runtime.solve(
            {
                "session_id": "s1",
                "item_id": 1,
                "source_text": "管理，经营",
                "options": {
                    "A": "stimulus",
                    "B": "accomplish",
                    "C": "manage",
                    "D": "finish",
                },
            }
        )


@pytest.mark.asyncio
async def test_sidecar_solves_without_writing_protocol_noise_to_stdout(tmp_path: Path) -> None:
    runtime = CoreRuntime()
    health = runtime.initialize(
        {
            "data_dir": str(tmp_path / "data"),
            "resource_dir": str(build_resources(tmp_path)),
            "api_key": None,
        }
    )
    assert health["checks"]["dictionary"] is True
    assert "vector_model" not in health["checks"]
    assert "vector_mode" not in health
    decision = await runtime.solve(
        {
            "session_id": "s1",
            "item_id": 1,
            "source_text": "管理，经营",
            "options": {
                "A": "stimulus",
                "B": "accomplish",
                "C": "manage",
                "D": "finish",
            },
        }
    )
    assert decision["target"] == "C"


def test_first_initialize_copies_the_packaged_patch_baseline_exactly(tmp_path: Path) -> None:
    runtime = CoreRuntime()
    resources = build_resources(tmp_path)
    packaged_patch = resources / "patch_rules.jsonc"
    data_dir = tmp_path / "data"
    runtime.initialize(
        {
            "data_dir": str(data_dir),
            "resource_dir": str(resources),
            "api_key": None,
        }
    )

    assert (data_dir / "patch_rules.jsonc").read_bytes() == packaged_patch.read_bytes()
    assert runtime.health()["checks"]["patch_bundle"] is True


def test_upgrade_adds_missing_packaged_sources_without_overwriting_user_rules(tmp_path: Path) -> None:
    runtime = CoreRuntime()
    resources = build_resources(tmp_path)
    data_dir = tmp_path / "data"
    user_store = PatchRuleStore(data_dir / "patch_rules.jsonc", seed_defaults=False)
    user_store.upsert_rule("新闻", "user-override", "", "用户修正")

    runtime.initialize(
        {
            "data_dir": str(data_dir),
            "resource_dir": str(resources),
            "api_key": None,
        }
    )

    rules = runtime.list_patch_rules()["rules"]
    overridden_source = [rule for rule in rules if rule["source_text"] == "新闻"]
    assert [rule["answer_text"] for rule in overridden_source] == ["user-override"]
    assert any(
        rule["source_text"] == "打包补丁" and rule["answer_text"] == "bundled"
        for rule in rules
    )


def test_manual_patch_requires_confirmation_before_replacing_a_source_conflict(tmp_path: Path) -> None:
    runtime = CoreRuntime()
    runtime.initialize(
        {
            "data_dir": str(tmp_path / "data"),
            "resource_dir": str(build_resources(tmp_path)),
            "api_key": None,
        }
    )
    runtime.update_patch_rule(
        {
            "source_text": "管理，经营",
            "answer_text": "finish",
            "wrong_answer_text": "manage",
            "note": "旧规则",
        }
    )
    conflict = runtime.update_patch_rule(
        {
            "source_text": "管理，经营",
            "answer_text": "manage",
            "wrong_answer_text": "finish",
            "note": "手动添加",
        }
    )
    assert conflict["status"] == "conflict"
    runtime.update_patch_rule(
        {
            "source_text": "管理，经营",
            "answer_text": "manage",
            "wrong_answer_text": "finish",
            "note": "手动添加",
            "confirm_conflict": True,
        }
    )
    rules = runtime.list_patch_rules()["rules"]
    matching = [rule for rule in rules if rule["source_text"] == "管理，经营"]
    assert len(matching) == 1
    assert matching[0]["answer_text"] == "manage"
    assert matching[0]["note"] == "手动添加"
    assert not any(path.name.startswith("debug_") for path in (tmp_path / "data").iterdir())


def test_result_capture_can_skip_an_existing_duplicate_patch(tmp_path: Path) -> None:
    runtime = CoreRuntime()
    runtime.initialize(
        {
            "data_dir": str(tmp_path / "data"),
            "resource_dir": str(build_resources(tmp_path)),
            "api_key": None,
        }
    )
    result = runtime.update_patch_rule(
        {
            "source_text": "新闻",
            "answer_text": "news",
            "wrong_answer_text": "information",
            "note": "结果页重复",
            "skip_duplicate": True,
        }
    )
    assert result["status"] == "duplicate"


@pytest.mark.asyncio
async def test_sidecar_rejects_unknown_methods_without_leaking_params(tmp_path: Path) -> None:
    runtime = CoreRuntime()
    runtime.initialize(
        {
            "data_dir": str(tmp_path / "data"),
            "resource_dir": str(build_resources(tmp_path)),
            "api_key": None,
        }
    )
    with pytest.raises(ValueError, match="unsupported_method"):
        await dispatch(runtime, "not-a-method", {"api_key": "must-not-be-rendered"})
