from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from .graph import formula_sort_key
from .io_utils import utc_now, write_json
from .models import FormulaRecord


def write_teaching_payloads(formulas: list[FormulaRecord], dependency_dir: Path, output_dir: Path) -> dict[str, Any]:
    by_chapter: dict[str, list[FormulaRecord]] = defaultdict(list)
    for formula in formulas:
        by_chapter[formula.chapter_id].append(formula)

    concept_dir = output_dir / "concept_graph"
    total_views = 0
    for chapter_id, chapter_formulas in sorted(by_chapter.items()):
        dependency_payload = _read_dependency_payload(dependency_dir / f"{chapter_id}_dependencies.json")
        payload = build_concept_graph(chapter_id, sorted(chapter_formulas, key=lambda item: item.position), dependency_payload)
        total_views += len(payload["views"])
        write_json(concept_dir / f"{chapter_id}_concept_graph.json", payload)
    write_json(concept_dir / "concept_graph_index.json", build_concept_index(by_chapter))
    write_json(output_dir / "formula_learning_copy.json", build_learning_copy(formulas))
    write_json(output_dir / "storylines.json", build_storylines(formulas))
    write_json(output_dir / "llm_cache.json", {"version": 1, "generated_at": utc_now(), "items": {}, "source": "formula_atlas_pipeline_placeholder"})
    return {"concept_view_count": total_views}


def build_concept_graph(chapter_id: str, formulas: list[FormulaRecord], dependency_payload: dict[str, Any]) -> dict[str, Any]:
    dependencies = {item["dependent_id"]: item for item in dependency_payload.get("dependencies") or []}
    concepts_by_formula: dict[str, dict[str, Any]] = {}
    symbol_concepts: list[dict[str, Any]] = []
    views: list[dict[str, Any]] = []

    for formula in formulas:
        defined = formula.symbols_defined[:1] or formula.symbols_used[:1] or [formula.raw_id]
        focus_symbol = defined[0]
        concept_id = concept_id_for(formula, focus_symbol, "defined")
        confidence = min(formula.confidence, 0.9 if formula.review_flags else 0.84)
        review_flags = list(formula.review_flags)
        if formula.is_low_confidence and "low_confidence_concept" not in review_flags:
            review_flags.append("low_confidence_concept")
        concept = {
            "chapter_id": chapter_id,
            "formula_id": formula.id,
            "formula_label": formula.label,
            "symbol": focus_symbol,
            "role": "defined",
            "concept_id": concept_id,
            "concept_name": concept_name_for(focus_symbol, formula),
            "concept_type": "formula_concept",
            "definition": definition_for(focus_symbol, formula),
            "definition_zh": f"{formula.label} 中由 {focus_symbol} 表示的核心量或关系。",
            "aliases": [focus_symbol, formula.label],
            "evidence": [evidence_for(formula)],
            "confidence": round(confidence, 4),
            "review_status": "unreviewed",
            "review_flags": review_flags,
            "extraction_model": "formula_atlas_pipeline_rule_fallback_v1",
        }
        concepts_by_formula[formula.id] = concept
        symbol_concepts.append(concept)

    for formula in formulas:
        focus = concepts_by_formula[formula.id]
        dependency = dependencies.get(formula.id) or {"prerequisites": []}
        prerequisites = []
        edges = []
        for prereq in dependency.get("prerequisites") or []:
            target_id = prereq.get("target_id")
            target_concept = concepts_by_formula.get(str(target_id)) if target_id else None
            if not target_concept:
                continue
            ref = concept_reference(target_concept, prereq)
            prerequisites.append(ref)
            edges.append(
                {
                    "from": target_concept["concept_id"],
                    "to": focus["concept_id"],
                    "relation": "prerequisite_for",
                    "clickable": True,
                    "confidence": prereq.get("confidence", 0.75),
                    "symbol": prereq.get("via_symbol"),
                    "derived_from_formula_edge": {
                        "from": target_id,
                        "to": formula.id,
                        "via_symbol": prereq.get("via_symbol"),
                    },
                }
            )

        introduced = [
            {
                "concept_id": concept_id_for(formula, symbol, "used"),
                "name": concept_name_for(symbol, formula),
                "symbol": symbol,
                "defined_by_formula_id": None,
                "formula_label": formula.label,
                "clickable": False,
                "confidence": round(max(0.35, formula.confidence - 0.08), 4),
                "concept_type": "symbol_context",
                "definition": definition_for(symbol, formula),
                "definition_zh": f"{symbol} 是 {formula.label} 上下文中的符号。",
                "review_flags": ["low_confidence_concept"] if formula.is_low_confidence else [],
            }
            for symbol in formula.symbols_used[:6]
            if symbol != focus["symbol"]
        ]
        for item in introduced:
            edges.append(
                {
                    "from": item["concept_id"],
                    "to": focus["concept_id"],
                    "relation": "introduced_for",
                    "symbol": item.get("symbol"),
                    "clickable": False,
                    "confidence": item["confidence"],
                }
            )
        views.append(
            {
                "chapter_id": chapter_id,
                "concept_id": focus["concept_id"],
                "name": focus["concept_name"],
                "definition": focus["definition"],
                "definition_zh": focus.get("definition_zh"),
                "concept_type": focus["concept_type"],
                "defined_by_formula_id": formula.id,
                "defined_symbol": focus["symbol"],
                "supporting_formula_label": formula.label,
                "supporting_formula_latex": formula.latex,
                "formula_position": formula.position,
                "formula_section": formula.section,
                "formula_subsection": formula.subsection,
                "evidence": focus["evidence"],
                "confidence": focus["confidence"],
                "review_status": focus["review_status"],
                "review_flags": focus["review_flags"],
                "prerequisite_concepts": prerequisites,
                "introduced_concepts": introduced,
                "edges": edges,
            }
        )

    return {
        "chapter_id": chapter_id,
        "version": 1,
        "generated_at": utc_now(),
        "source": {
            "formula_dependency_graph": f"data/frontend/dependency/{chapter_id}_dependencies.json",
            "symbol_sense_prompts": "",
            "method": "rule fallback concept views from PaddleOCR-VL formulas and conservative dependencies",
        },
        "summary": {
            "chapter_id": chapter_id,
            "formulas_processed": len(formulas),
            "symbol_concept_entries": len(symbol_concepts),
            "unique_concepts": len({item["concept_id"] for item in symbol_concepts}),
            "concept_views": len(views),
            "prerequisite_edges": sum(len(view["prerequisite_concepts"]) for view in views),
            "introduced_edges": sum(len(view["introduced_concepts"]) for view in views),
            "low_confidence_entries": sum(1 for item in symbol_concepts if item["review_flags"]),
            "formula_edges_used": sum(len(view["prerequisite_concepts"]) for view in views),
        },
        "symbol_concepts": symbol_concepts,
        "views": views,
    }


