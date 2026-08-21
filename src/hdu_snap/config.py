from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseModel):
    """Explicit shared-core settings injected by the desktop sidecar."""

    data_dir: Path = PROJECT_ROOT / "runtime"
    dictionary_path: Path = PROJECT_ROOT / "CET" / "Data.lexicon.cache.json"
    patch_rules_path: Path = PROJECT_ROOT / "patch_rules.jsonc"
    deepseek_api_key: str | None = Field(default=None, repr=False)
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"
    llm_timeout_seconds: float = Field(default=12.0, gt=0)
    llm_max_retries: int = Field(default=2, ge=0, le=10)

    @field_validator("deepseek_api_key", mode="before")
    @classmethod
    def empty_key_is_none(cls, value: object) -> str | None:
        normalized = str(value).strip() if value is not None else ""
        return normalized or None

    @field_validator("llm_base_url")
    @classmethod
    def validate_http_url(cls, value: str) -> str:
        parsed = urlparse(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("must be an absolute http(s) URL")
        return value.strip()

    @staticmethod
    def _absolute(path: Path) -> Path:
        expanded = path.expanduser()
        return expanded if expanded.is_absolute() else PROJECT_ROOT / expanded

    @property
    def resolved_data_dir(self) -> Path:
        return self._absolute(self.data_dir)

    @property
    def database_path(self) -> Path:
        return self.resolved_data_dir / "hdu_snap.db"

    @property
    def resolved_dictionary_path(self) -> Path:
        return self._absolute(self.dictionary_path)

    @property
    def resolved_patch_rules_path(self) -> Path:
        return self._absolute(self.patch_rules_path)

    def redacted_json(self) -> str:
        payload = self.model_dump(mode="json", exclude={"deepseek_api_key"})
        payload["deepseek_api_key"] = "***configured***" if self.deepseek_api_key else None
        payload["database_path"] = str(self.database_path)
        return json.dumps(payload, ensure_ascii=False, indent=2)
