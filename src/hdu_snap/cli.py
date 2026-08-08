from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence

import uvicorn

from hdu_snap.api.app import create_app
from hdu_snap.browser import maybe_open_target_site
from hdu_snap.config import Settings, load_settings
from hdu_snap.domain.models import RuntimeOptions

logger = logging.getLogger("hdu-snap")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hdu-snap", description="HDU-SNAP local solving service")
    subparsers = parser.add_subparsers(dest="command")
    serve = subparsers.add_parser("serve", help="start the local backend")
    serve.add_argument("--mode", choices=("normal", "debug"))
    serve.add_argument("--answer-count", type=int)
    serve.add_argument("--no-open", action="store_true", help="do not open the target site")
    subparsers.add_parser("report", help="generate the debug HTML report")
    config = subparsers.add_parser("config", help="inspect configuration")
    config.add_argument("--check", action="store_true", help="validate and print redacted effective settings")
    return parser


def resolve_runtime_options(
    settings: Settings,
    mode_override: str | None = None,
    answer_count_override: int | None = None,
    interactive: bool | None = None,
) -> RuntimeOptions:
    is_interactive = bool(sys.stdin and sys.stdin.isatty()) if interactive is None else interactive
    mode = mode_override or settings.mode
    if mode is None and is_interactive:
        while True:
            selected = input("请选择运行模式（0=调试，1=正常）：").strip()
            if selected in {"0", "debug"}:
                mode = "debug"
                break
            if selected in {"1", "normal"}:
                mode = "normal"
                break
            print("输入无效，请重新输入。")
    mode = mode or "normal"

    answer_count = answer_count_override or settings.answer_count
    if answer_count is None and is_interactive:
        while True:
            raw = input("请输入答题数量（正整数，默认 100）：").strip()
            if not raw:
                answer_count = 100
                break
            try:
                answer_count = int(raw)
            except ValueError:
                answer_count = None
            if answer_count and answer_count > 0:
                break
            print("输入无效，请输入正整数。")
    answer_count = answer_count or 100
    if answer_count <= 0:
        raise ValueError("answer count must be a positive integer")
    return RuntimeOptions(mode=mode, answer_count=answer_count)


def configure_logging(settings: Settings) -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv) if argv is not None else sys.argv[1:]
    if not arguments:
        arguments = ["serve"]
    args = build_parser().parse_args(arguments)
    settings = load_settings()
    configure_logging(settings)
    if args.command == "config":
        print(settings.redacted_json())
        return 0
    if args.command == "report":
        from hdu_snap.reporting.report import generate_report

        generate_report(settings)
        return 0
    runtime = resolve_runtime_options(settings, args.mode, args.answer_count)
    if args.no_open:
        settings = settings.model_copy(update={"auto_open_site": False})
    logger.info("runtime mode selected: %s", runtime.mode)
    logger.info("answer count selected: %s", runtime.answer_count)
    maybe_open_target_site(settings)
    app = create_app(settings, runtime)
    uvicorn.run(app, host=settings.server_host, port=settings.server_port, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
