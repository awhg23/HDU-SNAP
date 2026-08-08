#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VENV_DIR="$ROOT_DIR/.venv"
MODEL_DIR="$ROOT_DIR/.models/moka-ai_m3e-base"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/python_env.sh"
VENV_PYTHON="$(hdu_snap_prepare_venv "$ROOT_DIR")"

echo "[HDU-SNAP] Installing full dependencies..."
"$VENV_PYTHON" -m pip install -U pip
"$VENV_PYTHON" -m pip install -r "$ROOT_DIR/requirements.txt"

if [ ! -d "$MODEL_DIR" ]; then
  echo "[HDU-SNAP] Installing local vector model..."
  bash "$ROOT_DIR/install_vector_tier.sh"
else
  echo "[HDU-SNAP] Local vector model already exists: $MODEL_DIR"
fi

cat <<EOF

[HDU-SNAP] Full 3-tier environment is ready.

Next step:
  bash start_backend.sh full

EOF
