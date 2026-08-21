from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sys
from pathlib import Path
from typing import Any

from hdu_snap.application.solver import SolverPipeline
from hdu_snap.bootstrap import ServiceContainer
from hdu_snap.config import Settings
from hdu_snap.domain.text import clean_option_text, clean_source_text, normalize_text
from hdu_snap.infrastructure.models import LLMEngine
from hdu_snap.infrastructure.stores import PatchRuleStore
from hdu_snap.protocol import SolveItemPayload, parse_client_message

logger = logging.getLogger("hdu-snap-sidecar")


class CoreNotInitializedError(RuntimeError):
    """The desktop client must initialize or reinitialize the sidecar."""


class CoreRuntime:
    """Long-lived normal-mode solver used by the desktop app over JSON Lines."""

    def __init__(self) -> None:
        self.settings: Settings | None = None
        self.container: ServiceContainer | None = None
        self.pipeline: SolverPipeline | None = None
        self.packaged_patch_count = 0

    def initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        data_dir = Path(str(params["data_dir"])).expanduser().resolve()
        resource_dir = Path(str(params["resource_dir"])).expanduser().resolve()
        data_dir.mkdir(parents=True, exist_ok=True)
        patch_path = data_dir / "patch_rules.jsonc"
        packaged_patch_path = resource_dir / "patch_rules.jsonc"
        packaged_rules: list[dict[str, str]] = []
        if packaged_patch_path.is_file():
            packaged_rules = PatchRuleStore(packaged_patch_path, seed_defaults=False).get_rules()
        patch_existed = patch_path.exists()
        if packaged_rules and not patch_existed:
            shutil.copy2(packaged_patch_path, patch_path)

        settings = Settings(
            data_dir=data_dir,
            dictionary_path=resource_dir / "CET" / "Data.lexicon.cache.json",
            patch_rules_path=patch_path,
            deepseek_api_key=str(params.get("api_key") or "").strip() or None,
        )
        container = ServiceContainer.create(settings)
        if packaged_rules and patch_existed:
            container.patch_store.seed_missing_sources(packaged_rules)
        self.settings = settings
        self.container = container
        self.pipeline = SolverPipeline(
            dictionary_engine=container.dictionary_engine,
            llm_engine=container.llm_engine,
            patch_store=container.patch_store,
            validation_stream=sys.stderr,
        )
        self.packaged_patch_count = len(packaged_rules)
        return self.health()

    def require_initialized(self) -> ServiceContainer:
        if self.container is None or self.settings is None or self.pipeline is None:
            raise CoreNotInitializedError("core_not_initialized")
        return self.container

    def health(self) -> dict[str, Any]:
        self.require_initialized()
        settings = self.settings
        assert settings is not None
        checks = {
            "dictionary": settings.resolved_dictionary_path.is_file(),
            "patch_bundle": self.packaged_patch_count > 0,
            "patch_store": settings.resolved_patch_rules_path.is_file(),
            "data_directory": settings.resolved_data_dir.is_dir(),
        }
        return {
            "ok": all(checks.values()),
            "checks": checks,
            "deepseek_configured": bool(settings.deepseek_api_key),
            "protocol_version": 1,
        }

    async def solve(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_initialized()
        parsed = parse_client_message(
            {
                "type": "solve_item",
                "session_id": params.get("session_id"),
                "item_id": params.get("item_id"),
                "source_text": params.get("source_text"),
                "options": params.get("options"),
            }
        )
        if not isinstance(parsed, SolveItemPayload):
            raise ValueError("solve payload is invalid")
        assert self.pipeline is not None
        decision = await self.pipeline.solve(
            item_id=parsed.item_id,
            source_text=parsed.source_text,
            options=parsed.options,
            session_id=parsed.session_id,
        )
        return {
            "type": "decision",
            "session_id": parsed.session_id,
            "item_id": parsed.item_id,
            "target": decision.target,
            "method": decision.method,
            "confidence": decision.confidence,
            "detail": decision.detail,
        }

    def list_patch_rules(self) -> dict[str, Any]:
        return {"rules": self.require_initialized().patch_store.get_rules()}

    def update_patch_rule(self, params: dict[str, Any]) -> dict[str, Any]:
        source_text = clean_source_text(str(params.get("source_text", "")))
        answer_text = clean_option_text(str(params.get("answer_text", "")))
        if not source_text or not answer_text:
            raise ValueError("source_and_answer_are_required")
        source_key = normalize_text(source_text)
        answer_key = normalize_text(answer_text)
        existing_rules = [
            rule
            for rule in self.require_initialized().patch_store.get_rules()
            if normalize_text(clean_source_text(rule["source_text"])) == source_key
        ]
        duplicate = any(
            normalize_text(clean_option_text(rule["answer_text"])) == answer_key
            for rule in existing_rules
        )
        if duplicate and params.get("skip_duplicate") is True:
            return {"status": "duplicate", "existing_rules": existing_rules}
        if existing_rules and not duplicate and params.get("confirm_conflict") is not True:
            return {"status": "conflict", "existing_rules": existing_rules}
        self.require_initialized().patch_store.replace_source_rule(
            source_text=source_text,
            answer_text=answer_text,
            wrong_answer_text=clean_option_text(str(params.get("wrong_answer_text", ""))),
            note=str(params.get("note", "")).strip(),
        )
        return {"status": "updated" if existing_rules else "added"}

    def delete_patch_rule(self, params: dict[str, Any]) -> dict[str, Any]:
        deleted = self.require_initialized().patch_store.delete_rule(
            str(params.get("source_text", "")),
            str(params.get("answer_text", "")),
        )
        return {"status": "ok", "deleted": deleted}

    async def check_api_key(self, params: dict[str, Any]) -> dict[str, Any]:
        key = str(params.get("api_key") or "").strip()
        if not key:
            raise ValueError("api_key_is_required")
        self.require_initialized()
        settings = self.settings
        assert settings is not None and self.pipeline is not None
        engine = LLMEngine(
            api_key=key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
            max_retries=0,
        )
        decision = await engine.choose(
            "管理，经营",
            {"A": "manage", "B": "finish", "C": "stimulus", "D": "accomplish"},
            self.pipeline.stats,
        )
        if decision.method != "大模型决策":
            raise RuntimeError("api_key_validation_failed")
        return {"status": "ok"}


async def dispatch(runtime: CoreRuntime, method: str, params: dict[str, Any]) -> Any:
    if method == "initialize":
        return runtime.initialize(params)
    if method == "health":
        return runtime.health()
    if method == "solve":
        return await runtime.solve(params)
    if method == "patch_list":
        return runtime.list_patch_rules()
    if method == "patch_update":
        return runtime.update_patch_rule(params)
    if method == "patch_delete":
        return runtime.delete_patch_rule(params)
    if method == "check_api_key":
        return await runtime.check_api_key(params)
    if method == "shutdown":
        return {"status": "bye"}
    raise ValueError("unsupported_method")


async def run_json_lines() -> int:
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    runtime = CoreRuntime()
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            return 0
        request_id: Any = None
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("request_must_be_an_object")
            request_id = request.get("id")
            method = str(request.get("method", ""))
            params = request.get("params") or {}
            if not isinstance(params, dict):
                raise ValueError("params_must_be_an_object")
            result = await dispatch(runtime, method, params)
            response = {"id": request_id, "result": result}
        except Exception as exc:
            logger.exception("sidecar request failed: %s", type(exc).__name__)
            response = {
                "id": request_id,
                "error": {
                    "code": type(exc).__name__,
                    "message": f"core request failed: {type(exc).__name__}",
                },
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        if request.get("method") == "shutdown":
            return 0


def main() -> int:
    return asyncio.run(run_json_lines())


if __name__ == "__main__":
    raise SystemExit(main())
