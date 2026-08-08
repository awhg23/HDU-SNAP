#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-lite}"
case "$MODE" in
  lite)
    REQUIREMENTS_FILE="requirements-lite.txt"
    ;;
  full)
    REQUIREMENTS_FILE="requirements.txt"
    ;;
  *)
    echo "Usage: bash start_backend.sh [lite|full]"
    exit 1
    ;;
esac

VENV_DIR="$ROOT_DIR/.venv"
MARK_FILE="$VENV_DIR/.installed-${MODE}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/python_env.sh"
VENV_PYTHON="$(hdu_snap_prepare_venv "$ROOT_DIR")"

"$VENV_PYTHON" -m pip install -U pip >/dev/null

if [ ! -f "$MARK_FILE" ] || [ "$ROOT_DIR/$REQUIREMENTS_FILE" -nt "$MARK_FILE" ] || [ "$ROOT_DIR/pyproject.toml" -nt "$MARK_FILE" ]; then
  echo "[HDU-SNAP] Installing dependencies from $REQUIREMENTS_FILE ..."
  "$VENV_PYTHON" -m pip install -r "$ROOT_DIR/$REQUIREMENTS_FILE"
  touch "$MARK_FILE"
fi

echo "[HDU-SNAP] Starting backend (address is configured by .env)"
"$VENV_PYTHON" "$ROOT_DIR/main.py"
