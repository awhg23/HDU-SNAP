#!/usr/bin/env bash

# Shared Python runtime checks for the macOS/Linux scripts.

hdu_snap_python_is_supported() {
  local python_executable="${1:?python executable is required}"
  "$python_executable" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}

hdu_snap_python_version() {
  local python_executable="${1:?python executable is required}"
  "$python_executable" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'
}

hdu_snap_find_supported_python() {
  local candidate_name candidate_path uv_path requested_version
  for candidate_name in python3.12 python3.11 python3.10; do
    candidate_path="$(command -v "$candidate_name" 2>/dev/null || true)"
    if [ -n "$candidate_path" ] && hdu_snap_python_is_supported "$candidate_path"; then
      printf '%s\n' "$candidate_path"
      return 0
    fi
  done

  if command -v uv >/dev/null 2>&1; then
    for requested_version in 3.12 3.11 3.10; do
      uv_path="$(uv python find --no-python-downloads "$requested_version" 2>/dev/null || true)"
      if [ -n "$uv_path" ] && hdu_snap_python_is_supported "$uv_path"; then
        printf '%s\n' "$uv_path"
        return 0
      fi
    done
  fi

  for candidate_name in python3 python; do
    candidate_path="$(command -v "$candidate_name" 2>/dev/null || true)"
    if [ -n "$candidate_path" ] && hdu_snap_python_is_supported "$candidate_path"; then
      printf '%s\n' "$candidate_path"
      return 0
    fi
  done
  return 1
}

hdu_snap_prepare_venv() {
  local project_root="${1:?project root is required}"
  local venv_dir venv_python base_python old_version safe_version timestamp backup_dir

  case "$project_root" in
    /*) ;;
    *)
      echo "[HDU-SNAP] Internal error: project root must be absolute: $project_root" >&2
      return 1
      ;;
  esac
  if [ ! -d "$project_root" ]; then
    echo "[HDU-SNAP] Internal error: project root does not exist: $project_root" >&2
    return 1
  fi

  venv_dir="$project_root/.venv"
  venv_python="$venv_dir/bin/python"
  if [ -x "$venv_python" ] && hdu_snap_python_is_supported "$venv_python"; then
    printf '%s\n' "$venv_python"
    return 0
  fi

  base_python="$(hdu_snap_find_supported_python || true)"
  if [ -z "$base_python" ]; then
    cat >&2 <<'EOF'
[HDU-SNAP] Python 3.10 or newer is required, but no compatible interpreter was found.

Install one and rerun this command. On macOS with Homebrew:
  brew install python@3.12

If uv is installed, you can also run:
  uv python install 3.12
EOF
    return 1
  fi

  if [ -e "$venv_dir" ] || [ -L "$venv_dir" ]; then
    if [ -L "$venv_dir" ]; then
      echo "[HDU-SNAP] Refusing to replace symlinked virtual environment: $venv_dir" >&2
      return 1
    fi
    if [ ! -d "$venv_dir" ]; then
      echo "[HDU-SNAP] Refusing to replace non-directory path: $venv_dir" >&2
      return 1
    fi
    old_version="unknown"
    if [ -x "$venv_python" ]; then
      old_version="$(hdu_snap_python_version "$venv_python" 2>/dev/null || printf 'unknown')"
    fi
    safe_version="$(printf '%s' "$old_version" | tr -cd '0-9.')"
    [ -n "$safe_version" ] || safe_version="unknown"
    timestamp="$(date '+%Y%m%d-%H%M%S')"
    backup_dir="$project_root/.venv-python${safe_version}-backup-${timestamp}"
    if [ -e "$backup_dir" ] || [ -L "$backup_dir" ]; then
      echo "[HDU-SNAP] Backup target already exists; refusing to continue: $backup_dir" >&2
      return 1
    fi
    echo "[HDU-SNAP] Existing .venv uses Python $old_version; moving it to:" >&2
    echo "  $backup_dir" >&2
    if ! mv "$venv_dir" "$backup_dir"; then
      echo "[HDU-SNAP] Failed to preserve the existing virtual environment; aborting." >&2
      return 1
    fi
  fi

  echo "[HDU-SNAP] Creating .venv with $base_python ($(hdu_snap_python_version "$base_python"))..." >&2
  if ! "$base_python" -m venv "$venv_dir"; then
    echo "[HDU-SNAP] Failed to create the replacement virtual environment." >&2
    return 1
  fi
  if [ ! -x "$venv_python" ] || ! hdu_snap_python_is_supported "$venv_python"; then
    echo "[HDU-SNAP] Failed to create a Python 3.10+ virtual environment." >&2
    return 1
  fi
  printf '%s\n' "$venv_python"
}
