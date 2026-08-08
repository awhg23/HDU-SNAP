"""Backward-compatible entry point for ``python main.py``."""

from __future__ import annotations

import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parent / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from hdu_snap.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
