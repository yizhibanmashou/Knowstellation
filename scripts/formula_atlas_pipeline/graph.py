from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
from typing import Any

from .io_utils import utc_now, write_json
from .models import FormulaRecord, LOW_CONFIDENCE_THRESHOLD

try:
    from scripts.symbol_extraction import canonical_symbol, extract_symbols, family_key, symbol_role
except ImportError:  # pragma: no cover - supports direct test execution with scripts/ on sys.path
    from symbol_extraction import canonical_symbol, extract_symbols, family_key, symbol_role


EDGE_EXPLICIT = "explicit_reference"
EDGE_EXACT = "exact_match"
EDGE_CANONICAL = "canonical_match"
EDGE_COMPOUND = "compound_group"
EDGE_TEXT = "text_definition"
EDGE_FAMILY = "family_candidate"
EDGE_LOW_CONFIDENCE = "low_confidence_ocr"


def enrich_formula_symbols(formulas: list[FormulaRecord]) -> None:
    for formula in formulas:
        extracted = extract_symbols(formula.latex)
        formula.symbols_used_detailed = extracted.get("symbols_used_detailed") or []
        formula.symbols_defined_detailed = extracted.get("symbols_defined_detailed") or []
        formula.symbols_used = [item["symbol"] for item in extracted.get("symbols_used") or []]
        formula.symbols_defined = [item["symbol"] for item in extracted.get("symbols_defined") or []]


def build_frontend_payloads(formulas: list[FormulaRecord], output_dir: Path) -> dict[str, Any]:
    enrich_formula_symbols(formulas)
    by_chapter: dict[str, list[FormulaRecord]] = defaultdict(list)
    for formula in formulas:
        by_chapter[formula.chapter_id].append(formula)

    dependency_dir = output_dir / "dependency"
    all_dependencies: list[dict[str, Any]] = []
    all_formulas: list[FormulaRecord] = []
    for chapter_id, chapter_formulas in sorted(by_chapter.items(), key=lambda item: chapter_sort_key(item[0])):
        chapter_formulas.sort(key=lambda item: item.position)
        payload = build_chapter_dependencies(chapter_id, chapter_formulas)
        write_json(dependency_dir / f"{chapter_id}_dependencies.json", payload)
        all_dependencies.extend(payload["dependencies"])
        all_formulas.extend(chapter_formulas)

    search_index = [formula.to_search_formula() for formula in sorted(all_formulas, key=formula_sort_key)]
    write_json(output_dir / "formula_search_index.json", search_index)
    write_json(output_dir / "featured_formulas.json", build_featured_formulas(all_formulas, all_dependencies))
    write_json(output_dir / "chapter_navigator.json", build_chapter_navigator(by_chapter))
    write_json(output_dir / "learning_paths.json", {"version": 1, "items": []})
    return {
        "chapters": sorted(by_chapter),
        "formula_count": len(all_formulas),
        "dependency_count": len(all_dependencies),
    }


