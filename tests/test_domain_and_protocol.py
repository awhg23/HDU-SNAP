from __future__ import annotations

import pytest

from hdu_snap.protocol import (
    BatchSummaryResponse,
    ReviewResultsAckResponse,
    ReviewResultsPayload,
    SolveItemPayload,
    parse_client_message,
)
from hdu_snap.domain.text import clean_option_text, clean_source_text, normalize_text


def test_text_cleanup_preserves_existing_behavior() -> None:
    assert clean_source_text("QUESTION 12 CET-4 解决？") == "解决"
    assert clean_option_text("A. resolve。") == "resolve"
    assert normalize_text("离散 的，") == "离散的"


def test_solve_message_is_normalized() -> None:
    parsed = parse_client_message(
        {
            "type": "solve_item",
            "session_id": "s1",
            "item_id": 2,
            "source_text": "第 2 题： news",
            "options": {"A": "A. 新闻", "B": "B. 信息", "C": "C. 消息", "D": "D. 数据"},
        }
    )
    assert isinstance(parsed, SolveItemPayload)
    assert parsed.source_text == "news"
    assert parsed.options["A"] == "新闻"


def test_review_message_validation() -> None:
    parsed = parse_client_message(
        {
            "type": "review_results",
            "session_id": "s1",
            "errors": [
                {
                    "item_id": 1,
                    "source_text": "news",
                    "options": {"A": "新闻", "B": "信息", "C": "消息", "D": "数据"},
                    "wrong_target": "B",
                    "correct_target": "A",
                    "wrong_option_text": "信息",
                    "correct_option_text": "新闻",
                }
            ],
        }
    )
    assert isinstance(parsed, ReviewResultsPayload)
    assert parsed.errors[0].correct_target == "A"
    with pytest.raises(ValueError):
        parse_client_message({"item_id": 1, "source_text": "news", "options": {"A": "x"}})


def test_legacy_response_shapes_remain_versioned_protocol_models() -> None:
    summary = BatchSummaryResponse(total_items=100, ai_call_count=3, review_mode=False)
    assert summary.model_dump() == {
        "type": "batch_summary",
        "session_id": None,
        "total_items": 100,
        "ai_call_count": 3,
        "review_mode": False,
        "status": "pending_manual_confirmation",
    }
    ack = ReviewResultsAckResponse(status="ignored", error_count=0, patch_count=0)
    assert ack.type == "review_results_ack"
