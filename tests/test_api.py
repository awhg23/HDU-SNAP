from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

from hdu_snap.api.app import create_app
from hdu_snap.config import Settings
from hdu_snap.domain.models import RunStats, RuntimeOptions, TierDecision


class FakePatchStore:
    @staticmethod
    def get_rules():
        return [{"source_text": "新闻", "answer_text": "news"}]


class FakePipeline:
    def __init__(self):
        self.stats = RunStats()

    async def solve(self, **_kwargs):
        self.stats.record_item()
        return TierDecision("A", "字典匹配", 1.0, "fixture")

    @staticmethod
    def print_final_summary(_total):
        return None

    @staticmethod
    def ingest_review_results(errors, _session_id):
        return {"errors": len(errors), "patches": len(errors)}


class FakeServices:
    patch_store = FakePatchStore()
    vector_engine = SimpleNamespace(mode="fallback", status_detail="fixture", model_dir="/model")

    @staticmethod
    def build_pipeline():
        return FakePipeline()


def build_client(tmp_path, mode="normal") -> TestClient:
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        dictionary_path=tmp_path / "dictionary.json",
        patch_rules_path=tmp_path / "patch.jsonc",
        embedding_model_dir=tmp_path / "model",
    )
    return TestClient(create_app(settings, RuntimeOptions(mode=mode, answer_count=7), FakeServices()))


def test_health_and_client_config_are_compatible_and_safe(tmp_path) -> None:
    with build_client(tmp_path) as client:
        health = client.get("/health").json()
        assert health["status"] == "ok"
        assert health["answer_count"] == 7
        assert health["patch_rule_count"] == 1
        config = client.get("/api/v1/client-config").json()
        assert config["schema_version"] == 1
        assert config["answer_count"] == 7


def test_websocket_solve_and_batch_contract(tmp_path) -> None:
    with build_client(tmp_path) as client:
        with client.websocket_connect("/ws/solve") as websocket:
            websocket.send_json(
                {
                    "type": "solve_item",
                    "session_id": "s1",
                    "item_id": 1,
                    "source_text": "news",
                    "options": {"A": "新闻", "B": "数据", "C": "项目", "D": "单词"},
                }
            )
            decision = websocket.receive_json()
            assert decision["type"] == "decision"
            assert decision["target"] == "A"
            websocket.send_json({"type": "batch_complete", "session_id": "s1", "total_items": 1})
            summary = websocket.receive_json()
            assert summary["type"] == "batch_summary"
            assert summary["status"] == "pending_manual_confirmation"


def test_review_results_are_ignored_in_normal_mode(tmp_path) -> None:
    with build_client(tmp_path) as client:
        with client.websocket_connect("/ws/solve") as websocket:
            websocket.send_json({"type": "review_results", "session_id": "s1", "errors": []})
            response = websocket.receive_json()
            assert response["type"] == "review_results_ack"
            assert response["status"] == "ignored"


def test_review_results_are_ingested_in_debug_mode(tmp_path) -> None:
    with build_client(tmp_path, mode="debug") as client:
        with client.websocket_connect("/ws/solve") as websocket:
            websocket.send_json(
                {
                    "type": "review_results",
                    "session_id": "s1",
                    "errors": [
                        {
                            "item_id": 1,
                            "source_text": "news",
                            "options": {"A": "新闻", "B": "数据", "C": "项目", "D": "单词"},
                            "wrong_target": "B",
                            "correct_target": "A",
                            "wrong_option_text": "数据",
                            "correct_option_text": "新闻",
                        }
                    ],
                }
            )
            response = websocket.receive_json()
            assert response["status"] == "ok"
            assert response["error_count"] == 1
            assert response["patch_count"] == 1