def build_chapter_dependencies(chapter_id: str, formulas: list[FormulaRecord]) -> dict[str, Any]:
    definition_index: dict[str, FormulaRecord] = {}
    canonical_index: dict[str, FormulaRecord] = {}
    family_index: dict[str, list[FormulaRecord]] = defaultdict(list)
    dependencies: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    depths: dict[str, int] = {}

    for formula in formulas:
        prereqs: list[dict[str, Any]] = []

        for target in prior_group_neighbors(formulas, formula):
            if formula.is_low_confidence or target.is_low_confidence:
                ambiguous.append(ambiguous_entry(formula, target, "Equation group", EDGE_LOW_CONFIDENCE))
                continue
            prereqs.append(
                build_prerequisite(
                    target.id,
                    f"Equation {target.raw_id}",
                    "compound_group",
                    f"{formula.label} belongs to the same numbered group as {target.label}.",
                    0.86,
                    EDGE_COMPOUND,
                    review_note="Same numbered formula group; keep as grouped context edge.",
                )
            )

        explicit_refs = explicit_formula_references(formula.context_text)
        for ref in explicit_refs:
            target = next((candidate for candidate in formulas if candidate.raw_id == ref and candidate.position < formula.position), None)
            if not target:
                continue
            if formula.is_low_confidence or target.is_low_confidence:
                ambiguous.append(ambiguous_entry(formula, target, ref, EDGE_LOW_CONFIDENCE))
                continue
            prereqs.append(
                build_prerequisite(
                    target.id,
                    f"Equation {ref}",
                    "explicit_reference",
                    f"{formula.label} explicitly references {target.label}.",
                    0.94,
                    EDGE_EXPLICIT,
                )
            )

        defined = {item["symbol"] for item in formula.symbols_defined_detailed}
        for symbol in formula.symbols_used_detailed:
            symbol_value = symbol["symbol"]
            if symbol_value in defined:
                continue
            exact_target = definition_index.get(symbol_value)
            canonical_target = canonical_index.get(symbol.get("canonical_latex") or canonical_symbol(symbol_value))
            target = exact_target or canonical_target
            evidence = EDGE_EXACT if exact_target else EDGE_CANONICAL
            if target:
                if formula.is_low_confidence or target.is_low_confidence:
                    ambiguous.append(ambiguous_entry(formula, target, symbol_value, EDGE_LOW_CONFIDENCE))
                    continue
                prereqs.append(
                    build_prerequisite(
                        target.id,
                        symbol_value,
                        "uses_defined_symbol",
                        f"{formula.label} uses {symbol_value}, previously defined by {target.label}.",
                        0.9 if evidence == EDGE_EXACT else 0.82,
                        evidence,
                        canonical=symbol.get("canonical_latex"),
                        symbol_role_value=symbol.get("role"),
                    )
                )
                continue

            text_definition = find_text_definition(symbol_value, formula.context_text)
            if text_definition and not formula.is_low_confidence:
                prereqs.append(
                    build_prerequisite(
                        "",
                        symbol_value,
                        "text_definition",
                        f"{symbol_value} is defined in nearby text.",
                        0.78,
                        EDGE_TEXT,
                        canonical=symbol.get("canonical_latex"),
                        symbol_role_value=symbol.get("role"),
                        definition=text_definition,
                    )
                )
                continue

            family_targets = [
                candidate
                for candidate in family_index.get(symbol.get("family_key") or family_key(symbol_value), [])
                if candidate.id != formula.id
            ]
            if family_targets:
                ambiguous.append(
                    {
                        "dependent_id": formula.id,
                        "target_id": family_targets[-1].id,
                        "symbol": symbol_value,
                        "edge_evidence": EDGE_FAMILY,
                        "edge_status": "ambiguous",
                        "reason": "Only a coarse symbol-family match was found; not safe enough for an accepted edge.",
                        "confidence": 0.45,
                    }
                )

        prereqs = dedupe_prerequisites(prereqs)
        depth = 0
        for prereq in prereqs:
            target_id = prereq.get("target_id")
            if target_id:
                depth = max(depth, depths.get(str(target_id), 0) + 1)
        formula.depth = depth
        depths[formula.id] = depth
        dependencies.append({"dependent_id": formula.id, "prerequisites": prereqs})

        for symbol in formula.symbols_defined_detailed:
            symbol_value = symbol["symbol"]
            definition_index[symbol_value] = formula
            canonical_index[symbol.get("canonical_latex") or canonical_symbol(symbol_value)] = formula
            family_index[symbol.get("family_key") or family_key(symbol_value)].append(formula)

    return {
        "chapter_id": chapter_id,
        "version": 1,
        "generated_at": utc_now(),
        "formulas": [formula.to_dependency_formula() for formula in formulas],
        "dependencies": dependencies,
        "symbol_index": build_symbol_index(formulas),
        "ambiguous": ambiguous,
    }


def build_prerequisite(
    target_id: str,
    via_symbol: str,
    relation: str,
    reason: str,
    confidence: float,
    evidence: str,
    *,
    canonical: str | None = None,
    symbol_role_value: str | None = None,
    definition: str | None = None,
    review_note: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "formula" if target_id else "variable_definition",
        "target_id": target_id or None,
        "via_symbol": via_symbol,
        "relation": relation,
        "reason": reason,
        "confidence": confidence,
        "cross_chapter": False,
        "edge_status": "accepted",
        "edge_evidence": evidence,
        "canonical_symbol": canonical or canonical_symbol(via_symbol),
        "symbol_role": symbol_role_value or symbol_role(via_symbol),
        "edge_weight": 1.0 if evidence in {EDGE_EXACT, EDGE_EXPLICIT, EDGE_COMPOUND} else 0.82,
        "review_note": review_note,
    }
    if definition:
        payload["definition"] = definition
        payload["source_excerpt"] = definition
    return payload


def ambiguous_entry(formula: FormulaRecord, target: FormulaRecord, symbol: str, evidence: str) -> dict[str, Any]:
    return {
        "dependent_id": formula.id,
        "target_id": target.id,
        "symbol": symbol,
        "edge_evidence": evidence,
        "edge_status": "ambiguous",
        "reason": "Low-confidence OCR prevents this edge from entering the accepted graph."
        if evidence == EDGE_LOW_CONFIDENCE
        else "Candidate edge needs stronger evidence.",
        "confidence": min(formula.confidence, target.confidence, 0.55),
    }


