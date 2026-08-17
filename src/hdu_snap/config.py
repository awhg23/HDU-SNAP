from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TARGET_URL = "https://skl.hduhelp.com/?type=5#/english/list"
FALLBACK_TARGET_URLS = (
    DEFAULT_TARGET_URL,
    "https://skl.hdu.edu.cn/#/english/list",
)
DEFAULT_MOBILE_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
)


def _env(name: str) -> AliasChoices:
    return AliasChoices(name)


class Settings(BaseSettings):
    """Validated process configuration; the only module that reads environment variables."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
        env_ignore_empty=True,
    )

    mode: Literal["normal", "debug"] | None = Field(default=None, validation_alias=_env("HDU_SNAP_MODE"))
    answer_count: int | None = Field(default=None, gt=0, validation_alias=_env("HDU_SNAP_ANSWER_COUNT"))
    auto_open_site: bool = Field(default=True, validation_alias=_env("HDU_SNAP_AUTO_OPEN_SITE"))
    target_url: str = Field(default=DEFAULT_TARGET_URL, validation_alias=_env("HDU_SNAP_TARGET_URL"))

    server_host: str = Field(default="127.0.0.1", validation_alias=_env("HDU_SNAP_SERVER_HOST"))
    server_port: int = Field(default=8765, ge=1, le=65535, validation_alias=_env("HDU_SNAP_SERVER_PORT"))
    log_level: str = Field(default="INFO", validation_alias=_env("HDU_SNAP_LOG_LEVEL"))

    data_dir: Path | None = Field(default=None, validation_alias=_env("HDU_SNAP_DATA_DIR"))
    dictionary_path: Path | None = Field(default=None, validation_alias=_env("HDU_SNAP_DICTIONARY_PATH"))
    patch_rules_path: Path | None = Field(default=None, validation_alias=_env("HDU_SNAP_PATCH_RULES_PATH"))

    deepseek_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DEEPSEEK_API_KEY", "HDU_SNAP_LLM_API_KEY"),
        repr=False,
    )
    llm_base_url: str = Field(default="https://api.deepseek.com", validation_alias=_env("HDU_SNAP_LLM_BASE_URL"))
    llm_model: str = Field(default="deepseek-v4-flash", validation_alias=_env("HDU_SNAP_LLM_MODEL"))
    llm_timeout_seconds: float = Field(default=12.0, gt=0, validation_alias=_env("HDU_SNAP_LLM_TIMEOUT_SECONDS"))
    llm_max_retries: int = Field(default=2, ge=0, le=10, validation_alias=_env("HDU_SNAP_LLM_MAX_RETRIES"))

    client_scan_debounce_ms: int = Field(default=180, ge=0, validation_alias=_env("HDU_SNAP_CLIENT_SCAN_DEBOUNCE_MS"))
    client_min_action_delay_ms: int = Field(default=100, ge=0, validation_alias=_env("HDU_SNAP_CLIENT_MIN_ACTION_DELAY_MS"))
    client_max_action_delay_ms: int = Field(default=300, ge=0, validation_alias=_env("HDU_SNAP_CLIENT_MAX_ACTION_DELAY_MS"))
    client_reconnect_max_delay_ms: int = Field(default=10000, ge=100, validation_alias=_env("HDU_SNAP_CLIENT_RECONNECT_MAX_DELAY_MS"))
    review_state_ttl_ms: int = Field(default=1800000, gt=0, validation_alias=_env("HDU_SNAP_REVIEW_STATE_TTL_MS"))
    exam_state_ttl_ms: int = Field(default=1800000, gt=0, validation_alias=_env("HDU_SNAP_EXAM_STATE_TTL_MS"))

    mobile_user_agent: str = Field(default=DEFAULT_MOBILE_USER_AGENT, validation_alias=_env("HDU_SNAP_MOBILE_USER_AGENT"))
    mobile_accept_language: str = Field(default="zh-CN,zh;q=0.9,en;q=0.8", validation_alias=_env("HDU_SNAP_MOBILE_ACCEPT_LANGUAGE"))
    mobile_platform: str = Field(default="Android", validation_alias=_env("HDU_SNAP_MOBILE_PLATFORM"))
    mobile_width: int = Field(default=412, gt=0, validation_alias=_env("HDU_SNAP_MOBILE_WIDTH"))
    mobile_height: int = Field(default=915, gt=0, validation_alias=_env("HDU_SNAP_MOBILE_HEIGHT"))
    mobile_device_scale_factor: float = Field(default=2.625, gt=0, validation_alias=_env("HDU_SNAP_MOBILE_DEVICE_SCALE_FACTOR"))
    mobile_max_touch_points: int = Field(default=1, ge=0, validation_alias=_env("HDU_SNAP_MOBILE_MAX_TOUCH_POINTS"))

    windows_program_files: Path | None = Field(default=None, validation_alias=_env("ProgramFiles"), exclude=True)
    windows_program_files_x86: Path | None = Field(default=None, validation_alias=_env("ProgramFiles(x86)"), exclude=True)
    windows_local_app_data: Path | None = Field(default=None, validation_alias=_env("LocalAppData"), exclude=True)

    @field_validator("mode", mode="before")
    @classmethod
    def normalize_mode(cls, value: Any) -> Any:
        if value is None or value == "":
            return None
        normalized = str(value).strip().lower()
        mapping = {"0": "debug", "debug": "debug", "1": "normal", "normal": "normal"}
        if normalized not in mapping:
            raise ValueError("must be normal/1 or debug/0")
        return mapping[normalized]

    @field_validator("deepseek_api_key", mode="before")
    @classmethod
    def empty_key_is_none(cls, value: Any) -> Any:
        return str(value).strip() if value is not None and str(value).strip() else None

    @field_validator("server_host")
    @classmethod
    def validate_loopback_host(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"127.0.0.1", "localhost"}:
            raise ValueError("must be 127.0.0.1 or localhost")
        return normalized

    @field_validator("target_url", "llm_base_url")
    @classmethod
    def validate_http_url(cls, value: str) -> str:
        parsed = urlparse(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("must be an absolute http(s) URL")
        return value.strip()

    @field_validator("log_level")
    @classmethod
    def normalize_log_level(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("must be DEBUG, INFO, WARNING, ERROR, or CRITICAL")
        return normalized

    @model_validator(mode="after")
    def validate_client_delays(self) -> "Settings":
        if self.client_min_action_delay_ms > self.client_max_action_delay_ms:
            raise ValueError("client minimum action delay cannot exceed maximum action delay")
        return self

    @staticmethod
    def _resolve_path(value: Path | None, default: Path) -> Path:
        path = value or default
        path = path.expanduser()
        return path if path.is_absolute() else PROJECT_ROOT / path

    @property
    def resolved_data_dir(self) -> Path:
        return self._resolve_path(self.data_dir, PROJECT_ROOT / "runtime")

    @property
    def database_path(self) -> Path:
        return self.resolved_data_dir / "hdu_snap.db"

    @property
    def debug_recent_path(self) -> Path:
        return self.resolved_data_dir / "debug_recent_10000.json"

    @property
    def debug_error_path(self) -> Path:
        return self.resolved_data_dir / "debug_error_1000.json"

    @property
    def report_html_path(self) -> Path:
        return self.resolved_data_dir / "debug_report.html"

    @property
    def report_summary_path(self) -> Path:
        return self.resolved_data_dir / "debug_report_summary.json"

    @property
    def resolved_dictionary_path(self) -> Path:
        return self._resolve_path(self.dictionary_path, PROJECT_ROOT / "CET" / "Data.lexicon.cache.json")

    @property
    def resolved_patch_rules_path(self) -> Path:
        return self._resolve_path(self.patch_rules_path, PROJECT_ROOT / "patch_rules.jsonc")

    @property
    def client_config(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "protocol_version": 1,
            "answer_count": self.answer_count or 100,
            "automation": {
                "scan_debounce_ms": self.client_scan_debounce_ms,
                "min_action_delay_ms": self.client_min_action_delay_ms,
                "max_action_delay_ms": self.client_max_action_delay_ms,
                "reconnect_max_delay_ms": self.client_reconnect_max_delay_ms,
                "review_state_ttl_ms": self.review_state_ttl_ms,
                "exam_state_ttl_ms": self.exam_state_ttl_ms,
            },
            "mobile_emulation": {
                "user_agent": self.mobile_user_agent,
                "accept_language": self.mobile_accept_language,
                "platform": self.mobile_platform,
                "width": self.mobile_width,
                "height": self.mobile_height,
                "device_scale_factor": self.mobile_device_scale_factor,
                "max_touch_points": self.mobile_max_touch_points,
            },
        }

    def redacted_json(self) -> str:
        payload = self.model_dump(mode="json", exclude={"deepseek_api_key"})
        payload["deepseek_api_key"] = "***configured***" if self.deepseek_api_key else None
        payload.update(
            {
                "database_path": str(self.database_path),
                "debug_recent_path": str(self.debug_recent_path),
                "debug_error_path": str(self.debug_error_path),
            }
        )
        return json.dumps(payload, ensure_ascii=False, indent=2)


def load_settings(env_file: Path | str | None = PROJECT_ROOT / ".env", **overrides: Any) -> Settings:
    return Settings(_env_file=env_file, **overrides)
