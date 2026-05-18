"""Build LitGraph-RAG frontend dependency data from structured JSON."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
from typing import Any

from symbol_extraction import extract_symbols, family_key, find_recent_definition


LOGGER = logging.getLogger("litgraph.pipeline")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STRUCTURED_DIR = PROJECT_ROOT / "data" / "structured"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "frontend"

FORMULA_REF_RE = re.compile(r"\[\[(?:SEE_)?FORMULA:([0-9]+(?:\.[0-9]+)?[a-z]?)\]\]")
EQUATION_REF_RE = re.compile(
    r"\bEquations?\s+([0-9]+(?:\.[0-9]+)?[a-z]?)(?:\s*(?:,|and|through|to|-|–)\s*([0-9]+(?:\.[0-9]+)?[a-z]?))?",
    re.IGNORECASE,
)
CHAPTER_RE = re.compile(r"chapter(\d+)", re.IGNORECASE)
STOPLIST = {
    "n",
    "N",
    "m",
    "s",
    "t",
    "p",
    "q",
    "r",
    "k",
    "x",
    "y",
    "z",
    "w",
    "u",
    "v",
    "f",
    "g",
    "h",
    "\\alpha",
    "\\beta",
    "\\gamma",
    "\\delta",
    "\\epsilon",
    "\\lambda",
    "\\mu",
    "\\tau",
    "\\omega",
    "i",
    "j",
    "l",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def formula_public_id(raw_id: str) -> str:
    raw = str(raw_id).strip()
    return raw if raw.startswith("formula_") else f"formula_{raw}"


def raw_formula_id(public_id: str) -> str:
    return str(public_id).removeprefix("formula_")


def chapter_sort_key(chapter_id: str) -> int:
    match = CHAPTER_RE.search(chapter_id)
    return int(match.group(1)) if match else 10_000


def formula_sort_key(formula_id: str) -> tuple[int, int, str]:
    raw = raw_formula_id(formula_id)
    match = re.match(r"(\d+)\.(\d+)([a-z]?)", raw)
    if match:
        return int(match.group(1)), int(match.group(2)), match.group(3)
    return 10_000, 10_000, raw


def load_formula_library(structured_dir: Path) -> dict[str, dict[str, Any]]:
    path = structured_dir / "formula_library.json"
    payload = read_json(path)
    formulas = payload.get("formulas", [])
    by_id: dict[str, dict[str, Any]] = {}
    for item in formulas:
        raw_id = str(item.get("id", "")).strip()
        if not raw_id:
            continue
        source = item.get("source") or {}
        chapter_id = str(source.get("chapter") or f"chapter{raw_id.split('.')[0]}")
        public_id = formula_public_id(raw_id)
        by_id[raw_id] = {
            "id": public_id,
            "raw_id": raw_id,
            "latex": item.get("latex") or "",
            "label": item.get("label") or f"Formula {raw_id}",
            "label_format": item.get("label_format"),
            "chapter_id": chapter_id,
            "chapter": chapter_sort_key(chapter_id),
            "section": source.get("subsection") or "",
            "subsection": source.get("subsection") or "",
            "source_unit_id": source.get("unit_id"),
            "context_text": item.get("context") or item.get("description") or "",
            "description": item.get("description"),
        }
    LOGGER.info("Loaded %s formulas from %s", len(by_id), path)
    return by_id


def find_structured_files(structured_dir: Path, chapter_filter: str | None = None) -> list[Path]:
    pattern = f"{chapter_filter}_*.json" if chapter_filter else "chapter*_*.json"
    return sorted(structured_dir.glob(pattern), key=lambda path: natural_path_key(path.name))


def natural_path_key(name: str) -> tuple[Any, ...]:
    parts = re.split(r"(\d+)", name)
    return tuple(int(p) if p.isdigit() else p for p in parts)


def load_chapter_blocks(structured_dir: Path, chapter_filter: str | None = None) -> dict[str, list[dict[str, Any]]]:
    chapters: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for path in find_structured_files(structured_dir, chapter_filter):
        try:
            payload = read_json(path)
        except Exception as exc:
            LOGGER.error("Failed to load %s: %s", path, exc)
            continue
        chapter_id = (payload.get("metadata") or {}).get("chapter")
        if not chapter_id:
            match = re.match(r"(chapter\d+)_", path.name)
            chapter_id = match.group(1) if match else "chapter0"
        chapters[str(chapter_id)].append({"path": path, "payload": payload})
    LOGGER.info("Loaded structured blocks for %s chapters", len(chapters))
    return dict(chapters)


def extract_formula_positions(chapter_docs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    positions: dict[str, dict[str, Any]] = {}
    order = 0
    for doc in chapter_docs:
        payload = doc["payload"]
        path = doc["path"]
        metadata = payload.get("metadata") or {}
        heading = metadata.get("heading_path") or []
        section = metadata.get("section_level_1") or metadata.get("section") or metadata.get("display_heading") or ""
        subsection = metadata.get("section_level_2") or metadata.get("display_heading") or section
        refs: list[str] = []
        for ref in metadata.get("formula_references") or []:
            refs.append(str(ref))
        for block_index, block in enumerate(payload.get("blocks") or []):
            content = str(block.get("content") or "")
            refs.extend(FORMULA_REF_RE.findall(content))
            for match in EQUATION_REF_RE.finditer(content):
                refs.append(match.group(1))
                if match.group(2):
                    refs.append(match.group(2))
            for ref in refs_from_plain_equation_mentions(content):
                refs.append(ref)
            for ref in refs:
                if ref not in positions:
                    positions[ref] = {
                        "position": order,
                        "section": section,
                        "subsection": subsection,
                        "heading_path": heading,
                        "source_chunk_id": payload.get("id") or path.stem,
                        "source_file": path.name,
                        "block_index": block_index,
                    }
                    order += 1
            refs = []
    return positions


def refs_from_plain_equation_mentions(content: str) -> list[str]:
    refs: list[str] = []
    for match in re.finditer(r"\(([0-9]+\.[0-9]+[a-z]?)\)", content):
        refs.append(match.group(1))
    return refs


def extract_explicit_formula_refs(text: str) -> set[str]:
    refs = set(FORMULA_REF_RE.findall(text or ""))
    for match in EQUATION_REF_RE.finditer(text or ""):
        refs.add(match.group(1))
        if match.group(2):
            refs.add(match.group(2))
    return refs


def build_chapter_formula_list(
    chapter_id: str,
    formulas_by_id: dict[str, dict[str, Any]],
    chapter_docs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    positions = extract_formula_positions(chapter_docs)
    formulas = [dict(item) for item in formulas_by_id.values() if item["chapter_id"] == chapter_id]
    for idx, formula in enumerate(sorted(formulas, key=lambda f: formula_sort_key(f["id"]))):
        raw_id = formula["raw_id"]
        pos_info = positions.get(raw_id, {})
        formula["position"] = int(pos_info.get("position", idx))
        formula["section"] = pos_info.get("section") or formula.get("section") or ""
        formula["subsection"] = pos_info.get("subsection") or formula.get("subsection") or ""
        formula["heading_path"] = pos_info.get("heading_path") or []
        formula["source_chunk_id"] = pos_info.get("source_chunk_id") or formula.get("source_unit_id")
        try:
            extracted = extract_symbols(formula["latex"])
            formula["symbols_used_detailed"] = extracted["symbols_used"]
            formula["symbols_defined_detailed"] = extracted["symbols_defined"]
            formula["symbols_used"] = [s["symbol"] for s in extracted["symbols_used"]]
            formula["symbols_defined"] = [s["symbol"] for s in extracted["symbols_defined"]]
        except Exception as exc:
            LOGGER.error("Symbol extraction failed for %s: %s", formula["id"], exc)
            formula["symbols_used_detailed"] = []
            formula["symbols_defined_detailed"] = []
            formula["symbols_used"] = []
            formula["symbols_defined"] = []
    return sorted(formulas, key=lambda f: (int(f["position"]), formula_sort_key(f["id"])))


def register_formula_senses(formulas: list[dict[str, Any]]) -> tuple[dict[str, list[str]], dict[str, dict[str, Any]]]:
    symbol_index: dict[str, list[str]] = {}
    senses: dict[str, dict[str, Any]] = {}
    for formula in formulas:
        for symbol in formula.get("symbols_defined_detailed", []):
            sense_id = f"{formula['id']}::{symbol['symbol']}"
            sense = {
                "sense_id": sense_id,
                "symbol": symbol["symbol"],
                "family_key": symbol.get("family_key") or family_key(symbol["symbol"]),
                "formula_id": formula["id"],
                "raw_formula_id": formula["raw_id"],
                "chapter_id": formula["chapter_id"],
                "chapter": formula["chapter"],
                "position": formula["position"],
                "source_chunk_id": formula.get("source_chunk_id"),
                "confidence": 0.86,
            }
            senses[sense_id] = sense
            add_index(symbol_index, symbol["symbol"], sense_id)
            add_index(symbol_index, f"family:{sense['family_key']}", sense_id)
    return symbol_index, senses


def add_index(index: dict[str, list[str]], key: str, value: str) -> None:
    bucket = index.setdefault(key, [])
    if value not in bucket:
        bucket.append(value)


def build_global_symbol_index(chapter_senses: dict[str, dict[str, dict[str, Any]]]) -> tuple[dict[str, list[str]], dict[str, dict[str, Any]]]:
    global_index: dict[str, list[str]] = {}
    global_senses: dict[str, dict[str, Any]] = {}
    for senses in chapter_senses.values():
        for sense_id, sense in senses.items():
            global_senses[sense_id] = sense
            add_index(global_index, sense["symbol"], sense_id)
            add_index(global_index, f"family:{sense['family_key']}", sense_id)
    return global_index, global_senses


def find_cross_chapter_definitions(
    symbol: dict[str, str],
    dependent: dict[str, Any],
    global_index: dict[str, list[str]],
    global_senses: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    current_chapter = int(dependent["chapter"])
    matches: list[tuple[int, dict[str, Any], str]] = []
    exact_ids = global_index.get(symbol["symbol"], [])
    for sense_id in exact_ids:
        sense = global_senses.get(sense_id)
        if not sense:
            continue
        chapter = int(sense.get("chapter", 0))
        if chapter and chapter < current_chapter:
            matches.append((chapter, sense, "exact"))

    fk = symbol.get("family_key") or family_key(symbol["symbol"])
    if fk not in STOPLIST and symbol["symbol"] not in STOPLIST:
        for sense_id in global_index.get(f"family:{fk}", []):
            sense = global_senses.get(sense_id)
            if not sense:
                continue
            chapter = int(sense.get("chapter", 0))
            if chapter and chapter < current_chapter and sense["symbol"] != symbol["symbol"]:
                matches.append((chapter, sense, "family"))

    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for _, sense, match_type in sorted(matches, key=lambda item: (-item[0], item[1].get("position", 0))):
        target = sense.get("formula_id")
        if not target or target in seen:
            continue
        seen.add(target)
        via = symbol["symbol"]
        reason = f"{via} matched earlier chapter definition"
        confidence = 0.78
        if match_type == "family":
            via = f"(via family: {symbol['symbol']}→{sense['symbol']})"
            reason = f"{symbol['symbol']} matched earlier chapter symbol family {sense['family_key']}"
            confidence = 0.62
        results.append(
            {
                "type": "formula",
                "target_id": target,
                "via_symbol": via,
                "relation": "defines_symbol",
                "reason": reason,
                "confidence": confidence,
                "cross_chapter": True,
                "match_type": match_type,
            }
        )
    return results[:4]


def build_dependencies_for_chapter(
    chapter_id: str,
    formulas: list[dict[str, Any]],
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    global_index: dict[str, list[str]],
    global_senses: dict[str, dict[str, Any]],
    formulas_by_raw_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    dependencies: list[dict[str, Any]] = []
    formulas_by_public = {formula["id"]: formula for formula in formulas}
    explicit_refs_by_formula = {
        formula["id"]: extract_explicit_formula_refs(formula.get("context_text", "")) for formula in formulas
    }

    for formula in formulas:
        prereqs: list[dict[str, Any]] = []
        seen_targets: set[tuple[str, str]] = set()

        for raw_ref in sorted(explicit_refs_by_formula[formula["id"]], key=formula_sort_key):
            target = formulas_by_raw_id.get(raw_ref)
            if not target:
                continue
            target_id = target["id"]
            if target_id == formula["id"]:
                continue
            if formula_sort_key(target_id) >= formula_sort_key(formula["id"]) and target["chapter_id"] == chapter_id:
                continue
            key = ("formula", target_id)
            if key in seen_targets:
                continue
            seen_targets.add(key)
            prereqs.append(
                {
                    "type": "formula",
                    "target_id": target_id,
                    "via_symbol": f"Equation {raw_ref}",
                    "relation": "explicit_reference",
                    "reason": f"Context explicitly references Equation {raw_ref}",
                    "confidence": 0.95,
                    "cross_chapter": target["chapter_id"] != chapter_id,
                }
            )

        for symbol in formula.get("symbols_used_detailed", []):
            if symbol["symbol"] in set(formula.get("symbols_defined", [])):
                continue
            sense = find_recent_definition(symbol, formula["position"], symbol_index, senses, chapter_id)
            if sense and sense.get("formula_id") in formulas_by_public:
                target_id = sense["formula_id"]
                if target_id != formula["id"]:
                    key = ("formula", target_id)
                    if key not in seen_targets:
                        seen_targets.add(key)
                        prereqs.append(
                            {
                                "type": "formula",
                                "target_id": target_id,
                                "via_symbol": symbol["symbol"],
                                "relation": "defines_symbol",
                                "reason": f"{symbol['symbol']} defined by nearest upstream formula in {chapter_id}",
                                "confidence": 0.84,
                                "cross_chapter": False,
                            }
                        )
                continue

            for cross in find_cross_chapter_definitions(symbol, formula, global_index, global_senses):
                key = ("formula", cross["target_id"])
                if key in seen_targets:
                    continue
                seen_targets.add(key)
                prereqs.append(cross)

            if not any(p.get("via_symbol") == symbol["symbol"] for p in prereqs):
                key = ("variable_definition", symbol["symbol"])
                if key not in seen_targets and symbol["symbol"] not in STOPLIST:
                    seen_targets.add(key)
                    prereqs.append(
                        {
                            "type": "variable_definition",
                            "symbol": symbol["symbol"],
                            "definition": f"Local variable used near {formula['label']}",
                            "source": "nearby_text",
                            "source_chunk_id": formula.get("source_chunk_id"),
                            "confidence": 0.45,
                        }
                    )

        dependencies.append({"dependent_id": formula["id"], "prerequisites": prereqs})
    return dependencies


def serializable_formula(formula: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": formula["id"],
        "latex": formula.get("latex", ""),
        "label": formula.get("label", f"Formula {formula['raw_id']}"),
        "section": formula.get("section", ""),
        "subsection": formula.get("subsection", ""),
        "position": formula.get("position", 0),
        "context_text": formula.get("context_text", ""),
        "symbols_used": formula.get("symbols_used", []),
        "symbols_defined": formula.get("symbols_defined", []),
    }


def build_chapter_dependency(
    chapter_id: str,
    formulas: list[dict[str, Any]],
    dependencies: list[dict[str, Any]],
    symbol_index: dict[str, list[str]],
    generated_at: str,
) -> dict[str, Any]:
    public_symbol_index = {key: value for key, value in symbol_index.items() if not key.startswith("family:")}
    return {
        "chapter_id": chapter_id,
        "version": 1,
        "generated_at": generated_at,
        "formulas": [serializable_formula(formula) for formula in formulas],
        "dependencies": dependencies,
        "symbol_index": public_symbol_index,
        "ambiguous": [],
    }


def build_featured_formulas(all_formulas: list[dict[str, Any]], all_dependencies: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    incoming = Counter()
    outgoing = Counter()
    for dep in all_dependencies:
        dependent = dep["dependent_id"]
        outgoing[dependent] += len(dep.get("prerequisites") or [])
        for prereq in dep.get("prerequisites") or []:
            if prereq.get("type") == "formula":
                incoming[prereq["target_id"]] += 1

    by_chapter: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for formula in all_formulas:
        score = incoming[formula["id"]] * 2 + outgoing[formula["id"]] + max(0, 1200 - len(formula.get("latex", ""))) / 1200
        item = {
            "id": formula["id"],
            "chapter": str(formula["chapter"]),
            "label": formula.get("label", f"Formula {formula['raw_id']}"),
            "display_name": display_name(formula),
            "importance": round(float(score), 4),
            "latex_preview": formula.get("latex", ""),
        }
        by_chapter[formula["chapter_id"]].append(item)

    featured: list[dict[str, Any]] = []
    for chapter_id in sorted(by_chapter, key=chapter_sort_key):
        items = sorted(by_chapter[chapter_id], key=lambda item: item["importance"], reverse=True)
        featured.extend(items[:4])
    if len(featured) < 80:
        used = {item["id"] for item in featured}
        candidates = [
            {
                "id": formula["id"],
                "chapter": str(formula["chapter"]),
                "label": formula.get("label", f"Formula {formula['raw_id']}"),
                "display_name": display_name(formula),
                "importance": round(float(incoming[formula["id"]] * 2 + outgoing[formula["id"]]), 4),
                "latex_preview": formula.get("latex", ""),
            }
            for formula in all_formulas
            if formula["id"] not in used
        ]
        featured.extend(sorted(candidates, key=lambda item: item["importance"], reverse=True)[: 80 - len(featured)])
    return {"featured": sorted(featured, key=lambda item: (int(item["chapter"]), -item["importance"]))[:120]}


def display_name(formula: dict[str, Any]) -> str:
    raw = formula.get("raw_id", raw_formula_id(formula["id"]))
    context = formula.get("context_text") or ""
    for keyword in ("HKA", "MK", "Price", "Wright", "Fisher", "Robertson", "breeder", "selection"):
        if keyword.lower() in context.lower():
            return f"{keyword} {raw}"
    return f"Formula {raw}"


def build_search_index(all_formulas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []
    for formula in sorted(all_formulas, key=lambda item: formula_sort_key(item["id"])):
        context = formula.get("context_text", "")
        index.append(
            {
                "id": formula["id"],
                "number": formula["raw_id"],
                "chapter": formula["chapter"],
                "section": formula.get("section", ""),
                "label": formula.get("label", f"Formula {formula['raw_id']}"),
                "latex_preview": formula.get("latex", "")[:500],
                "context": context[:800],
                "keywords": keywords_for_formula(formula),
            }
        )
    return index


def keywords_for_formula(formula: dict[str, Any]) -> list[str]:
    text = f"{formula.get('label', '')} {formula.get('section', '')} {formula.get('context_text', '')}"
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text)
    common = {
        "the",
        "and",
        "for",
        "that",
        "with",
        "from",
        "this",
        "where",
        "equation",
        "formula",
        "chapter",
    }
    seen: set[str] = set()
    result: list[str] = []
    for word in words:
        key = word.lower()
        if key in common or key in seen:
            continue
        seen.add(key)
        result.append(word)
        if len(result) >= 16:
            break
    return result


def build_learning_paths(all_formulas: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    available = {formula["raw_id"]: formula["id"] for formula in all_formulas}
    seeds = [
        ("population-genetics-foundations", "群体遗传学基础", ["2.1", "2.2a", "2.3", "3.1", "3.5"]),
        ("selection-detection", "选择检测方法", ["9.21a", "10.1a", "10.2a", "10.5a", "10.6a"]),
        ("quantitative-traits", "数量性状建模", ["4.1", "6.6", "6.10", "13.1", "26.1a"]),
        ("molecular-evolution", "分子进化", ["3.1", "4.3a", "8.1", "9.1", "10.1a"]),
    ]
    paths: list[dict[str, Any]] = []
    for path_id, title, raw_ids in seeds:
        formula_ids = [available[raw] for raw in raw_ids if raw in available]
        if not formula_ids:
            continue
        paths.append(
            {
                "id": path_id,
                "title": title,
                "description": "Curated formula sequence for guided exploration.",
                "formula_ids": formula_ids,
            }
        )
    return {"paths": paths}


def run_pipeline(structured_dir: Path, output_dir: Path, chapter_filter: str | None = None) -> dict[str, Any]:
    generated_at = utc_now()
    formulas_by_raw_id = load_formula_library(structured_dir)
    chapter_docs = load_chapter_blocks(structured_dir, chapter_filter)
    if chapter_filter:
        chapter_docs = {chapter_filter: chapter_docs.get(chapter_filter, [])}

    chapter_formulas: dict[str, list[dict[str, Any]]] = {}
    chapter_symbol_indexes: dict[str, dict[str, list[str]]] = {}
    chapter_senses: dict[str, dict[str, dict[str, Any]]] = {}
    for chapter_id in sorted(chapter_docs, key=chapter_sort_key):
        formulas = build_chapter_formula_list(chapter_id, formulas_by_raw_id, chapter_docs.get(chapter_id, []))
        if not formulas:
            continue
        symbol_index, senses = register_formula_senses(formulas)
        chapter_formulas[chapter_id] = formulas
        chapter_symbol_indexes[chapter_id] = symbol_index
        chapter_senses[chapter_id] = senses
        LOGGER.info("%s: prepared %s formulas, %s symbol senses", chapter_id, len(formulas), len(senses))

    global_index, global_senses = build_global_symbol_index(chapter_senses)
    all_formulas: list[dict[str, Any]] = []
    all_dependencies: list[dict[str, Any]] = []
    dependency_dir = output_dir / "dependency"
    for chapter_id in sorted(chapter_formulas, key=chapter_sort_key):
        try:
            dependencies = build_dependencies_for_chapter(
                chapter_id,
                chapter_formulas[chapter_id],
                chapter_symbol_indexes[chapter_id],
                chapter_senses[chapter_id],
                global_index,
                global_senses,
                formulas_by_raw_id,
            )
            payload = build_chapter_dependency(
                chapter_id,
                chapter_formulas[chapter_id],
                dependencies,
                chapter_symbol_indexes[chapter_id],
                generated_at,
            )
            write_json(dependency_dir / f"{chapter_id}_dependencies.json", payload)
            all_formulas.extend(chapter_formulas[chapter_id])
            all_dependencies.extend(dependencies)
            edge_count = sum(len(dep.get("prerequisites") or []) for dep in dependencies)
            LOGGER.info("%s: wrote %s formulas and %s prerequisite entries", chapter_id, len(chapter_formulas[chapter_id]), edge_count)
        except Exception as exc:
            LOGGER.error("Failed to build %s: %s", chapter_id, exc, exc_info=True)

    write_json(output_dir / "featured_formulas.json", build_featured_formulas(all_formulas, all_dependencies))
    write_json(output_dir / "formula_search_index.json", build_search_index(all_formulas))
    write_json(output_dir / "learning_paths.json", build_learning_paths(all_formulas))

    return {
        "chapters": len(chapter_formulas),
        "formulas": len(all_formulas),
        "dependencies": len(all_dependencies),
        "output_dir": str(output_dir),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--structured-dir", type=Path, default=DEFAULT_STRUCTURED_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--chapter", help="Optional chapter filter, e.g. chapter6")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level.upper()), format="%(levelname)s %(message)s")
    summary = run_pipeline(args.structured_dir, args.output_dir, args.chapter)
    LOGGER.info("Pipeline complete: %s", summary)


if __name__ == "__main__":
    main()
