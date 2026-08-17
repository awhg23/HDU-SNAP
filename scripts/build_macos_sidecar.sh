#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PYTHON_BIN="${PROJECT_DIR}/.venv/bin/python"
OUTPUT_DIR="${PROJECT_DIR}/desktop/resources/prepared/sidecar"
BUILD_DIR="${PROJECT_DIR}/build/macos-sidecar"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "[HDU-SNAP] 未找到 Python 3.10+ 虚拟环境：${PYTHON_BIN}" >&2
  exit 1
fi

if [[ "$("${PYTHON_BIN}" -c 'import platform; print(platform.machine())')" != "arm64" ]]; then
  echo "[HDU-SNAP] sidecar 必须使用 Apple Silicon Python 构建。" >&2
  exit 1
fi

"${PYTHON_BIN}" -c 'import PyInstaller' 2>/dev/null || {
  echo "[HDU-SNAP] 缺少 PyInstaller，请先运行：.venv/bin/pip install -e \".[full,dev]\"" >&2
  exit 1
}

mkdir -p "${OUTPUT_DIR}" "${BUILD_DIR}"

"${PYTHON_BIN}" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name hdu-snap-sidecar \
  --paths "${PROJECT_DIR}/src" \
  --distpath "${OUTPUT_DIR}" \
  --workpath "${BUILD_DIR}/work" \
  --specpath "${BUILD_DIR}" \
  --hidden-import openai \
  "${PROJECT_DIR}/src/hdu_snap/sidecar.py"

echo "[HDU-SNAP] sidecar 已生成：${OUTPUT_DIR}/hdu-snap-sidecar/hdu-snap-sidecar"
