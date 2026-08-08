from __future__ import annotations

import subprocess
import sys


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