def build_learning_copy(formulas: list[FormulaRecord]) -> dict[str, Any]:
    items = {}
    for formula in formulas:
        flags = " ".join(formula.review_flags)
        items[formula.id] = {
            "en": {
                "plainMeaning": f"{formula.label} states a relationship among {', '.join(formula.symbols_used[:4]) or 'the chapter variables'}.",
                "inThisChapter": f"It appears in {formula.section} and anchors the local formula graph.",
            },
            "zh": {
                "plainMeaning": f"{formula.label} 描述了 {', '.join(formula.symbols_used[:4]) or '本章变量'} 之间的关系。",
                "inThisChapter": f"它出现在 {formula.section}，用于支撑本章局部公式图。",
            },
            "source_context_hash": "",
            "model": "formula_atlas_pipeline_rule_fallback_v1",
            "confidence": round(formula.confidence, 4),
            "review_flags": formula.review_flags if flags else [],
        }
    return {
        "version": 1,
        "generated_at": utc_now(),
        "source": "formula_atlas_pipeline_rule_fallback_v1",
        "items": items,
    }


def build_storylines(formulas: list[FormulaRecord]) -> dict[str, Any]:
    by_symbol: dict[str, list[FormulaRecord]] = defaultdict(list)
    for formula in formulas:
        if formula.is_low_confidence:
            continue
        for symbol in formula.symbols_used[:6]:
            by_symbol[symbol].append(formula)
    items = []
    for symbol, symbol_formulas in sorted(by_symbol.items(), key=lambda item: len(item[1]), reverse=True):
        unique = sorted({formula.id: formula for formula in symbol_formulas}.values(), key=formula_sort_key)
        if len(unique) < 2:
            continue
        steps = []
        previous = None
        for formula in unique[:8]:
            steps.append(
                {
                    "formula_id": formula.id,
                    "title": formula.label,
                    "transition_en": f"{symbol} continues through {formula.label} as the chapter develops the idea.",
                    "transition_zh": f"{symbol} 在 {formula.label} 中继续出现，连接这一主题的后续推导。",
                    "support_formula_ids": [previous.id] if previous else [],
                }
            )
            previous = formula
        safe_id = "".join(ch.lower() if ch.isalnum() else "-" for ch in symbol).strip("-") or f"storyline-{len(items)+1}"
        items.append(
            {
                "id": f"generated-{safe_id}",
                "title_en": f"Trajectory of {symbol}",
                "title_zh": f"{symbol} 的公式轨迹",
                "symbol": symbol,
                "intro_en": f"Follow how {symbol} appears across related formulas.",
                "intro_zh": f"追踪 {symbol} 如何贯穿相关公式。",
                "backbone_en": "formula context -> reused symbol -> later relation",
                "backbone_zh": "公式语境 -> 符号复用 -> 后续关系",
                "entity_keys": [symbol],
                "steps": steps,
            }
        )
        if len(items) >= 8:
            break
    return {"version": 1, "items": items}


