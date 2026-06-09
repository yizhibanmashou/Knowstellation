from __future__ import annotations

import argparse
from pathlib import Path

from .io_utils import write_json
from .pipeline import DEFAULT_WORK_ROOT, build_from_markdown_dir, build_from_ocr_jsonl, capture_ocr


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Formula Atlas frontend data from a formula textbook PDF.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture = subparsers.add_parser("capture", help="Submit a PDF or URL to PaddleOCR AIStudio and save JSONL output.")
    capture.add_argument("--book-id", required=True)
    capture.add_argument("--input", required=True, help="Local PDF path or remote file URL.")
    capture.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    capture.add_argument("--token-env", default="PADDLEOCR_AISTUDIO_TOKEN")
    capture.add_argument("--model", default="PaddleOCR-VL-1.6")

    build = subparsers.add_parser("build", help="Build frontend data from an existing OCR JSONL or Markdown directory.")
    build.add_argument("--book-id", required=True)
    build.add_argument("--jsonl", type=Path, default=None)
    build.add_argument("--markdown-dir", type=Path, default=None)
    build.add_argument("--source-pdf", default="")
    build.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    build.add_argument("--publish", action="store_true", help="Replace data/frontend and public/data with generated output.")

    run = subparsers.add_parser("run", help="Capture PaddleOCR output, then build frontend data.")
    run.add_argument("--book-id", required=True)
    run.add_argument("--input", required=True)
    run.add_argument("--source-pdf", default="")
    run.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    run.add_argument("--token-env", default="PADDLEOCR_AISTUDIO_TOKEN")
    run.add_argument("--model", default="PaddleOCR-VL-1.6")
    run.add_argument("--publish", action="store_true")

    args = parser.parse_args()
    if args.command == "capture":
        jsonl_path = capture_ocr(
            input_path_or_url=args.input,
            book_id=args.book_id,
            work_root=args.work_root,
            token_env=args.token_env,
            model=args.model,
        )
        print(jsonl_path)
        return 0
    if args.command == "build":
        if bool(args.jsonl) == bool(args.markdown_dir):
            parser.error("build requires exactly one of --jsonl or --markdown-dir")
        if args.jsonl:
            summary = build_from_ocr_jsonl(
                jsonl_path=args.jsonl,
                book_id=args.book_id,
                source_pdf=args.source_pdf,
                work_root=args.work_root,
                publish=args.publish,
            )
        else:
            summary = build_from_markdown_dir(
                markdown_dir=args.markdown_dir,
                book_id=args.book_id,
                source_pdf=args.source_pdf,
                work_root=args.work_root,
                publish=args.publish,
            )
        print_summary(summary)
        return 0
    if args.command == "run":
        jsonl_path = capture_ocr(
            input_path_or_url=args.input,
            book_id=args.book_id,
            work_root=args.work_root,
            token_env=args.token_env,
            model=args.model,
        )
        summary = build_from_ocr_jsonl(
            jsonl_path=jsonl_path,
            book_id=args.book_id,
            source_pdf=args.source_pdf or args.input,
            work_root=args.work_root,
            publish=args.publish,
        )
        print_summary(summary)
        return 0
    return 2


def print_summary(summary: dict) -> None:
    print(f"book_id={summary['book_id']}")
    print(f"output_dir={summary['output_dir']}")
    print(f"formula_count={summary['formula_count']}")
    print(f"published={summary['published']}")
    report_path = Path(summary["output_dir"]) / "quality" / "build_report.json"
    write_json(Path(summary["output_dir"]) / "last_run_summary.json", summary)
    print(f"quality_report={report_path}")
