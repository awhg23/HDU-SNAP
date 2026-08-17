from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_importing_package_has_no_runtime_side_effects(tmp_path) -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import hdu_snap; import hdu_snap.api.app"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert list(tmp_path.iterdir()) == []


def test_solver_source_has_no_vector_runtime_dependencies() -> None:
    source = (
        Path(__file__).parents[1] / "src" / "hdu_snap" / "infrastructure" / "models.py"
    ).read_text(encoding="utf-8")
    for removed_dependency in ("sentence_transformers", "transformers", "sklearn", "torch"):
        assert removed_dependency not in source