def build_concept_index(by_chapter: dict[str, list[FormulaRecord]]) -> dict[str, Any]:
    items = []
    for chapter_id, formulas in sorted(by_chapter.items()):
        for formula in formulas:
            symbol = (formula.symbols_defined or formula.symbols_used or [formula.raw_id])[0]
            items.append(
                {
                    "concept_id": concept_id_for(formula, symbol, "defined"),
                    "name": concept_name_for(symbol, formula),
                    "chapter_id": chapter_id,
                    "formula_id": formula.id,
                    "formula_label": formula.label,
                    "symbol": symbol,
                    "definition": definition_for(symbol, formula),
                    "confidence": round(formula.confidence, 4),
                    "review_flags": formula.review_flags,
                }
            )
    return {"version": 1, "generated_at": utc_now(), "items": items}


def concept_id_for(formula: FormulaRecord, symbol: str, role: str) -> str:
    safe = "".join(ch.lower() if ch.isalnum() else "_" for ch in symbol).strip("_") or "symbol"
    return f"concept_{formula.chapter_id}_{formula.id.replace('.', '_')}_{role}_{safe}"


def concept_name_for(symbol: str, formula: FormulaRecord) -> str:
    clean = symbol.replace("\\", "").replace("{", "").replace("}", "")
    return f"{clean} in {formula.label}"


def definition_for(symbol: str, formula: FormulaRecord) -> str:
    context = formula.context_text.strip()
    if context:
        return f"{symbol} as used near {formula.label}: {context[:180]}"
    return f"{symbol} as used in {formula.label}."


def evidence_for(formula: FormulaRecord) -> dict[str, Any]:
    return {
        "chunk_id": formula.source_trace.ocr_block_id,
        "block_index": formula.position,
        "block_type": "formula",
        "sentence": formula.context_text[:220],
    }


def concept_reference(target_concept: dict[str, Any], prereq: dict[str, Any]) -> dict[str, Any]:
    return {
        "concept_id": target_concept["concept_id"],
        "name": target_concept["concept_name"],
        "symbol": target_concept["symbol"],
        "defined_by_formula_id": target_concept["formula_id"],
        "formula_label": target_concept["formula_label"],
        "via_symbol": prereq.get("via_symbol"),
        "clickable": True,
        "confidence": prereq.get("confidence", target_concept["confidence"]),
        "relation": prereq.get("relation"),
        "concept_type": target_concept.get("concept_type"),
        "definition": target_concept.get("definition"),
        "definition_zh": target_concept.get("definition_zh"),
        "review_flags": target_concept.get("review_flags") or [],
    }


def _read_dependency_payload(path: Path) -> dict[str, Any]:
    import json

    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)