def build_symbol_index(formulas: list[FormulaRecord]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = defaultdict(list)
    for formula in formulas:
        for symbol in formula.symbols_defined_detailed:
            entry = f"{formula.id}::{symbol['symbol']}"
            index[symbol["symbol"]].append(entry)
            index[f"canonical:{symbol.get('canonical_latex') or canonical_symbol(symbol['symbol'])}"].append(entry)
    return dict(sorted(index.items()))


def prior_group_neighbors(formulas: list[FormulaRecord], formula: FormulaRecord) -> list[FormulaRecord]:
    key = formula_group_key(formula.raw_id)
    if not key:
        return []
    return [candidate for candidate in formulas if candidate.position < formula.position and formula_group_key(candidate.raw_id) == key]


def formula_group_key(raw_id: str) -> str:
    return re.sub(r"[a-z]$", "", raw_id, flags=re.IGNORECASE)


def explicit_formula_references(text: str) -> list[str]:
    refs = re.findall(r"(?:Equation|Eq\.?|Formula)\s*\(?([A]?\d+(?:\.\d+)+(?:[a-z])?)\)?", text, re.IGNORECASE)
    return list(dict.fromkeys(refs))


def find_text_definition(symbol: str, context: str) -> str | None:
    plain = symbol.replace("\\", "").replace("{", "").replace("}", "")
    escaped = re.escape(plain)
    patterns = [
        rf"\b{escaped}\b\s+(?:is|denotes|represents|means)\s+([^.;]+)",
        rf"(?:where|with)\s+\b{escaped}\b\s+(?:is|denotes|represents|means)\s+([^.;]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, context, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return None


def dedupe_prerequisites(prereqs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, Any, Any]] = set()
    items: list[dict[str, Any]] = []
    for prereq in prereqs:
        key = (prereq.get("type"), prereq.get("target_id"), prereq.get("via_symbol"))
        if key in seen:
            continue
        seen.add(key)
        items.append(prereq)
    return items


def chapter_sort_key(chapter_id: str) -> int:
    appendix = re.match(r"appendix(\d+)", chapter_id, re.IGNORECASE)
    if appendix:
        return 30 + int(appendix.group(1))
    chapter = re.match(r"chapter(\d+)", chapter_id, re.IGNORECASE)
    if chapter:
        return int(chapter.group(1))
    return 10_000


def formula_sort_key(formula: FormulaRecord) -> tuple[int, int, str]:
    match = re.match(r"formula_(?:A)?(\d+)\.(\d+)([a-z]?)", formula.id, re.IGNORECASE)
    if match:
        return formula.chapter, int(match.group(2)), match.group(3)
    return formula.chapter, formula.position, formula.id


def build_featured_formulas(formulas: list[FormulaRecord], dependencies: list[dict[str, Any]], target_count: int = 240) -> dict[str, Any]:
    incoming: dict[str, int] = defaultdict(int)
    outgoing: dict[str, int] = defaultdict(int)
    for dep in dependencies:
        dependent_id = str(dep.get("dependent_id"))
        for prereq in dep.get("prerequisites") or []:
            if prereq.get("type") == "formula" and prereq.get("target_id"):
                incoming[str(prereq["target_id"])] += 1
                outgoing[dependent_id] += 1
    ranked = sorted(
        formulas,
        key=lambda formula: (
            incoming[formula.id] * 3 + outgoing[formula.id] * 1.3 + (1 if not formula.is_low_confidence else -2),
            -formula.position,
        ),
        reverse=True,
    )
    return {
        "featured": [
            {
                "id": formula.id,
                "chapter": str(formula.chapter),
                "chapter_id": formula.chapter_id,
                "label": formula.label,
                "display_name": formula.label,
                "importance": round(incoming[formula.id] * 3 + outgoing[formula.id] * 1.3 + formula.confidence, 4),
                "latex_preview": formula.latex,
                "confidence": round(formula.confidence, 4),
                "review_flags": formula.review_flags,
            }
            for formula in ranked[: min(target_count, len(ranked))]
        ]
    }


def build_chapter_navigator(by_chapter: dict[str, list[FormulaRecord]]) -> dict[str, Any]:
    chapters = []
    for chapter_id, formulas in sorted(by_chapter.items(), key=lambda item: chapter_sort_key(item[0])):
        sorted_formulas = sorted(formulas, key=lambda item: item.position)
        roots = [formula.id for formula in sorted_formulas if formula.depth <= 0 and not formula.is_low_confidence]
        if not roots:
            roots = [formula.id for formula in sorted_formulas[: min(8, len(sorted_formulas))]]
        representative = [formula.id for formula in sorted_formulas[: min(8, len(sorted_formulas))]]
        chapter = sorted_formulas[0].chapter if sorted_formulas else chapter_sort_key(chapter_id)
        section_hint = sorted_formulas[0].section if sorted_formulas else chapter_id
        chapters.append(
            {
                "chapter": chapter,
                "chapter_id": chapter_id,
                "title_en": f"Chapter {chapter} Formula Navigator",
                "title_zh": f"Chapter {chapter} 公式导航",
                "description_en": f"{chapter_id} contains {len(sorted_formulas)} formulas generated from PaddleOCR-VL.",
                "description_zh": f"{chapter_id} 包含 {len(sorted_formulas)} 个由 PaddleOCR-VL 解析出的公式。",
                "section_hint": section_hint,
                "backbone_formula_ids": roots[:14],
                "full_formula_ids": [formula.id for formula in sorted_formulas],
                "representative_formula_ids": representative,
            }
        )
    return {
        "groups": [
            {
                "id": "formula-atlas-generated",
                "title_en": "Generated Formula Atlas",
                "title_zh": "自动生成公式图谱",
                "description_en": "Formula navigator generated from a textbook PDF.",
                "description_zh": "从教材 PDF 自动生成的公式学习导航。",
                "chapters": chapters,
            }
        ]
    }
