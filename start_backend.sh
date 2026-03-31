#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

if [ ! -d "$VENV_DIR" ]; then
  echo "[HDU-SNAP] Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install -U pip >/dev/null

if [ ! -f "$MARK_FILE" ] || [ "$ROOT_DIR/$REQUIREMENTS_FILE" -nt "$MARK_FILE" ]; then
  echo "[HDU-SNAP] Installing dependencies from $REQUIREMENTS_FILE ..."
  python -m pip install -r "$ROOT_DIR/$REQUIREMENTS_FILE"
  touch "$MARK_FILE"
fi

if [ -f "$ROOT_DIR/.env" ]; then
  echo "[HDU-SNAP] Loading environment from .env"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

echo "[HDU-SNAP] Starting backend on http://127.0.0.1:8765"
python "$ROOT_DIR/main.py"
