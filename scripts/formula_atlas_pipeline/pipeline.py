from __future__ import annotations

from pathlib import Path
from typing import Any

from .graph import build_frontend_payloads
from .io_utils import safe_slug, utc_now, write_json
from .normalize import (
    events_from_pages,
    load_pages_from_jsonl,
    load_pages_from_markdown_dir,
    normalize_formulas,
    write_normalized_artifacts,
)
from .ocr import AistudioPaddleOCRClient, DEFAULT_MODEL, DEFAULT_OPTIONAL_PAYLOAD, token_from_env
from .quality import build_quality_report
from .teaching import write_teaching_payloads


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORK_ROOT = ROOT / "data" / "formula_atlas_pipeline"


def capture_ocr(
    *,
    input_path_or_url: str,
    book_id: str,
    work_root: Path = DEFAULT_WORK_ROOT,
    token_env: str = "PADDLEOCR_AISTUDIO_TOKEN",
    model: str = DEFAULT_MODEL,
) -> Path:
    output_dir = work_root / safe_slug(book_id) / "ocr_raw"
    token = token_from_env(token_env)
    if not token:
        raise RuntimeError(f"{token_env} is not set. Add it to the local .env file or current shell environment.")
    client = AistudioPaddleOCRClient(
        token,
        model=model,
        optional_payload=dict(DEFAULT_OPTIONAL_PAYLOAD),
    )
    return client.capture(input_path_or_url, output_dir)


def build_from_ocr_jsonl(
    *,
    jsonl_path: Path,
    book_id: str,
    source_pdf: str = "",
    work_root: Path = DEFAULT_WORK_ROOT,
    publish: bool = False,
) -> dict[str, Any]:
    pages = load_pages_from_jsonl(jsonl_path)
    return build_from_pages(pages=pages, book_id=book_id, source_pdf=source_pdf or str(jsonl_path), work_root=work_root, publish=publish)


def build_from_markdown_dir(
    *,
    markdown_dir: Path,
    book_id: str,
    source_pdf: str = "",
    work_root: Path = DEFAULT_WORK_ROOT,
    publish: bool = False,
) -> dict[str, Any]:
    pages = load_pages_from_markdown_dir(markdown_dir)
    return build_from_pages(pages=pages, book_id=book_id, source_pdf=source_pdf or str(markdown_dir), work_root=work_root, publish=publish)


def build_from_pages(
    *,
    pages,
    book_id: str,
    source_pdf: str,
    work_root: Path = DEFAULT_WORK_ROOT,
    publish: bool = False,
) -> dict[str, Any]:
    slug = safe_slug(book_id)
    output_dir = work_root / slug
    normalized_dir = output_dir / "normalized"
    frontend_dir = output_dir / "frontend"
    events = events_from_pages(pages, source_pdf)
    formulas = normalize_formulas(events, source_pdf=source_pdf)
    write_json(
        output_dir / "manifest.json",
        {
            "version": 1,
            "generated_at": utc_now(),
            "book_id": slug,
            "display_name": book_id,
            "source_pdf": source_pdf,
            "ocr": {
                "provider": "aistudio-paddleocr-jobs",
                "model": DEFAULT_MODEL,
                "optional_payload": DEFAULT_OPTIONAL_PAYLOAD,
            },
            "layout": {
                "work_root": str(work_root),
                "ocr_raw": "ocr_raw",
                "normalized": "normalized",
                "quality": "quality",
                "frontend": "frontend",
            },
        },
    )
    write_normalized_artifacts(normalized_dir, pages, events, formulas)
    frontend_summary = build_frontend_payloads(formulas, frontend_dir)
    teaching_summary = write_teaching_payloads(formulas, frontend_dir / "dependency", frontend_dir)
    report = build_quality_report(
        book_id=slug,
        source_pdf=source_pdf,
        formulas=formulas,
        frontend_summary=frontend_summary,
        teaching_summary=teaching_summary,
        output_dir=output_dir,
    )
    if publish:
        publish_frontend(frontend_dir)
    return {
        "book_id": slug,
        "output_dir": str(output_dir),
        "formula_count": len(formulas),
        "frontend_summary": frontend_summary,
        "teaching_summary": teaching_summary,
        "quality_report": report,
        "published": publish,
    }


def publish_frontend(frontend_dir: Path) -> None:
    data_frontend = ROOT / "data" / "frontend"
    public_data = ROOT / "public" / "data"
    merge_generated_tree(frontend_dir, data_frontend)
    merge_generated_tree(frontend_dir, public_data)


def merge_generated_tree(source: Path, target: Path) -> None:
    """Publish generated files without deleting unrelated local work."""

    for path in source.rglob("*"):
        if path.is_dir():
            continue
        relative = path.relative_to(source)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(path.read_bytes())
