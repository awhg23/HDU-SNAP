from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from hdu_snap.domain.models import LETTER_ORDER
from hdu_snap.domain.text import clean_option_text, clean_source_text


class SolveItemPayload(BaseModel):
    type: str = "solve_item"
    session_id: str | None = None
    item_id: int
    source_text: str
    options: dict[str, str]


class BatchCompletePayload(BaseModel):
    type: str = "batch_complete"
    session_id: str | None = None
    total_items: int = 100


class ReviewResultItemPayload(BaseModel):
    item_id: int
    source_text: str
    options: dict[str, str]
    wrong_target: str
    correct_target: str
    wrong_option_text: str
    correct_option_text: str
    method: str | None = None


class ReviewResultsPayload(BaseModel):
    type: str = "review_results"
    session_id: str | None = None
    errors: list[ReviewResultItemPayload]


class DecisionResponse(BaseModel):
    type: str = "decision"
    session_id: str | None = None
    item_id: int
    target: str
    method: str
    confidence: float | None = None
    detail: str | None = None


class ErrorResponse(BaseModel):
    type: str = "error"
    session_id: str | None = None
    message: str
    item_id: int | None = None


class BatchSummaryResponse(BaseModel):
    type: str = "batch_summary"
    session_id: str | None = None
    total_items: int
    ai_call_count: int
    review_mode: bool
    status: str = "pending_manual_confirmation"


class ReviewResultsAckResponse(BaseModel):
    type: str = "review_results_ack"
    session_id: str | None = None
    status: str
    error_count: int
    patch_count: int


ClientMessage = SolveItemPayload | BatchCompletePayload | ReviewResultsPayload
ServerMessage = DecisionResponse | ErrorResponse | BatchSummaryResponse | ReviewResultsAckResponse


def _normalize_options(raw_options: Any, prefix: str = "") -> dict[str, str]:
    if not isinstance(raw_options, dict):
        raise ValueError(f"{prefix}options must be an object".strip())
    options: dict[str, str] = {}
    for letter in LETTER_ORDER:
        if letter not in raw_options:
            raise ValueError(f"missing {prefix}option '{letter}'")
        text = clean_option_text(str(raw_options[letter]))
        if not text:
            raise ValueError(f"{prefix}option '{letter}' cannot be empty")
        options[letter] = text
    return options


def parse_client_message(payload: dict[str, Any]) -> ClientMessage:
    message_type = payload.get("type", "solve_item")
    if message_type == "batch_complete":
        return BatchCompletePayload.model_validate(
            {
                "type": message_type,
                "session_id": payload.get("session_id"),
                "total_items": payload.get("total_items", 100),
            }
        )
    if message_type == "review_results":
        raw_errors = payload.get("errors")
        if not isinstance(raw_errors, list):
            raise ValueError("errors must be an array")
        errors = []
        for raw_error in raw_errors:
            if not isinstance(raw_error, dict):
                raise ValueError("each review error must be an object")
            options = _normalize_options(raw_error.get("options"), "review error ")
            wrong_target = str(raw_error.get("wrong_target", "")).upper()
            correct_target = str(raw_error.get("correct_target", "")).upper()
            if wrong_target not in LETTER_ORDER or correct_target not in LETTER_ORDER:
                raise ValueError("wrong_target and correct_target must be one of A/B/C/D")
            source_text = clean_source_text(str(raw_error.get("source_text", "")))
            wrong_text = clean_option_text(str(raw_error.get("wrong_option_text", "")))
            correct_text = clean_option_text(str(raw_error.get("correct_option_text", "")))
            if not source_text or not wrong_text or not correct_text:
                raise ValueError("review source_text and option texts cannot be empty")
            errors.append(
                {
                    "item_id": int(raw_error.get("item_id")),
                    "source_text": source_text,
                    "options": options,
                    "wrong_target": wrong_target,
                    "correct_target": correct_target,
                    "wrong_option_text": wrong_text,
                    "correct_option_text": correct_text,
                    "method": str(raw_error.get("method", "")).strip() or None,
                }
            )
        return ReviewResultsPayload.model_validate(
            {"type": message_type, "session_id": payload.get("session_id"), "errors": errors}
        )
    options = _normalize_options(payload.get("options"))
    source_text = clean_source_text(str(payload.get("source_text", "")))
    if not source_text:
        raise ValueError("source_text cannot be empty")
    return SolveItemPayload.model_validate(
        {
            "type": message_type,
            "session_id": payload.get("session_id"),
            "item_id": payload.get("item_id"),
            "source_text": source_text,
            "options": options,
        }
    )
