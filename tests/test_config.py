from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from hdu_snap.config import Settings


def test_defaults_preserve_repository_paths() -> None:
    settings = Settings()
    assert settings.database_path.name == "hdu_snap.db"
    assert settings.database_path.parent.name == "runtime"
    assert settings.resolved_patch_rules_path.name == "patch_rules.jsonc"
    assert settings.resolved_dictionary_path.name == "Data.lexicon.cache.json"


def test_explicit_paths_are_resolved_without_reading_environment(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("HDU_SNAP_DATA_DIR", str(tmp_path / "ignored"))
    settings = Settings(data_dir=tmp_path / "injected")
    assert settings.resolved_data_dir == tmp_path / "injected"


def test_validation_rejects_invalid_llm_values() -> None:
    with pytest.raises(ValidationError):
        Settings(llm_base_url="not-a-url")
    with pytest.raises(ValidationError):
        Settings(llm_max_retries=99)


def test_redacted_configuration_never_contains_key() -> None:
    settings = Settings(deepseek_api_key="test-value")
    payload = settings.redacted_json()
    assert "test-value" not in payload
    assert json.loads(payload)["deepseek_api_key"] == "***configured***"
