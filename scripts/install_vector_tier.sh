#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VENV_DIR="$ROOT_DIR/.venv"
MODEL_DIR="$ROOT_DIR/.models/moka-ai_m3e-base"
MODEL_NAME="moka-ai/m3e-base"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/python_env.sh"
VENV_PYTHON="$(hdu_snap_prepare_venv "$ROOT_DIR")"

echo "[HDU-SNAP] Installing vector tier dependencies..."
"$VENV_PYTHON" -m pip install -U pip
"$VENV_PYTHON" -m pip install "sentence-transformers>=2.6,<4.0" "torch>=2.2,<3.0"

mkdir -p "$MODEL_DIR"

echo "[HDU-SNAP] Downloading local embedding model to $MODEL_DIR ..."
"$VENV_PYTHON" - <<PY
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("${MODEL_NAME}")
model.save("${MODEL_DIR}")
print("Saved model to ${MODEL_DIR}")
PY

cat <<EOF

[HDU-SNAP] Vector tier installation completed.

Next step:
  1. Start backend:
     bash start_backend.sh lite
  2. Verify status:
     open http://127.0.0.1:8765/health

Expected health fields:
  "vector_mode": "embedding"
  "vector_model_dir": "${MODEL_DIR}"

EOF
