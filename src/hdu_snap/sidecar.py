from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sys
import time
from hashlib import sha256
from pathlib import Path
from typing import Any

from hdu_snap.api.contracts import ReviewResultItemPayload, parse_client_message
from hdu_snap.application.solver import SolverPipeline
from hdu_snap.bootstrap import ServiceContainer
from hdu_snap.config import Settings
from hdu_snap.domain.models import RuntimeOptions, VectorScore
from hdu_snap.domain.text import clean_option_text, clean_source_text, normalize_text
from hdu_snap.infrastructure.models import LLMEngine
from hdu_snap.infrastructure.stores import PatchRuleStore

logger = logging.getLogger("hdu-snap-sidecar")


class CoreNotInitializedError(RuntimeError):
    """The desktop client must initialize or reinitialize the sidecar."""


class CoreRuntime:
    """Long-lived solver process used by the desktop application over JSON Lines."""

    def __init__(self) -> None:
        self.settings: Settings | None = None
        self.container: ServiceContainer | None = None
        self.pipelines: dict[str, SolverPipeline] = {}
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
        packaged_model_dir = resource_dir / "models" / "moka-ai_m3e-base"
        development_model_dir = resource_dir / ".models" / "moka-ai_m3e-base"
        settings = Settings(
            _env_file=None,
            data_dir=data_dir,
            dictionary_path=resource_dir / "CET" / "Data.lexicon.cache.json",
            patch_rules_path=patch_path,
            embedding_model_dir=(
                packaged_model_dir
                if packaged_model_dir.exists()
                else development_model_dir
            ),
            deepseek_api_key=str(params.get("api_key") or "").strip() or None,
            mode="normal",
            answer_count=100,
            auto_open_site=False,
        )
        container = ServiceContainer.create(settings, RuntimeOptions(mode="normal", answer_count=100))
        if packaged_rules and patch_existed:
            container.patch_store.seed_missing_sources(packaged_rules)
        self.settings = settings
        self.container = container
        self.packaged_patch_count = len(packaged_rules)
        self.pipelines = {
            mode: SolverPipeline(
                dictionary_engine=container.dictionary_engine,
                vector_engine=container.vector_engine,
                llm_engine=container.llm_engine,
                patch_store=container.patch_store,
                debug_store=container.debug_store,
                runtime=RuntimeOptions(mode=mode, answer_count=100),
                validation_stream=sys.stderr,
            )
            for mode in ("normal", "debug")
        }
        return self.health()

    def require_initialized(self) -> ServiceContainer:
        if self.container is None or self.settings is None:
            raise CoreNotInitializedError("core_not_initialized")
        return self.container

    def health(self) -> dict[str, Any]:
        container = self.require_initialized()
        settings = self.settings
        assert settings is not None
        checks = {
            "dictionary": settings.resolved_dictionary_path.is_file(),
            "patch_bundle": self.packaged_patch_count > 0,
            "patch_store": settings.resolved_patch_rules_path.is_file(),
            "data_directory": settings.resolved_data_dir.is_dir(),
            "vector_model": container.vector_engine.mode == "embedding",
        }
        return {
            "ok": all(checks.values()),
            "checks": checks,
            "vector_mode": container.vector_engine.mode,
            "vector_status": container.vector_engine.status_detail,
            "deepseek_configured": bool(settings.deepseek_api_key),
            "protocol_version": 1,
        }

    async def solve(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_initialized()
        payload = parse_client_message(
            {
                "type": "solve_item",
                "session_id": params.get("session_id"),
                "item_id": params.get("item_id"),
                "source_text": params.get("source_text"),
                "options": params.get("options"),
            }
        )
        mode = "debug" if params.get("mode") == "debug" else "normal"
        decision = await self.pipelines[mode].solve(
            item_id=payload.item_id,
            source_text=payload.source_text,
            options=payload.options,
            session_id=payload.session_id,
        )
        return {
            "type": "decision",
            "session_id": payload.session_id,
            "item_id": payload.item_id,
            "target": decision.target,
            "method": decision.method,
            "confidence": decision.confidence,
            "detail": decision.detail,
        }

    @staticmethod
    def _candidate_id(item: ReviewResultItemPayload) -> str:
        raw = "\x00".join(
            [
                normalize_text(clean_source_text(item.source_text)),
                normalize_text(clean_option_text(item.correct_option_text)),
                str(item.item_id),
            ]
        )
        return sha256(raw.encode("utf-8")).hexdigest()[:20]

    def preview_review(self, params: dict[str, Any]) -> dict[str, Any]:
        container = self.require_initialized()
        payload = parse_client_message(
            {
                "type": "review_results",
                "session_id": params.get("session_id"),
                "errors": params.get("errors", []),
            }
        )
        rules = container.patch_store.get_rules()
        candidates = []
        for item in payload.errors:
            source_key = normalize_text(clean_source_text(item.source_text))
            answer_key = normalize_text(clean_option_text(item.correct_option_text))
            same_source = [
                rule
                for rule in rules
                if normalize_text(clean_source_text(rule["source_text"])) == source_key
            ]
            if any(
                normalize_text(clean_option_text(rule["answer_text"])) == answer_key
                for rule in same_source
            ):
                status = "duplicate"
            elif same_source:
                status = "conflict"
            else:
                status = "new"
            candidates.append(
                {
                    "id": self._candidate_id(item),
                    "status": status,
                    "item": item.model_dump(),
                    "existing_rules": same_source,
                    "selected": status == "new",
                }
            )
        return {
            "session_id": payload.session_id,
            "candidates": candidates,
            "counts": {
                "discovered": len(candidates),
                "new": sum(item["status"] == "new" for item in candidates),
                "duplicate": sum(item["status"] == "duplicate" for item in candidates),
                "conflict": sum(item["status"] == "conflict" for item in candidates),
            },
        }

    def apply_review(self, params: dict[str, Any]) -> dict[str, Any]:
        container = self.require_initialized()
        selected = params.get("candidates")
        if not isinstance(selected, list):
            raise ValueError("candidates_must_be_an_array")
        applied = 0
        debug_records = []
        for raw in selected:
            if not isinstance(raw, dict) or raw.get("action") not in {"add", "replace"}:
                continue
            item = ReviewResultItemPayload.model_validate(raw.get("item"))
            note = (
                f"Mac App 结果页确认补丁: 第{item.item_id}题, "
                f"错选={item.wrong_target}->{item.wrong_option_text}, "
                f"正选={item.correct_target}->{item.correct_option_text}"
            )
            if raw["action"] == "replace":
                container.patch_store.replace_source_rule(
                    item.source_text,
                    item.correct_option_text,
                    item.wrong_option_text,
                    note,
                )
            else:
                container.patch_store.upsert_rule(
                    item.source_text,
                    item.correct_option_text,
                    item.wrong_option_text,
                    note,
                )
            debug_records.append(
                {
                    "timestamp": int(time.time()),
                    "session_id": params.get("session_id"),
                    "item_id": item.item_id,
                    "source_text": item.source_text,
                    "options": item.options,
                    "target": item.wrong_target,
                    "method": item.method or "结果页采集",
                    "wrong_target": item.wrong_target,
                    "wrong_option_text": item.wrong_option_text,
                    "correct_target": item.correct_target,
                    "correct_option_text": item.correct_option_text,
                }
            )
            applied += 1
        if debug_records:
            container.debug_store.append_errors(debug_records)
        return {"status": "ok", "applied": applied}

    def list_patch_rules(self) -> dict[str, Any]:
        container = self.require_initialized()
        return {"rules": container.patch_store.get_rules()}

    def update_patch_rule(self, params: dict[str, Any]) -> dict[str, Any]:
        container = self.require_initialized()
        source_text = clean_source_text(str(params.get("source_text", "")))
        answer_text = clean_option_text(str(params.get("answer_text", "")))
        if not source_text or not answer_text:
            raise ValueError("source_and_answer_are_required")
        container.patch_store.replace_source_rule(
            source_text=source_text,
            answer_text=answer_text,
            wrong_answer_text=clean_option_text(str(params.get("wrong_answer_text", ""))),
            note=str(params.get("note", "")).strip(),
        )
        return {"status": "ok"}

    def delete_patch_rule(self, params: dict[str, Any]) -> dict[str, Any]:
        container = self.require_initialized()
        deleted = container.patch_store.delete_rule(
            str(params.get("source_text", "")),
            str(params.get("answer_text", "")),
        )
        return {"status": "ok", "deleted": deleted}

    async def check_api_key(self, params: dict[str, Any]) -> dict[str, Any]:
        key = str(params.get("api_key") or "").strip()
        if not key:
            raise ValueError("api_key_is_required")
        settings = self.settings
        if settings is None:
            raise CoreNotInitializedError("core_not_initialized")
        engine = LLMEngine(
            api_key=key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
            max_retries=0,
        )
        ranked = [
            VectorScore("A", "manage", 0.9),
            VectorScore("B", "finish", 0.4),
            VectorScore("C", "stimulus", 0.2),
            VectorScore("D", "accomplish", 0.1),
        ]
        decision = await engine.choose(
            "管理，经营",
            {"A": "manage", "B": "finish", "C": "stimulus", "D": "accomplish"},
            ranked,
            self.pipelines["normal"].stats,
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
    if method == "review_preview":
        return runtime.preview_review(params)
    if method == "review_apply":
        return runtime.apply_review(params)
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
