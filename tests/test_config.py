from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from hdu_snap.cli import resolve_runtime_options
from hdu_snap.config import Settings, load_settings


def test_defaults_preserve_repository_paths() -> None:
    settings = Settings(_env_file=None)
    assert settings.database_path.name == "hdu_snap.db"
    assert settings.database_path.parent.name == "runtime"
    assert settings.resolved_patch_rules_path.name == "patch_rules.jsonc"
    assert settings.server_host == "127.0.0.1"
    assert settings.server_port == 8765


def test_process_environment_overrides_dotenv(tmp_path, monkeypatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("HDU_SNAP_ANSWER_COUNT=20\nHDU_SNAP_SERVER_PORT=9000\n", encoding="utf-8")
    monkeypatch.setenv("HDU_SNAP_ANSWER_COUNT", "30")
    settings = load_settings(env_file)
    assert settings.answer_count == 30
    assert settings.server_port == 9000


def test_blank_optional_dotenv_values_enable_interactive_fallback(tmp_path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("HDU_SNAP_MODE=\nHDU_SNAP_ANSWER_COUNT=\n", encoding="utf-8")
    settings = load_settings(env_file)
    assert settings.mode is None
    assert settings.answer_count is None


def test_cli_overrides_settings_and_noninteractive_defaults() -> None:
    settings = Settings(_env_file=None, mode="debug", answer_count=40)
    runtime = resolve_runtime_options(settings, mode_override="normal", answer_count_override=12, interactive=False)
    assert runtime.mode == "normal"
    assert runtime.answer_count == 12
    default_runtime = resolve_runtime_options(Settings(_env_file=None), interactive=False)
    assert default_runtime.mode == "normal"
    assert default_runtime.answer_count == 100


def test_interactive_runtime_fallback(monkeypatch) -> None:
    answers = iter(["0", "25"])
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    runtime = resolve_runtime_options(Settings(_env_file=None), interactive=True)
    assert runtime.mode == "debug"
    assert runtime.answer_count == 25


def test_validation_rejects_public_bind_and_invalid_delays() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, server_host="0.0.0.0")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, client_min_action_delay_ms=500, client_max_action_delay_ms=100)


def test_redacted_configuration_never_contains_key() -> None:
    settings = Settings(_env_file=None, deepseek_api_key="secret-value")
    payload = settings.redacted_json()
    assert "secret-value" not in payload
    assert json.loads(payload)["deepseek_api_key"] == "***configured***"


def test_client_config_contains_only_safe_values() -> None:
    settings = Settings(_env_file=None, deepseek_api_key="secret-value", answer_count=9)
    payload = settings.client_config
    assert payload["schema_version"] == 1
    assert payload["answer_count"] == 9
    assert "secret-value" not in json.dumps(payload)
