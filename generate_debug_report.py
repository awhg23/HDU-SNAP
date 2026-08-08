#!/usr/bin/env python3
"""Backward-compatible debug report entry point."""

from __future__ import annotations

import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parent / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from hdu_snap.reporting.report import main


if __name__ == "__main__":
    main()
