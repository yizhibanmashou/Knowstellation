from __future__ import annotations

from pathlib import Path
from typing import Any

from .io_utils import utc_now, write_json
from .models import FormulaRecord, LOW_CONFIDENCE_THRESHOLD


def build_quality_report(
    *,
    book_id: str,
    source_pdf: str,
    formulas: list[FormulaRecord],
    frontend_summary: dict[str, Any],
    teaching_summary: dict[str, Any],
    output_dir: Path,
) -> dict[str, Any]:
    dependencies = load_dependencies(output_dir / "frontend" / "dependency")
    formula_ids = {formula.id for formula in formulas}
    low_confidence_ids = {formula.id for formula in formulas if formula.confidence < LOW_CONFIDENCE_THRESHOLD}
    accepted_edges = [
        (dep, prereq)
        for dep in dependencies
        for prereq in dep.get("prerequisites") or []
        if prereq.get("edge_status") == "accepted"
    ]
    accepted_missing_targets = [
        {"dependent_id": dep.get("dependent_id"), "target_id": prereq.get("target_id")}
        for dep, prereq in accepted_edges
        if prereq.get("type") == "formula" and prereq.get("target_id") not in formula_ids
    ]
    low_confidence_accepted_edges = [
        {"dependent_id": dep.get("dependent_id"), "target_id": prereq.get("target_id"), "via_symbol": prereq.get("via_symbol")}
        for dep, prereq in accepted_edges
        if dep.get("dependent_id") in low_confidence_ids or prereq.get("target_id") in low_confidence_ids
    ]
    missing_source_trace = [formula.id for formula in formulas if not formula.source_trace.ocr_block_id]
    duplicate_ids = sorted(id_ for id_, count in counts(formula.id for formula in formulas).items() if count > 1)
    low_confidence = [
        {
            "id": formula.id,
            "label": formula.label,
            "confidence": round(formula.confidence, 4),
            "review_flags": formula.review_flags,
            "source_trace": formula.source_trace.to_json(),
        }
        for formula in formulas
        if formula.confidence < LOW_CONFIDENCE_THRESHOLD
    ]
    ambiguous_edges = sum(len(payload.get("ambiguous") or []) for payload in load_dependency_payloads(output_dir / "frontend" / "dependency"))
    report = {
        "version": 1,
        "generated_at": utc_now(),
        "book_id": book_id,
        "source_pdf": source_pdf,
        "policy": "marked_publish",
        "summaries": {
            "frontend": frontend_summary,
            "teaching": teaching_summary,
            "formula_count": len(formulas),
            "low_confidence_formula_count": len(low_confidence),
            "missing_formula_number_count": sum(1 for formula in formulas if "missing_formula_number" in formula.review_flags),
            "ambiguous_edge_count": ambiguous_edges,
            "llm_fallback_count": len(formulas),
        },
        "accuracy_checks": {
            "formula_ids_unique": not duplicate_ids,
            "accepted_edges_reference_existing_formulas": not accepted_missing_targets,
            "low_confidence_ocr_has_no_accepted_edges": not low_confidence_accepted_edges,
            "every_formula_has_source_trace": not missing_source_trace,
        },
        "issues": {
            "duplicate_formula_ids": duplicate_ids,
            "accepted_missing_targets": accepted_missing_targets,
            "low_confidence_accepted_edges": low_confidence_accepted_edges,
            "missing_source_trace": missing_source_trace,
            "low_confidence_formulas": low_confidence,
        },
    }
    write_json(output_dir / "quality" / "build_report.json", report)
    return report


def load_dependency_payloads(dependency_dir: Path) -> list[dict[str, Any]]:
    import json

    payloads = []
    for path in sorted(dependency_dir.glob("*_dependencies.json")):
        with path.open("r", encoding="utf-8-sig") as fh:
            payloads.append(json.load(fh))
    return payloads


def load_dependencies(dependency_dir: Path) -> list[dict[str, Any]]:
    deps: list[dict[str, Any]] = []
    for payload in load_dependency_payloads(dependency_dir):
        deps.extend(payload.get("dependencies") or [])
    return deps


def counts(values) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        result[value] = result.get(value, 0) + 1
    return result
