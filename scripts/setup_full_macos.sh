#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VENV_DIR="$ROOT_DIR/.venv"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/python_env.sh"
VENV_PYTHON="$(hdu_snap_prepare_venv "$ROOT_DIR")"

echo "[HDU-SNAP] Installing full dependencies..."
"$VENV_PYTHON" -m pip install -U pip
echo "[HDU-SNAP] Removing retired vector runtime packages..."
"$VENV_PYTHON" -m pip uninstall -y \
  torch sentence-transformers transformers scikit-learn scipy numpy \
  huggingface-hub hf-xet tokenizers safetensors sympy networkx joblib \
  threadpoolctl fsspec filelock pillow regex >/dev/null 2>&1 || true
"$VENV_PYTHON" -m pip install -r "$ROOT_DIR/requirements.txt"
"$VENV_PYTHON" -m pip check

cat <<EOF

[HDU-SNAP] Full environment is ready.

Next step:
  bash start_backend.sh full

EOF
