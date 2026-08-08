from __future__ import annotations

import logging
import platform
import shutil
import subprocess
from pathlib import Path

from hdu_snap.config import FALLBACK_TARGET_URLS, Settings

logger = logging.getLogger("hdu-snap")


def maybe_open_target_site(settings: Settings) -> None:
    if not settings.auto_open_site:
        logger.info("auto-open target site disabled by HDU_SNAP_AUTO_OPEN_SITE")
        return
    try:
        if open_url_in_browser(settings.target_url, settings):
            logger.info("opened target site in Chrome: %s", settings.target_url)
        else:
            logger.warning("Chrome did not confirm opening; please open manually: %s", settings.target_url)
    except Exception as exc:  # pragma: no cover - platform dependent
        logger.warning("failed to open target site automatically: %s", type(exc).__name__)
        logger.info("manual target URLs: %s", " | ".join(FALLBACK_TARGET_URLS))
    logger.info("extension keeps listening after login; no terminal confirmation is required")


def open_url_in_browser(url: str, settings: Settings) -> bool:
    system_name = platform.system()
    if system_name == "Darwin":
        for app_name in ("Google Chrome", "Google Chrome.app", "Chrome"):
            result = subprocess.run(
                ["open", "-a", app_name, url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode == 0:
                return True
        return subprocess.run(["open", url], check=False).returncode == 0
    if system_name == "Windows":
        candidates = [shutil.which("chrome"), shutil.which("chrome.exe")]
        if settings.windows_program_files:
            candidates.append(str(settings.windows_program_files / "Google/Chrome/Application/chrome.exe"))
        if settings.windows_program_files_x86:
            candidates.append(str(settings.windows_program_files_x86 / "Google/Chrome/Application/chrome.exe"))
        if settings.windows_local_app_data:
            candidates.append(str(settings.windows_local_app_data / "Google/Chrome/Application/chrome.exe"))
        for candidate in candidates:
            if not candidate:
                continue
            path = Path(candidate)
            if not path.exists() and not shutil.which(candidate):
                continue
            try:
                subprocess.Popen([str(path if path.exists() else candidate), url])
                return True
            except Exception:
                continue
        return False
    for browser_name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        browser_path = shutil.which(browser_name)
        if browser_path:
            result = subprocess.run(
                [browser_path, url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode == 0:
                return True
    opener = shutil.which("xdg-open")
    return bool(opener and subprocess.run([opener, url], check=False).returncode == 0)
