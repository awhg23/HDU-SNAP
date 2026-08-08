from __future__ import annotations

import json

from hdu_snap.config import Settings
from hdu_snap.reporting.report import generate_report


def test_report_uses_configured_data_directory(tmp_path) -> None:
    (tmp_path / "debug_recent_10000.json").write_text("[]", encoding="utf-8")
    (tmp_path / "debug_error_1000.json").write_text("[]", encoding="utf-8")
    settings = Settings(_env_file=None, data_dir=tmp_path)
    generate_report(settings)
    assert settings.report_html_path.exists()
    assert json.loads(settings.report_summary_path.read_text(encoding="utf-8"))["recent_count"] == 0
