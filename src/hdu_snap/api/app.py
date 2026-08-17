from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from hdu_snap.api.contracts import (
    BatchCompletePayload,
    DecisionResponse,
    ErrorResponse,
    ReviewResultsPayload,
    parse_client_message,
)
from hdu_snap.bootstrap import ServiceContainer
from hdu_snap.config import Settings
from hdu_snap.domain.models import RuntimeOptions

logger = logging.getLogger("hdu-snap")


def create_app(
    settings: Settings,
    runtime_options: RuntimeOptions,
    services: ServiceContainer | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.services = services or ServiceContainer.create(settings, runtime_options)
        yield

    app = FastAPI(title="HDU-SNAP Backend", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.runtime_options = runtime_options
    app.state.services = services

    @app.get("/health")
    async def healthcheck() -> dict[str, Any]:
        container = _services(app)
        return {
            "status": "ok",
            "runtime_mode": runtime_options.mode,
            "answer_count": runtime_options.answer_count,
            "dictionary_source": str(settings.resolved_dictionary_path),
            "patch_rule_file": str(settings.resolved_patch_rules_path),
            "patch_rule_count": len(container.patch_store.get_rules()),
            "vector_mode": "removed",
            "vector_status_detail": "vector tier removed",
            "vector_model_dir": None,
            "timestamp": int(time.time()),
        }

    @app.get("/api/v1/client-config")
    async def client_config() -> dict[str, Any]:
        payload = settings.client_config
        payload["answer_count"] = runtime_options.answer_count
        return payload

    @app.websocket("/ws/solve")
    async def solve_socket(websocket: WebSocket) -> None:
        await websocket.accept()
        logger.info("websocket connected: %s", websocket.client)
        pipeline = _services(app).build_pipeline()
        try:
            while True:
                raw_message = await websocket.receive_text()
                try:
                    parsed_message = parse_client_message(json.loads(raw_message))
                except Exception as exc:
                    await _send_json(websocket, ErrorResponse(message=f"invalid payload: {exc}"))
                    continue
                if isinstance(parsed_message, BatchCompletePayload):
                    total = pipeline.stats.processed_items or parsed_message.total_items
                    pipeline.print_final_summary(total)
                    await _send_json(
                        websocket,
                        {
                            "type": "batch_summary",
                            "session_id": parsed_message.session_id,
                            "total_items": total,
                            "ai_call_count": pipeline.stats.ai_call_count,
                            "review_mode": runtime_options.is_debug,
                            "status": "pending_manual_confirmation",
                        },
                    )
                    continue
                if isinstance(parsed_message, ReviewResultsPayload):
                    if runtime_options.is_debug:
                        stats = pipeline.ingest_review_results(parsed_message.errors, parsed_message.session_id)
                        status = "ok"
                    else:
                        stats = {"errors": 0, "patches": 0}
                        status = "ignored"
                    await _send_json(
                        websocket,
                        {
                            "type": "review_results_ack",
                            "session_id": parsed_message.session_id,
                            "status": status,
                            "error_count": stats["errors"],
                            "patch_count": stats["patches"],
                        },
                    )
                    continue
                try:
                    decision = await pipeline.solve(
                        item_id=parsed_message.item_id,
                        source_text=parsed_message.source_text,
                        options=parsed_message.options,
                        session_id=parsed_message.session_id,
                    )
                    await _send_json(
                        websocket,
                        DecisionResponse(
                            session_id=parsed_message.session_id,
                            item_id=parsed_message.item_id,
                            target=decision.target,
                            method=decision.method,
                            confidence=decision.confidence,
                            detail=decision.detail,
                        ),
                    )
                except Exception as exc:  # pragma: no cover - live safeguard
                    logger.exception("failed to solve item %s", parsed_message.item_id)
                    await _send_json(
                        websocket,
                        ErrorResponse(
                            session_id=parsed_message.session_id,
                            item_id=parsed_message.item_id,
                            message=f"server error: {type(exc).__name__}",
                        ),
                    )
        except WebSocketDisconnect:
            logger.info("websocket disconnected: %s", websocket.client)

    return app


def _services(app: FastAPI) -> ServiceContainer:
    services = app.state.services
    if services is None:  # pragma: no cover - only if lifespan was bypassed
        raise RuntimeError("application services are not initialized")
    return services


async def _send_json(websocket: WebSocket, payload: BaseModel | dict[str, Any]) -> None:
    await websocket.send_json(payload.model_dump() if isinstance(payload, BaseModel) else payload)
