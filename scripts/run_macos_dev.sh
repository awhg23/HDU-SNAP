#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}/desktop"

if [[ "${1:-}" == "--isolated" ]]; then
  exec npm run dev:isolated
fi

exec npm run dev
