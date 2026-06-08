"""Build Formula Atlas frontend dependency data from structured JSON."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
from typing import Any

from symbol_extraction import extract_symbols, family_key, find_recent_definition, is_atomic_symbol
from select_featured import build_featured_formulas


LOGGER = logging.getLogger("litgraph.pipeline")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STRUCTURED_DIR = PROJECT_ROOT / "data" / "structured"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "frontend"

# Structured docs mark explicit formula references as [[FORMULA:2.1]] or
# [[SEE_FORMULA:2.1]]. Keep the capture group stable for downstream matchers.
FORMULA_REF_PATTERN = r"\[\[(?:SEE_)?FORMULA:([0-9]+(?:\.[0-9]+)?[a-z]?)\]\]"
FORMULA_REF_RE = re.compile(FORMULA_REF_PATTERN)
EQUATION_REF_RE = re.compile(
    r"\bEquations?\s+([0-9]+(?:\.[0-9]+)?[a-z]?)(?:\s*(?:,|and|through|to|-|–)\s*([0-9]+(?:\.[0-9]+)?[a-z]?))?",
    re.IGNORECASE,
)
CHAPTER_RE = re.compile(r"chapter(\d+)", re.IGNORECASE)
APPENDIX_RE = re.compile(r"appendix(\d+)", re.IGNORECASE)
APPENDIX_FORMULA_RE = re.compile(r"^A(\d+)\.(\d+)([a-z]?)$", re.IGNORECASE)
DISPLAY_EQUATION_RE = re.compile(r"\$\$\s*(.*?)\s*\$\$", re.DOTALL)
MAX_CROSS_CHAPTER_SYMBOL_PREREQS = 5
MAX_VARIABLE_DEFINITION_PREREQS = 3
AMBIGUOUS_CANDIDATE_THRESHOLD = 3
NON_TEACHING_SYMBOLS = {"\\pi", "\\infty"}
OPERATORS = {"E", "P", "Pr", "Var", "Cov", "\\Pr", "\\Var", "\\Cov", "\\E"}
FUNCTION_STYLE_MACROS = {"bar", "overline", "hat", "widehat", "tilde", "widetilde", "dot", "vec"}
EDGE_EXACT = "exact_match"
EDGE_CANONICAL = "canonical_match"
EDGE_EXPLICIT = "explicit_reference"
EDGE_COMPOUND = "compound_group"
EDGE_TEXT = "text_definition"
EDGE_LLM = "llm_reasoned"
EDGE_FAMILY = "family_candidate"
EDGE_ACCEPTED = "accepted"
EDGE_CANDIDATE = "candidate"
EDGE_AMBIGUOUS = "ambiguous"
EDGE_REJECTED = "rejected"
STRICT_GRAPH_EDGE_STATUSES = {EDGE_ACCEPTED}
STOPLIST = {
    "A",
    "a",
    "b",
    "c",
    "C",
    "D",
    "E",
    "K",
    "L",
    "P",
    "R",
    "r",
    "S",
    "V",
    "W",
    "X",
    "Y",
    "Z",
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


def canonical_symbol_key(symbol: str) -> str:
    value = str(symbol).strip().replace(" ", "")
    value = value.replace("\\widehat", "\\hat").replace("\\widetilde", "\\tilde")
    value = value.replace("\\bar", "\\overline")
    return value


def symbol_exact_key(symbol: str) -> str:
    return canonical_symbol_key(symbol)


def chapter_sort_key(chapter_id: str) -> int:
    match = CHAPTER_RE.search(chapter_id)
    if match:
        return int(match.group(1))
    appendix_match = APPENDIX_RE.search(chapter_id)
    if appendix_match:
        return 30 + int(appendix_match.group(1))
    return 10_000


def formula_sort_key(formula_id: str) -> tuple[int, int, str]:
    raw = raw_formula_id(formula_id)
    appendix_match = APPENDIX_FORMULA_RE.match(raw)
    if appendix_match:
        return 30 + int(appendix_match.group(1)), int(appendix_match.group(2)), appendix_match.group(3)
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


def clean_latex(latex: str) -> str:
    return re.sub(r"\s+", " ", latex.replace("\\\n", " ")).strip()


def infer_appendix_raw_id(chapter_id: str, formula_index: int) -> str:
    appendix_match = APPENDIX_RE.search(chapter_id)
    appendix_number = appendix_match.group(1) if appendix_match else "0"
    return f"A{appendix_number}.{formula_index}"


def extract_appendix_formulas_from_docs(chapter_id: str, chapter_docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formulas: list[dict[str, Any]] = []
    formula_index = 1
    position = 0
    for doc in chapter_docs:
        payload = doc["payload"]
        metadata = payload.get("metadata") or {}
        section = metadata.get("section_level_1") or metadata.get("section") or metadata.get("display_heading") or ""
        subsection = metadata.get("section_level_2") or metadata.get("display_heading") or section
        heading = metadata.get("heading_path") or []
        for block_index, block in enumerate(payload.get("blocks") or []):
            content = str(block.get("content") or "")
            for match in DISPLAY_EQUATION_RE.finditer(content):
                latex = clean_latex(match.group(1))
                if not latex or len(latex) < 4:
                    continue
                raw_id = infer_appendix_raw_id(chapter_id, formula_index)
                public_id = formula_public_id(raw_id)
                context = re.sub(r"\$\$.*?\$\$", " ", content, flags=re.DOTALL)
                context = re.sub(r"\s+", " ", context).strip()
                formulas.append(
                    {
                        "id": public_id,
                        "raw_id": raw_id,
                        "latex": latex,
                        "label": f"Formula {raw_id}",
                        "label_format": None,
                        "chapter_id": chapter_id,
                        "chapter": chapter_sort_key(chapter_id),
                        "section": section,
                        "subsection": subsection,
                        "source_unit_id": payload.get("id"),
                        "context_text": context or content[:800],
                        "description": context,
                        "position": position,
                        "heading_path": heading,
                        "source_chunk_id": payload.get("id"),
                        "source_file": doc["path"].name,
                        "block_index": block_index,
                    }
                )
                formula_index += 1
                position += 1
    return formulas


def find_structured_files(structured_dir: Path, chapter_filter: str | None = None) -> list[Path]:
    pattern = f"{chapter_filter}_*.json" if chapter_filter else "*_*.json"
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
    if APPENDIX_RE.fullmatch(chapter_id):
        formulas = extract_appendix_formulas_from_docs(chapter_id, chapter_docs)
        for formula in formulas:
            try:
                extracted = extract_symbols(formula["latex"])
                formula["symbols_used_detailed"] = extracted["symbols_used_detailed"]
                formula["symbols_defined_detailed"] = extracted["symbols_defined_detailed"]
                formula["symbols_used"] = [s["symbol"] for s in extracted["symbols_used"]]
                formula["symbols_defined"] = [s["symbol"] for s in extracted["symbols_defined"]]
            except Exception as exc:
                LOGGER.error("Symbol extraction failed for %s: %s", formula["id"], exc)
                formula["symbols_used_detailed"] = []
                formula["symbols_defined_detailed"] = []
                formula["symbols_used"] = []
                formula["symbols_defined"] = []
        return sorted(formulas, key=lambda f: (int(f["position"]), formula_sort_key(f["id"])))

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
            formula["symbols_used_detailed"] = extracted["symbols_used_detailed"]
            formula["symbols_defined_detailed"] = extracted["symbols_defined_detailed"]
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
                "canonical_latex": symbol.get("canonical_latex") or canonical_symbol_key(symbol["symbol"]),
                "exact_key": symbol.get("exact_key") or canonical_symbol_key(symbol["symbol"]),
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
            add_index(symbol_index, f"canonical:{sense['canonical_latex']}", sense_id)
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
            add_index(global_index, f"canonical:{sense.get('canonical_latex') or canonical_symbol_key(sense['symbol'])}", sense_id)
            add_index(global_index, f"family:{sense['family_key']}", sense_id)
    return global_index, global_senses


def symbol_role(symbol: str) -> str:
    canonical = canonical_symbol_key(symbol)
    if canonical.startswith("\\"):
        macro = canonical[1:].split("_", 1)[0]
        if macro in OPERATORS or macro in NON_TEACHING_SYMBOLS:
            return "operator"
    if "_" in canonical:
        base, _tail = canonical.split("_", 1)
        if len(base) == 1 and base.isalpha():
            return "parameter"
    if len(canonical) == 1 and canonical.isalpha():
        return "variable"
    return "symbol"


def split_symbol_family(symbol: str) -> tuple[str, str, str]:
    canonical = canonical_symbol_key(symbol)
    base = canonical
    subscript = ""
    superscript = ""
    if "_" in canonical:
        base, tail = canonical.split("_", 1)
        if "^" in tail:
            subscript, superscript = tail.split("^", 1)
        else:
            subscript = tail
    elif "^" in canonical:
        base, superscript = canonical.split("^", 1)
    return base, subscript, superscript


def edge_status(evidence: str) -> str:
    if evidence in {EDGE_EXACT, EDGE_CANONICAL, EDGE_EXPLICIT, EDGE_COMPOUND, EDGE_TEXT}:
        return EDGE_ACCEPTED
    if evidence == EDGE_LLM:
        return EDGE_CANDIDATE
    if evidence == EDGE_FAMILY:
        return EDGE_CANDIDATE
    return EDGE_AMBIGUOUS


def stoplist_variants(symbol: str, fk: str | None = None) -> set[str]:
    variants = {symbol, fk or family_key(symbol)}
    cleaned: set[str] = set()
    for value in variants:
        compact = value.replace("{", "").replace("}", "").strip()
        cleaned.add(compact)
        if compact.startswith("\\"):
            cleaned.add(compact[1:])
    return variants | cleaned


def is_stoplisted_symbol(symbol: str, fk: str | None = None) -> bool:
    canonical = canonical_symbol_key(symbol)
    if canonical in NON_TEACHING_SYMBOLS:
        return True
    if "_" in canonical or "^" in canonical:
        return False
    if canonical.startswith(tuple(f"\\{macro}" for macro in FUNCTION_STYLE_MACROS)):
        return False
    return bool(stoplist_variants(symbol, fk) & STOPLIST)


def chapter_distance(source_chapter: int, target_chapter: int) -> int:
    return abs(int(target_chapter) - int(source_chapter))


def cross_chapter_confidence(match_type: str, source_chapter: int, target_chapter: int) -> float:
    dist = chapter_distance(source_chapter, target_chapter)
    if match_type == "exact":
        return round(max(0.4, 0.78 - dist * 0.03), 4)
    return round(max(0.3, 0.62 - dist * 0.04), 4)


def allow_cross_chapter_lookup(chapter_id: str) -> bool:
    return bool(CHAPTER_RE.fullmatch(chapter_id))


def candidate_key(sense: dict[str, Any], match_type: str) -> tuple[str, str]:
    return str(sense.get("formula_id") or ""), match_type


def build_ambiguous_entry(
    symbol: dict[str, str],
    dependent: dict[str, Any],
    matches: list[tuple[int, dict[str, Any], str]],
    *,
    min_candidates: int = AMBIGUOUS_CANDIDATE_THRESHOLD,
    reason: str = "3+ cross-chapter candidates for the same symbol family",
    edge_evidence: str = EDGE_FAMILY,
) -> dict[str, Any] | None:
    candidates_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    current_chapter = int(dependent["chapter"])
    for chapter, sense, match_type in matches:
        key = candidate_key(sense, match_type)
        if not key[0] or key in candidates_by_key:
            continue
        candidates_by_key[key] = {
            "target_id": sense.get("formula_id"),
            "chapter_id": sense.get("chapter_id"),
            "via_symbol": sense.get("symbol"),
            "family_key": sense.get("family_key"),
            "match_type": match_type,
            "confidence": cross_chapter_confidence(match_type, chapter, current_chapter),
        }
    candidates = sorted(
        candidates_by_key.values(),
        key=lambda item: (-float(item.get("confidence", 0)), str(item.get("chapter_id") or ""), str(item.get("target_id") or "")),
    )
    if len(candidates) < min_candidates:
        return None
    return {
        "dependent_id": dependent["id"],
        "symbol": symbol["symbol"],
        "family_key": symbol.get("family_key") or family_key(symbol["symbol"]),
        "reason": reason,
        "edge_status": EDGE_AMBIGUOUS,
        "edge_evidence": edge_evidence,
        "candidates": candidates,
    }


def formula_group_key(formula_id: str) -> str:
    raw = raw_formula_id(formula_id)
    match = re.match(r"^([0-9]+)\.([0-9]+)([a-z]?)$", raw)
    if match:
        return f"{match.group(1)}.{match.group(2)}"
    appendix = APPENDIX_FORMULA_RE.match(raw)
    if appendix:
        return f"A{appendix.group(1)}.{appendix.group(2)}"
    return raw


def formula_variant_key(formula_id: str) -> str:
    raw = raw_formula_id(formula_id)
    match = re.match(r"^([0-9]+)\.([0-9]+)([a-z]?)$", raw)
    if match:
        return f"{match.group(1)}.{match.group(2)}{match.group(3)}"
    appendix = APPENDIX_FORMULA_RE.match(raw)
    if appendix:
        return f"A{appendix.group(1)}.{appendix.group(2)}{appendix.group(3)}"
    return raw


def formula_group_family(formula_id: str) -> str:
    raw = raw_formula_id(formula_id)
    match = re.match(r"^([0-9]+)\.([0-9]+)([a-z]?)$", raw)
    if match:
        return f"{match.group(1)}.{match.group(2)}"
    appendix = APPENDIX_FORMULA_RE.match(raw)
    if appendix:
        return f"A{appendix.group(1)}.{appendix.group(2)}"
    return raw


def extract_formula_group_neighbors(formulas: list[dict[str, Any]], formula: dict[str, Any]) -> list[dict[str, Any]]:
    key = formula_group_key(formula["id"])
    return [item for item in formulas if item["id"] != formula["id"] and formula_group_key(item["id"]) == key]


def build_edge_prerequisite(
    target_id: str,
    via_symbol: str,
    relation: str,
    reason: str,
    confidence: float,
    cross_chapter: bool,
    evidence: str,
    *,
    canonical_symbol: str | None = None,
    symbol_role_value: str | None = None,
    sense_id: str | None = None,
    review_note: str | None = None,
    source_chunk_id: str | None = None,
    definition: str | None = None,
    meaning: str | None = None,
) -> dict[str, Any]:
    prereq_type = "formula" if target_id else "variable_definition"
    payload: dict[str, Any] = {
        "type": prereq_type,
        "target_id": target_id or None,
        "via_symbol": via_symbol,
        "relation": relation,
        "reason": reason,
        "confidence": confidence,
        "cross_chapter": cross_chapter,
        "edge_status": edge_status(evidence),
        "edge_evidence": evidence,
        "canonical_symbol": canonical_symbol or canonical_symbol_key(via_symbol),
        "symbol_role": symbol_role_value or symbol_role(via_symbol),
        "sense_id": sense_id,
        "edge_weight": 1.0 if evidence in {EDGE_EXACT, EDGE_EXPLICIT, EDGE_COMPOUND} else 0.82 if evidence == EDGE_CANONICAL else 0.65 if evidence == EDGE_TEXT else 0.45,
        "review_note": review_note,
    }
    if definition is not None:
        payload["definition"] = definition
    if meaning is not None:
        payload["meaning"] = meaning
    if prereq_type == "variable_definition" and definition:
        payload["source_excerpt"] = definition
    if source_chunk_id is not None:
        payload["source_chunk_id"] = source_chunk_id
    return payload


def find_cross_chapter_definitions(
    symbol: dict[str, str],
    dependent: dict[str, Any],
    global_index: dict[str, list[str]],
    global_senses: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    current_chapter = int(dependent["chapter"])
    fk = symbol.get("family_key") or family_key(symbol["symbol"])
    canonical = symbol.get("canonical_latex") or canonical_symbol_key(symbol["symbol"])
    if is_stoplisted_symbol(symbol["symbol"], fk):
        return [], None

    matches: list[tuple[int, dict[str, Any], str]] = []
    exact_ids = list(global_index.get(symbol["symbol"], [])) + list(global_index.get(f"canonical:{canonical}", []))
    for sense_id in dict.fromkeys(exact_ids):
        sense = global_senses.get(sense_id)
        if not sense:
            continue
        chapter = int(sense.get("chapter", 0))
        if chapter and chapter < current_chapter:
            matches.append((chapter, sense, "exact"))

    family_matches: list[tuple[int, dict[str, Any], str]] = []
    for sense_id in global_index.get(f"family:{fk}", []):
        sense = global_senses.get(sense_id)
        if not sense:
            continue
        chapter = int(sense.get("chapter", 0))
        if chapter and chapter < current_chapter and sense["symbol"] != symbol["symbol"]:
            family_matches.append((chapter, sense, "family"))

    ambiguous = build_ambiguous_entry(
        symbol,
        dependent,
        matches + family_matches,
        min_candidates=1,
        reason="Cross-chapter symbol matches are review candidates unless nearby text explicitly cites the source equation.",
        edge_evidence=EDGE_EXACT if matches else EDGE_FAMILY,
    )
    if ambiguous:
        return [], ambiguous

    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for chapter, sense, match_type in sorted(matches, key=lambda item: (-item[0], item[1].get("position", 0))):
        target = sense.get("formula_id")
        if not target or target in seen:
            continue
        seen.add(target)
        via = symbol["symbol"]
        reason = f"{via} matched earlier chapter definition"
        confidence = cross_chapter_confidence(match_type, chapter, current_chapter)
        if match_type == "family":
            reason = f"{symbol['symbol']} matched earlier chapter symbol family {sense['family_key']}"
            via = f"(via family: {symbol['symbol']} -> {sense['symbol']})"
        results.append(
            build_edge_prerequisite(
                target,
                via,
                "defines_symbol",
                reason,
                confidence,
                True,
                EDGE_EXACT if match_type == "exact" else EDGE_CANONICAL,
                canonical_symbol=canonical,
                symbol_role_value=symbol.get("role") or symbol_role(symbol["symbol"]),
                sense_id=str(sense.get("sense_id") or ""),
                review_note="Earlier chapter exact/canonical symbol match.",
                source_chunk_id=sense.get("source_chunk_id"),
            )
        )
    return results, None


def collect_same_chapter_ambiguous(
    symbol: dict[str, str],
    dependent: dict[str, Any],
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    chapter_id: str,
) -> dict[str, Any] | None:
    name = symbol["symbol"]
    fk = symbol.get("family_key") or family_key(name)
    if is_stoplisted_symbol(name, fk):
        return None
    sense_ids = list(symbol_index.get(f"family:{fk}", []))
    candidates_by_target: dict[str, dict[str, Any]] = {}
    for sense_id in sense_ids:
        sense = senses.get(sense_id)
        if not sense or sense.get("chapter_id") != chapter_id:
            continue
        if int(sense.get("position", -1)) >= int(dependent.get("position", 0)):
            continue
        target_id = str(sense.get("formula_id") or "")
        if not target_id or target_id == dependent["id"] or target_id in candidates_by_target:
            continue
        candidates_by_target[target_id] = {
            "target_id": target_id,
            "chapter_id": sense.get("chapter_id"),
            "via_symbol": sense.get("symbol"),
            "family_key": sense.get("family_key"),
            "match_type": "family_candidate",
            "confidence": 0.45,
        }
    candidates = sorted(candidates_by_target.values(), key=lambda item: str(item.get("target_id") or ""))
    if len(candidates) < AMBIGUOUS_CANDIDATE_THRESHOLD:
        return None
    return {
        "dependent_id": dependent["id"],
        "symbol": name,
        "family_key": fk,
        "reason": "3+ same-chapter candidates for the same symbol family",
        "edge_status": EDGE_AMBIGUOUS,
        "edge_evidence": EDGE_FAMILY,
        "candidates": candidates,
    }


def collect_family_candidates(
    symbol: dict[str, str],
    dependent: dict[str, Any],
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    chapter_id: str,
) -> dict[str, Any] | None:
    name = symbol["symbol"]
    fk = symbol.get("family_key") or family_key(name)
    if is_stoplisted_symbol(name, fk):
        return None
    candidates_by_target: dict[str, dict[str, Any]] = {}
    for sense_id in symbol_index.get(f"family:{fk}", []):
        sense = senses.get(sense_id)
        if not sense or sense.get("chapter_id") != chapter_id:
            continue
        if int(sense.get("position", -1)) >= int(dependent.get("position", 0)):
            continue
        if sense.get("symbol") == name or (sense.get("canonical_latex") or canonical_symbol_key(str(sense.get("symbol") or ""))) == (symbol.get("canonical_latex") or canonical_symbol_key(name)):
            continue
        target_id = str(sense.get("formula_id") or "")
        if not target_id or target_id == dependent["id"] or target_id in candidates_by_target:
            continue
        candidates_by_target[target_id] = {
            "target_id": target_id,
            "chapter_id": sense.get("chapter_id"),
            "via_symbol": sense.get("symbol"),
            "family_key": sense.get("family_key"),
            "match_type": "family_candidate",
            "confidence": 0.45,
        }
    if not candidates_by_target:
        return None
    return {
        "dependent_id": dependent["id"],
        "symbol": name,
        "family_key": fk,
        "reason": "family-only symbol match; requires semantic review before entering the main graph",
        "edge_status": EDGE_AMBIGUOUS,
        "edge_evidence": EDGE_FAMILY,
        "candidates": sorted(candidates_by_target.values(), key=lambda item: str(item.get("target_id") or "")),
    }


def add_ambiguous_once(ambiguous: list[dict[str, Any]], seen: set[tuple[str, str]], entry: dict[str, Any] | None) -> None:
    if not entry:
        return
    key = (str(entry.get("dependent_id") or ""), str(entry.get("family_key") or entry.get("symbol") or ""))
    if key in seen:
        return
    seen.add(key)
    ambiguous.append(entry)


def text_definition_key(symbol: str) -> str:
    return family_key(symbol).lstrip("\\").lower()


def extract_chapter_text_defined_symbols(formulas: list[dict[str, Any]]) -> set[str]:
    defined: set[str] = set()
    symbol_re = re.compile(r"\\[A-Za-z]+|(?<![A-Za-z])[A-Za-z](?![A-Za-z])")
    where_re = re.compile(r"\bwhere\s+(.{0,80}?)\s+(?:is|are|denotes?|represents?)\b", re.IGNORECASE)
    let_re = re.compile(r"\blet\s+(.{0,80}?)\s+(?:be|denote|represent|=)\b", re.IGNORECASE)
    direct_re = re.compile(
        r"(\\[A-Za-z]+|(?<![A-Za-z])[A-Za-z](?![A-Za-z]))\s+"
        r"(?:is defined as|denotes?|represents?|is the|are the)\b",
        re.IGNORECASE,
    )
    for formula in formulas:
        text = formula.get("context_text") or ""
        segments = list(where_re.findall(text)) + list(let_re.findall(text))
        for segment in segments:
            for token in symbol_re.findall(segment):
                defined.add(text_definition_key(token))
        for token in direct_re.findall(text):
            defined.add(text_definition_key(token))
    return defined


def has_explicit_text_definition(symbol: str, chapter_text_defined_symbols: set[str]) -> bool:
    return text_definition_key(symbol) in chapter_text_defined_symbols


def should_keep_variable_definition(symbol: str, chapter_text_defined_symbols: set[str]) -> bool:
    if symbol in NON_TEACHING_SYMBOLS:
        return False
    if is_stoplisted_symbol(symbol):
        return False
    if is_atomic_symbol(symbol) and not has_explicit_text_definition(symbol, chapter_text_defined_symbols):
        return False
    return True


def variable_definition_text(symbol: str, formula: dict[str, Any]) -> tuple[str, str] | None:
    context = str(formula.get("context_text") or "")
    escaped = re.escape(symbol)
    patterns = [
        rf"(?:where|letting|let)\s+[^.]*?{escaped}[^.]*?(?:is|are|denotes?|represents?)\s+([^.;]+)",
        rf"{escaped}\s+(?:is|are|denotes?|represents?|is the|are the)\s+([^.;]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, context, re.IGNORECASE)
        if match:
            definition = re.sub(r"\s+", " ", match.group(1)).strip(" ,")
            if definition:
                return definition[:220], "nearby_text"

    return None


def prune_formula_prerequisites(prereqs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cross_symbol_prereqs = [
        prereq
        for prereq in prereqs
        if prereq.get("type") == "formula"
        and prereq.get("cross_chapter") is True
        and prereq.get("relation") == "defines_symbol"
    ]
    variable_prereqs = [prereq for prereq in prereqs if prereq.get("type") == "variable_definition"]

    top_cross_ids = {
        id(prereq)
        for prereq in sorted(
            cross_symbol_prereqs,
            key=lambda item: (-float(item.get("confidence", 0)), str(item.get("target_id") or ""), str(item.get("via_symbol") or "")),
        )[:MAX_CROSS_CHAPTER_SYMBOL_PREREQS]
    }
    top_variable_ids = {
        id(prereq)
        for prereq in sorted(
            variable_prereqs,
            key=lambda item: (-float(item.get("confidence", 0)), -len(str(item.get("definition") or "")), str(item.get("symbol") or "")),
        )[:MAX_VARIABLE_DEFINITION_PREREQS]
    }

    pruned: list[dict[str, Any]] = []
    cross_symbol_ids = {id(prereq) for prereq in cross_symbol_prereqs}
    variable_ids = {id(prereq) for prereq in variable_prereqs}
    for prereq in prereqs:
        if prereq.get("edge_status") not in STRICT_GRAPH_EDGE_STATUSES:
            continue
        prereq_id = id(prereq)
        if prereq_id in cross_symbol_ids and prereq_id not in top_cross_ids:
            continue
        if prereq_id in variable_ids and prereq_id not in top_variable_ids:
            continue
        pruned.append(prereq)
    return pruned


def build_dependencies_for_chapter(
    chapter_id: str,
    formulas: list[dict[str, Any]],
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    global_index: dict[str, list[str]],
    global_senses: dict[str, dict[str, Any]],
    formulas_by_raw_id: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    dependencies: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    seen_ambiguous: set[tuple[str, str]] = set()
    chapter_text_defined_symbols = extract_chapter_text_defined_symbols(formulas)
    formulas_by_public = {formula["id"]: formula for formula in formulas}
    explicit_refs_by_formula = {
        formula["id"]: extract_explicit_formula_refs(formula.get("context_text", "")) for formula in formulas
    }
    group_neighbors = {formula["id"]: extract_formula_group_neighbors(formulas, formula) for formula in formulas}

    for formula in formulas:
        prereqs: list[dict[str, Any]] = []
        seen_targets: set[tuple[str, str]] = set()
        seen_symbols: set[str] = set()

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
                build_edge_prerequisite(
                    target_id,
                    f"Equation {raw_ref}",
                    "explicit_reference",
                    f"Context explicitly references Equation {raw_ref}",
                    0.98,
                    target["chapter_id"] != chapter_id,
                    EDGE_EXPLICIT,
                    canonical_symbol=raw_ref,
                    symbol_role_value="reference",
                    review_note="Explicit source citation from nearby text.",
                )
            )

        for neighbor in group_neighbors.get(formula["id"], []):
            target_id = neighbor["id"]
            key = ("formula", target_id)
            if key in seen_targets:
                continue
            same_group = formula_group_key(target_id) == formula_group_key(formula["id"])
            if same_group:
                seen_targets.add(key)
                prereqs.append(
                    build_edge_prerequisite(
                        target_id,
                        f"Equation {raw_formula_id(target_id)}",
                        "compound_group",
                        f"Formula {formula['id']} belongs to the same numbered group as {target_id}",
                        0.86,
                        neighbor["chapter_id"] != chapter_id,
                        EDGE_COMPOUND,
                        canonical_symbol=formula_group_key(target_id),
                        symbol_role_value="reference",
                        review_note="Same numbered formula group; keep as a grouped context edge.",
                    )
                )

        for symbol in formula.get("symbols_used_detailed", []):
            symbol_name = symbol["symbol"]
            if symbol_name in set(formula.get("symbols_defined", [])):
                continue
            if symbol_name in seen_symbols:
                continue
            seen_symbols.add(symbol_name)
            if symbol.get("role") == "operator" or is_stoplisted_symbol(symbol_name, symbol.get("family_key")):
                continue
            sense = find_recent_definition(symbol, formula["position"], symbol_index, senses, chapter_id)
            if sense and sense.get("formula_id") in formulas_by_public:
                ambiguous_entry = collect_same_chapter_ambiguous(symbol, formula, symbol_index, senses, chapter_id)
                if ambiguous_entry:
                    add_ambiguous_once(ambiguous, seen_ambiguous, ambiguous_entry)
                    continue
                target_id = sense["formula_id"]
                if target_id != formula["id"]:
                    key = ("formula", target_id)
                    if key not in seen_targets:
                        seen_targets.add(key)
                        prereqs.append(
                            build_edge_prerequisite(
                                target_id,
                                symbol_name,
                                "defines_symbol",
                                f"{symbol_name} defined by nearest upstream formula in {chapter_id}",
                                0.84,
                                False,
                                EDGE_EXACT if sense.get("symbol") == symbol_name else EDGE_CANONICAL,
                                canonical_symbol=symbol.get("canonical_latex") or canonical_symbol_key(symbol_name),
                                symbol_role_value=symbol.get("role") or symbol_role(symbol_name),
                                sense_id=str(sense.get("sense_id") or ""),
                                review_note="Nearest upstream formula match.",
                            )
                        )
                continue

            add_ambiguous_once(ambiguous, seen_ambiguous, collect_family_candidates(symbol, formula, symbol_index, senses, chapter_id))

            if allow_cross_chapter_lookup(chapter_id):
                cross_matches, ambiguous_entry = find_cross_chapter_definitions(symbol, formula, global_index, global_senses)
                add_ambiguous_once(ambiguous, seen_ambiguous, ambiguous_entry)
                for cross in cross_matches:
                    key = ("formula", cross["target_id"])
                    if key in seen_targets:
                        continue
                    seen_targets.add(key)
                    prereqs.append(cross)

            if not any(p.get("via_symbol") == symbol_name for p in prereqs):
                key = ("variable_definition", symbol_name)
                if key not in seen_targets and should_keep_variable_definition(symbol_name, chapter_text_defined_symbols):
                    definition_result = variable_definition_text(symbol_name, formula)
                    if not definition_result:
                        continue
                    seen_targets.add(key)
                    definition, source = definition_result
                    prereqs.append(
                        build_edge_prerequisite(
                            "",
                            symbol_name,
                            "text_definition",
                            f"{symbol_name} is explained in nearby text",
                            0.55,
                            False,
                            EDGE_TEXT,
                            canonical_symbol=symbol.get("canonical_latex") or canonical_symbol_key(symbol_name),
                            symbol_role_value=symbol.get("role") or symbol_role(symbol_name),
                            source_chunk_id=formula.get("source_chunk_id"),
                            definition=definition,
                            meaning=definition,
                            review_note=source,
                        )
                    )

        dependencies.append({"dependent_id": formula["id"], "prerequisites": prune_formula_prerequisites(prereqs)})
    return dependencies, ambiguous


def serializable_formula(formula: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": formula["id"],
        "latex": formula.get("latex", ""),
        "label": formula.get("label", f"Formula {formula['raw_id']}"),
        "chapter_id": formula.get("chapter_id", ""),
        "section": formula.get("section", ""),
        "subsection": formula.get("subsection", ""),
        "position": formula.get("position", 0),
        "depth": formula.get("depth", 0),
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
    ambiguous: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    public_symbol_index = {key: value for key, value in symbol_index.items() if not key.startswith("family:")}
    return {
        "chapter_id": chapter_id,
        "version": 1,
        "generated_at": generated_at,
        "formulas": [serializable_formula(formula) for formula in formulas],
        "dependencies": dependencies,
        "symbol_index": public_symbol_index,
        "ambiguous": ambiguous or [],
    }


def compute_formula_depths(formulas: list[dict[str, Any]], dependencies: list[dict[str, Any]]) -> dict[str, int]:
    formula_ids = {formula["id"] for formula in formulas}
    prereqs_by_dependent = {
        dep["dependent_id"]: [
            prereq["target_id"]
            for prereq in dep.get("prerequisites") or []
            if prereq.get("type") == "formula" and prereq.get("target_id") in formula_ids and not prereq.get("cross_chapter")
        ]
        for dep in dependencies
    }
    depths: dict[str, int] = {}

    def depth_for(formula_id: str, visiting: set[str]) -> int:
        if formula_id in depths:
            return depths[formula_id]
        if formula_id in visiting:
            depths[formula_id] = 0
            return 0
        visiting.add(formula_id)
        prereqs = prereqs_by_dependent.get(formula_id, [])
        if not prereqs:
            depth = 0
        else:
            depth = 1 + max(depth_for(prereq_id, visiting) for prereq_id in prereqs)
        visiting.remove(formula_id)
        depths[formula_id] = depth
        return depth

    for formula_id in sorted(formula_ids, key=formula_sort_key):
        depth_for(formula_id, set())
    return depths


def apply_formula_depths(formulas: list[dict[str, Any]], dependencies: list[dict[str, Any]]) -> None:
    depths = compute_formula_depths(formulas, dependencies)
    for formula in formulas:
        formula["depth"] = depths.get(formula["id"], 0)


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
                "chapter_id": formula["chapter_id"],
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


CHAPTER_GROUPS = [
    {
        "id": "population-genetics-foundations",
        "title_en": "Population Genetics Foundations",
        "title_zh": "群体遗传学基础",
        "description_en": "Foundational chapters for population genetics concepts and formula navigation.",
        "description_zh": "用于理解群体遗传学核心概念和公式关系的基础章节。",
        "min": 2,
        "max": 7,
        "difficulty": "introductory",
    },
    {
        "id": "molecular-evolution",
        "title_en": "Molecular Evolution and Inference",
        "title_zh": "分子进化与推断",
        "description_en": "Chapters connecting molecular variation, divergence, and evolutionary inference.",
        "description_zh": "连接分子变异、分化和进化推断的章节。",
        "min": 8,
        "max": 10,
        "difficulty": "intermediate",
    },
    {
        "id": "quantitative-genetics",
        "title_en": "Quantitative Genetics Core",
        "title_zh": "数量遗传学核心",
        "description_en": "Chapters for variance, covariance, resemblance, and quantitative response models.",
        "description_zh": "围绕方差、协方差、亲缘相似和数量性状响应模型的章节。",
        "min": 11,
        "max": 16,
        "difficulty": "intermediate",
    },
    {
        "id": "selection-dynamics",
        "title_en": "Selection and Evolutionary Dynamics",
        "title_zh": "选择与进化动态",
        "description_en": "Chapters focused on selection, evolutionary change, and dynamic population processes.",
        "description_zh": "聚焦选择、进化变化和动态群体过程的章节。",
        "min": 17,
        "max": 24,
        "difficulty": "advanced",
    },
    {
        "id": "advanced-synthesis",
        "title_en": "Advanced Models and Synthesis",
        "title_zh": "高级模型与综合",
        "description_en": "Advanced chapters for extended models, applications, and synthesis.",
        "description_zh": "面向扩展模型、应用和综合理解的高级章节。",
        "min": 25,
        "max": 30,
        "difficulty": "advanced",
    },
    {
        "id": "appendices",
        "title_en": "Mathematical Appendices",
        "title_zh": "数学附录",
        "description_en": "Appendix formula systems for diffusion, Bayesian reasoning, linear algebra, and calculus tools.",
        "description_zh": "包含扩散、贝叶斯、线性代数和微积分工具的附录公式系统。",
        "min": 31,
        "max": 36,
        "difficulty": "advanced",
    },
]


def chapter_label(chapter_id: str) -> str:
    appendix_match = APPENDIX_RE.fullmatch(chapter_id)
    if appendix_match:
        return f"Appendix {appendix_match.group(1)}"
    match = CHAPTER_RE.fullmatch(chapter_id)
    if match:
        return f"Chapter {match.group(1)}"
    return chapter_id


def chapter_entry_number(chapter_id: str) -> int:
    return chapter_sort_key(chapter_id)


def formula_centrality_scores(formulas: list[dict[str, Any]], dependencies: list[dict[str, Any]]) -> Counter[str]:
    scores: Counter[str] = Counter()
    for formula in formulas:
        scores[formula["id"]] += max(0, 8 - int(formula.get("depth", 0)))
    for dep in dependencies:
        scores[dep["dependent_id"]] += len(dep.get("prerequisites") or [])
        for prereq in dep.get("prerequisites") or []:
            if prereq.get("type") == "formula" and prereq.get("target_id"):
                scores[prereq["target_id"]] += 3
    return scores


def select_backbone_ids(formulas: list[dict[str, Any]], dependencies: list[dict[str, Any]], limit: int = 14) -> list[str]:
    scores = formula_centrality_scores(formulas, dependencies)
    roots = [formula for formula in formulas if int(formula.get("depth", 0)) == 0]
    if not roots:
        roots = sorted(formulas, key=lambda item: (int(item.get("position", 0)), formula_sort_key(item["id"])))[: max(1, limit // 3)]
    ranked = sorted(formulas, key=lambda formula: (-scores[formula["id"]], int(formula.get("depth", 0)), formula_sort_key(formula["id"])))
    selected: list[str] = []
    for formula in roots[: max(3, min(8, limit // 2))]:
        selected.append(formula["id"])
    for formula in ranked:
        if len(selected) >= limit:
            break
        if formula["id"] not in selected:
            selected.append(formula["id"])
    return selected


def build_chapter_navigator(chapter_payloads: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    entries_by_rank: dict[int, dict[str, Any]] = {}
    for chapter_id, payload in chapter_payloads.items():
        formulas = payload.get("formulas") or []
        dependencies = payload.get("dependencies") or []
        if not formulas:
            continue
        rank = chapter_entry_number(chapter_id)
        label = chapter_label(chapter_id)
        first_section = next((formula.get("section") for formula in formulas if formula.get("section")), "")
        backbone_ids = select_backbone_ids(formulas, dependencies)
        full_ids = [formula["id"] for formula in sorted(formulas, key=lambda item: (int(item.get("position", 0)), formula_sort_key(item["id"])))]
        representative_ids = backbone_ids[:5] or full_ids[:5]
        difficulty = next((group["difficulty"] for group in CHAPTER_GROUPS if group["min"] <= rank <= group["max"]), "intermediate")
        entries_by_rank[rank] = {
            "chapter": rank,
            "chapter_id": chapter_id,
            "title_en": f"{label} Formula Navigator",
            "title_zh": f"{label} 公式导航",
            "description_en": f"{label} contains {len(formulas)} formulas. Start from the highlighted roots, then expand the local dependency map one step at a time.",
            "description_zh": f"{label} 包含 {len(formulas)} 个公式。建议先看高亮起始公式，再逐步展开章内依赖图谱。",
            "section_hint": first_section,
            "backbone_formula_ids": backbone_ids,
            "full_formula_ids": full_ids,
            "representative_formula_ids": representative_ids,
            "difficulty": difficulty,
        }

    groups: list[dict[str, Any]] = []
    for group in CHAPTER_GROUPS:
        chapters = [entries_by_rank[rank] for rank in sorted(entries_by_rank) if group["min"] <= rank <= group["max"]]
        if chapters:
            groups.append(
                {
                    "id": group["id"],
                    "title_en": group["title_en"],
                    "title_zh": group["title_zh"],
                    "description_en": group["description_en"],
                    "description_zh": group["description_zh"],
                    "chapters": chapters,
                }
            )
    return {"groups": groups}


STORYLINE_TEMPLATE_PHRASES = (
    "visual identity",
    "new job",
    "symbol keeps",
    "template",
    "符号的外形",
    "承担了新的任务",
    "模板",
)

STORYLINE_BLUEPRINTS: list[dict[str, Any]] = [
    {
        "id": "allele-frequency",
        "symbol": "p",
        "title_en": "Evolutionary trajectory of allele frequency p",
        "title_zh": "等位基因频率 p 的演化轨迹",
        "intro_en": "Sampling, drift, selection, mutation, and diffusion all rewrite how p moves through time.",
        "intro_zh": "从采样计数到随机漂变，再到选择、突变与扩散近似，追踪 p 的动力学身份。",
        "allowed_family_keys": {"p"},
        "allowed_canonical_symbols": {"p", "p_0", "p_t", "p_f", "p_l", "p_i", "p_j", "p_{0}", "p_{t}", "p_{f}", "p_{l}", "p_{i}", "p_{j}"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (2, 12),
        "seed_formula_ids": ["formula_2.8", "formula_2.12", "formula_2.14a", "formula_2.15", "formula_5.6e", "formula_6.15b", "formula_7.2"],
        "backbone_en": "sampling counts -> neutral drift -> deterministic forces -> continuous approximations",
        "backbone_zh": "采样计数 -> 随机漂变 -> 确定性力量 -> 连续近似",
        "bridges_zh": [
            "先把 p 写成频率分布的状态变量，随机采样成为可追踪的概率过程。",
            "漂变不再只问下一代，而是追问 p 到达固定或丢失的时间尺度。",
            "方差递推把 p 的随机游走量化为有限群体中的扩散宽度。",
            "期望公式给出中性漂变下 p 的守恒基线，方便识别偏离。",
            "加入选择梯度后，p 的变化由随机漂变转向适合度驱动。",
            "Price 框架把 p 的更新写成显式增量，允许效应值同步变化。",
        ],
        "bridges_en": [
            "p first becomes a state variable in a frequency distribution, so sampling is a trackable probability process.",
            "Drift now asks not only about the next generation, but about fixation and loss times.",
            "The variance recursion turns p's random walk into a finite-population diffusion scale.",
            "The expectation formula gives the neutral baseline against which directional forces are read.",
            "Selection gradients make p respond to fitness rather than drift alone.",
            "The Price framework writes p as an explicit increment that can coevolve with allelic effects.",
        ],
    },
    {
        "id": "inbreeding-coalescence",
        "symbol": "f, F",
        "title_en": "Inbreeding coefficient and heterozygosity loss",
        "title_zh": "近交系数与杂合度流失理论",
        "intro_en": "Follow identity by descent from finite-population recursion into effective size and population structure.",
        "intro_zh": "从近交递推出发，连接有限群体、有效大小与群体分化统计量。",
        "allowed_family_keys": {"f", "F", "H"},
        "allowed_canonical_symbols": {"f", "f_t", "f_0", "f_s", "H_t", "H_0", "F_ST", "F_DG", "F_GT", "\\widehat{F}", "\\widehat{F}_1", "\\widehat{F}_2"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (2, 12),
        "seed_formula_ids": ["formula_2.3", "formula_2.4a", "formula_2.5", "formula_3.1", "formula_4.17a", "formula_9.9"],
        "backbone_en": "inbreeding recursion -> heterozygosity decay -> effective-size correction -> F-statistics",
        "backbone_zh": "近交递推 -> 杂合度衰减 -> 有效大小修正 -> F 统计量",
        "bridges_zh": [
            "近交递推把同源同祖概率写成有限群体每代累积的过程。",
            "改写为 1-f 后，近交增长直接转化为杂合度的指数式流失。",
            "用 N_e 替代 N，模型承认真实群体的繁殖方差会改变漂变强度。",
            "样本中的 F 估计量把理论近交转成可观测的有效大小信号。",
            "F_ST 把同源同祖思想推广到群体分化，衡量结构化漂变。",
        ],
        "bridges_en": [
            "The recursion expresses identity by descent as a finite-population accumulation process.",
            "Rewriting with 1-f turns inbreeding growth into heterozygosity loss.",
            "Replacing N by Ne admits that real reproductive variance changes drift strength.",
            "F estimators convert theoretical inbreeding into an observable effective-size signal.",
            "FST extends identity logic to population structure and divergence.",
        ],
    },
    {
        "id": "coalescent-time",
        "symbol": "t, T",
        "title_en": "Coalescent theory and retrospective time",
        "title_zh": "溯祖理论与时间回溯",
        "intro_en": "Track how elapsed time becomes fixation time, generation time, and tree depth.",
        "intro_zh": "把 t/T 从世代计数推进到固定时间、世代间隔与溯祖树深度。",
        "allowed_family_keys": {"t", "T"},
        "allowed_canonical_symbols": {"t", "T", "\\overline{t}_a", "\\overline{t}_f", "\\overline{t}_l", "T_ff", "T_fm", "T_mf", "T_mm"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (2, 12),
        "seed_formula_ids": ["formula_2.11a", "formula_2.11b", "formula_2.11d", "formula_3.13", "formula_3.14", "formula_8.18c"],
        "backbone_en": "fixation time -> conditional loss/fixation -> generation interval -> sweep time",
        "backbone_zh": "固定时间 -> 条件等待时间 -> 世代间隔 -> 扫荡时间",
        "bridges_zh": [
            "先把漂变轨迹压缩成平均吸收时间，时间成为可估计对象。",
            "区分固定与丢失后，t 开始描述不同终点的条件等待。",
            "总平均时间把两类终点重新合并，形成完整吸收尺度。",
            "世代间隔 T 把时间从等长世代推广到年龄结构群体。",
            "选择扫荡把 T 变成回看等位基因来源的时间窗口。",
        ],
        "bridges_en": [
            "Drift trajectories are compressed into mean absorption time.",
            "Separating fixation and loss makes t conditional on the endpoint.",
            "The total mean time recombines endpoint-specific waiting times.",
            "Generation time T extends time accounting to age-structured populations.",
            "Selective sweeps turn T into a retrospective window on allele origin.",
        ],
    },
    {
        "id": "fitness-landscape",
        "symbol": "w",
        "title_en": "Fitness surfaces and adaptive landscapes",
        "title_zh": "适合度表面与适应性景观",
        "intro_en": "Follow fitness from genotype weights into phenotype gradients and selection response.",
        "intro_zh": "追踪适合度如何从基因型权重扩展为表型景观与选择响应。",
        "allowed_family_keys": {"w", "W"},
        "allowed_canonical_symbols": {"w", "w_i", "w_AA", "w_Aa", "W_i", "\\overline{W}", "W_ij"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (5, 16),
        "seed_formula_ids": ["formula_5.8a", "formula_5.17a", "formula_5.18b", "formula_5.20c", "formula_6.2b", "formula_6.5a"],
        "backbone_en": "relative fitness -> phenotype integration -> local gradient -> Price covariance",
        "backbone_zh": "相对适合度 -> 表型积分 -> 局部梯度 -> Price 协方差",
        "bridges_zh": [
            "相对适合度把基因型差异归一化为可比较的选择强度。",
            "把 w 写成表型函数后，选择开始依赖性状分布而非单点权重。",
            "泰勒展开提供弱选择近似，把景观局部斜率接入等位基因效应。",
            "正态表型假设让适合度梯度转化为均值与方差的代数项。",
            "Price 方程把 w 放进协方差，直接衡量选择造成的平均变化。",
        ],
        "bridges_en": [
            "Relative fitness normalizes genotype differences into comparable selection strength.",
            "As a phenotype function, w depends on trait distributions rather than isolated weights.",
            "A Taylor expansion supplies the weak-selection bridge to allelic effects.",
            "Normal trait assumptions translate fitness gradients into mean and variance terms.",
            "Price's equation places w inside covariance to measure selection response.",
        ],
    },
    {
        "id": "linkage-disequilibrium",
        "symbol": "D",
        "title_en": "Linkage disequilibrium and two-locus networks",
        "title_zh": "连锁不平衡与双基因座网络",
        "intro_en": "Follow D from gamete-frequency excess into decay, recombination, and selection at linked sites.",
        "intro_zh": "从配子频率偏离出发，追踪 D 在重组、选择与连锁位点中的变化。",
        "allowed_family_keys": {"D"},
        "allowed_canonical_symbols": {"D", "D_AB", "D_t", "D_0", "D^2", "\\widehat{D}"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (2, 12),
        "seed_formula_ids": ["formula_2.18", "formula_2.19", "formula_2.21", "formula_2.22", "formula_5.13a", "formula_7.43"],
        "backbone_en": "gamete excess -> recombination decay -> standardized LD -> linked selection",
        "backbone_zh": "配子偏离 -> 重组衰减 -> 标准化 LD -> 连锁选择",
        "bridges_zh": [
            "D 首先把双位点配子频率的非独立性写成一个代数量。",
            "加入重组率后，D 的期望按世代衰减，连锁开始具有时间尺度。",
            "方差形式把 D 的随机波动与长期连锁信号区分开。",
            "r² 标准化 D，使不同等位基因频率下的连锁强度可比较。",
            "选择递推让 D 参与配子更新，显示重组与适合度的博弈。",
        ],
        "bridges_en": [
            "D first records non-independence in two-locus gamete frequencies.",
            "Adding recombination gives LD a generational decay scale.",
            "Variance separates random fluctuation from persistent linkage signal.",
            "r2 standardizes D across allele-frequency backgrounds.",
            "Selection recursions make D part of gamete updating under fitness differences.",
        ],
    },
    {
        "id": "mutation-balance",
        "symbol": "\\mu, u",
        "title_en": "Mutation pressure and mutation-drift balance",
        "title_zh": "突变压力与突变-漂变平衡",
        "intro_en": "Follow mutation parameters from deterministic pressure into finite-population equilibrium models.",
        "intro_zh": "追踪 μ/u 如何从突变压力进入有限群体的平衡与采样模型。",
        "allowed_family_keys": {"\\mu", "u", "v"},
        "allowed_canonical_symbols": {"\\mu", "u", "v", "\\mu_i", "\\mu_k", "u_f", "\\widehat{u}", "\\widehat{u}_o"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (2, 12),
        "seed_formula_ids": ["formula_2.23", "formula_2.26b", "formula_7.2", "formula_7.9", "formula_8.32", "formula_10.1a"],
        "backbone_en": "mutation pressure -> equilibrium variance -> fixation probability -> sampling spectrum",
        "backbone_zh": "突变压力 -> 平衡方差 -> 固定概率 -> 采样谱",
        "bridges_zh": [
            "突变率先进入杂合度递推，抵消纯漂变造成的变异流失。",
            "平衡方差把突变输入与有限群体采样噪声合并。",
            "正反突变模型让 p 的更新同时受两个突变方向牵引。",
            "固定概率公式把突变产生的新等位基因接入漂变与选择结局。",
            "采样分布把 μ 与 N_e 合并为可由多态数据估计的参数。",
        ],
        "bridges_en": [
            "Mutation rate enters heterozygosity recursion and counters drift loss.",
            "Equilibrium variance combines mutational input with sampling noise.",
            "Forward and reverse mutation pull allele frequency in opposing directions.",
            "Fixation probabilities connect new mutants to drift and selection outcomes.",
            "Sampling spectra combine mutation and Ne into estimable diversity parameters.",
        ],
    },
    {
        "id": "phenotypic-trait",
        "symbol": "z",
        "title_en": "Phenotypic trait evolution and transmission",
        "title_zh": "表型性状的演化与传导",
        "intro_en": "Follow z from phenotype distributions into transmission, response, and macro-evolutionary comparison.",
        "intro_zh": "把表型 z 从分布、传递和响应推进到宏观演化比较。",
        "allowed_family_keys": {"z"},
        "allowed_canonical_symbols": {"z", "z_i", "z_j", "z_ij", "\\overline{z}", "\\overline{z}_i", "\\overline{z}_t", "\\sigma_z^2"},
        "required_roles": {"variable", "parameter", "symbol", "statistic_variance"},
        "chapter_range": (5, 20),
        "seed_formula_ids": ["formula_5.20a", "formula_6.20a", "formula_6.24a", "formula_13.12a", "formula_15.11b", "formula_18.2"],
        "backbone_en": "trait density -> transmission value -> response decomposition -> comparative divergence",
        "backbone_zh": "性状密度 -> 传递值 -> 响应分解 -> 比较分化",
        "bridges_zh": [
            "表型密度把 z 放入连续分布，为选择梯度提供积分对象。",
            "平均表型被拆成可传递成分与偏差，连接亲代表现和后代响应。",
            "协方差形式把 z 的响应归因到适合度相关的遗传成分。",
            "个体层模型把 z 写成基因型、环境与误差的可估计和。",
            "时间序列响应把 z 的变化推向跨世代比较与趋势检验。",
        ],
        "bridges_en": [
            "The trait density places z in a continuous distribution for selection gradients.",
            "Mean phenotype is split into transmissible value and deviation.",
            "Covariance attributes response in z to fitness-related genetic components.",
            "Individual models express z as genotype, environment, and residual terms.",
            "Time-series response turns z into a cross-generation comparison target.",
        ],
    },
    {
        "id": "additive-genetics",
        "symbol": "G, A",
        "title_en": "Additive genetic components and breeding value",
        "title_zh": "加性遗传成分与育种值",
        "intro_en": "Follow G and A from genotypic effects into additive variance, breeding value, and prediction.",
        "intro_zh": "追踪 G/A 如何从基因型效应走向加性方差、育种值与预测方程。",
        "allowed_family_keys": {"G", "A"},
        "allowed_canonical_symbols": {"G", "G_ij", "G_i", "\\mathbf{G}", "A", "A_i", "A_z", "A_w", "\\overline{A}_z", "\\mathbf{A}", "\\sigma_A^2"},
        "required_roles": {"variable", "parameter", "symbol", "matrix_symbol", "statistic_variance"},
        "chapter_range": (5, 26),
        "seed_formula_ids": ["formula_6.20a", "formula_6.24a", "formula_11.5", "formula_11.6a", "formula_11.8", "formula_13.12a", "formula_26.1a"],
        "backbone_en": "breeding value -> additive response -> variance decomposition -> prediction",
        "backbone_zh": "育种值 -> 加性响应 -> 方差分解 -> 预测",
        "bridges_zh": [
            "A_i 把表型均值拆出可传递的加性贡献。",
            "响应方程把 A_z 与适合度相关联，形成选择可改变的遗传均值。",
            "基因型值 G 把单个座位效应扩展为全基因型贡献。",
            "平方期望把 G 推入方差分解，定位加性与非加性来源。",
            "矩阵形式把亲缘关系写入 A，使育种值预测可规模化。",
        ],
        "bridges_en": [
            "Ai extracts the transmissible additive contribution from phenotype.",
            "Response equations link Az to fitness-associated change.",
            "Genotypic value G expands locus effects into whole-genotype contribution.",
            "Squared expectations move G into variance decomposition.",
            "Matrix A brings relatedness into scalable breeding-value prediction.",
        ],
    },
    {
        "id": "effective-size",
        "symbol": "N_e",
        "title_en": "Effective population size as a scale calibrator",
        "title_zh": "有效群体大小的尺度调校",
        "intro_en": "Follow Ne as it calibrates drift, inbreeding, sampling variance, and detectable divergence.",
        "intro_zh": "追踪 N_e 如何校准漂变、近交、采样方差与可检测的分化尺度。",
        "allowed_family_keys": {"N"},
        "allowed_canonical_symbols": {"N_e", "N_{e}", "N_e,u", "N_{e,u}", "\\widehat{N}_e", "\\widehat{N}_{e}", "N_em", "N_{em}", "N_es", "N_{es}"},
        "required_roles": {"variable", "parameter", "symbol"},
        "chapter_range": (3, 20),
        "seed_formula_ids": ["formula_3.1", "formula_3.3", "formula_3.5", "formula_4.17a", "formula_7.8", "formula_12.18b"],
        "backbone_en": "inbreeding size -> variance size -> estimator correction -> divergence bounds",
        "backbone_zh": "近交有效大小 -> 方差有效大小 -> 估计修正 -> 分化界限",
        "bridges_zh": [
            "N_e 首先替代 N，说明漂变强度由有效繁殖贡献决定。",
            "繁殖方差公式把有效大小从概念变成可由后代数估计的量。",
            "多代递推让 N_e 控制谱系抽样概率的长期尺度。",
            "样本 F 估计量把有效大小连接到观测到的频率变化。",
            "漂变方差公式把 N_e 变成等位基因频率波动的标尺。",
        ],
        "bridges_en": [
            "Ne replaces census size to express drift through effective reproductive contribution.",
            "Offspring variance makes effective size estimable from reproductive output.",
            "Multi-generation recursion lets Ne scale long-term lineage sampling.",
            "F estimators connect effective size to observed frequency change.",
            "Drift variance turns Ne into the scale of allele-frequency fluctuation.",
        ],
    },
    {
        "id": "covariance-correlation",
        "symbol": "Cov, r",
        "title_en": "Multi-trait association and phenotypic correlation",
        "title_zh": "多性状关联与表型相关性",
        "intro_en": "Follow covariance and r as association becomes resemblance, response, and structured uncertainty.",
        "intro_zh": "从协方差和相关系数出发，追踪性状关联、亲缘相似与联动响应。",
        "allowed_family_keys": {"r", "\\sigma_cov"},
        "allowed_canonical_symbols": {"r", "r^2", "r_L^2", "\\widehat{r_L^2}", "\\sigma_cov"},
        "required_roles": {"variable", "parameter", "symbol", "covariance_operator"},
        "chapter_range": (2, 20),
        "seed_formula_ids": ["formula_2.22", "formula_2.29a", "formula_4.14", "formula_6.24c", "formula_11.19a", "formula_15.11b"],
        "backbone_en": "standardized LD -> correlation estimator -> genetic covariance -> response coupling",
        "backbone_zh": "标准化连锁 -> 相关估计 -> 遗传协方差 -> 响应联动",
        "bridges_zh": [
            "r² 将 D 标准化，把连锁强度变成可比较的相关尺度。",
            "期望公式说明相关强度如何受重组与突变共同压低。",
            "估计式把观测相关反推为重组尺度，连接统计量与生物过程。",
            "遗传协方差把两个育种值的联动写成选择响应的斜率。",
            "方差矩阵把相关性推广到多性状不确定性的整体结构。",
        ],
        "bridges_en": [
            "r2 standardizes D into a comparable correlation scale.",
            "Expectation formulas show how recombination and mutation reduce association.",
            "Estimators turn observed correlation back into recombination scale.",
            "Genetic covariance writes coupled breeding values as a response slope.",
            "Variance matrices generalize association to structured multi-trait uncertainty.",
        ],
    },
]


def formula_chapter_number(formula: dict[str, Any]) -> int:
    chapter = formula.get("chapter")
    if isinstance(chapter, int):
        return chapter
    return formula_sort_key(formula.get("id", ""))[0]


def story_symbol_entries(formula: dict[str, Any]) -> list[dict[str, str]]:
    detailed = list(formula.get("symbols_defined_detailed") or []) + list(formula.get("symbols_used_detailed") or [])
    if detailed:
        return detailed
    entries: list[dict[str, str]] = []
    for symbol in list(formula.get("symbols_defined") or []) + list(formula.get("symbols_used") or []):
        entries.append(
            {
                "symbol": str(symbol),
                "canonical_latex": canonical_symbol_key(str(symbol)),
                "family_key": family_key(str(symbol)),
                "role": symbol_role(str(symbol)),
            }
        )
    return entries


def story_entry_matches(entry: dict[str, str], blueprint: dict[str, Any]) -> bool:
    required_roles = set(blueprint.get("required_roles") or [])
    if required_roles and entry.get("role") not in required_roles:
        return False
    allowed_family_keys = set(blueprint.get("allowed_family_keys") or [])
    allowed_canonical_symbols = set(blueprint.get("allowed_canonical_symbols") or [])
    allowed_symbols = set(blueprint.get("allowed_symbols") or [])
    keys = {
        str(entry.get("symbol") or ""),
        str(entry.get("canonical_latex") or ""),
        str(entry.get("exact_key") or ""),
        str(entry.get("family_key") or ""),
    }
    return bool(keys & allowed_symbols or keys & allowed_canonical_symbols or keys & allowed_family_keys)


def story_formula_match_score(formula: dict[str, Any], blueprint: dict[str, Any], seed_rank: dict[str, int]) -> int:
    chapter = formula_chapter_number(formula)
    min_chapter, max_chapter = blueprint.get("chapter_range", (0, 10_000))
    if chapter < min_chapter or chapter > max_chapter:
        return -1

    entries = story_symbol_entries(formula)
    matching_entries = [entry for entry in entries if story_entry_matches(entry, blueprint)]
    if not matching_entries:
        return -1

    score = 10 * len(matching_entries)
    score += sum(8 for entry in formula.get("symbols_defined_detailed") or [] if story_entry_matches(entry, blueprint))
    if formula["id"] in seed_rank:
        score += 1000 - seed_rank[formula["id"]]

    latex = formula.get("latex", "")
    for token in blueprint.get("preferred_latex_tokens") or []:
        if token in latex:
            score += 12
    return score


def select_story_formula_ids(
    all_formulas: list[dict[str, Any]],
    blueprint: dict[str, Any],
    limit: int = 6,
) -> tuple[list[str], list[str]]:
    seed_rank = {formula_id: index for index, formula_id in enumerate(blueprint.get("seed_formula_ids") or [])}
    scored: list[tuple[int, dict[str, Any]]] = []
    for formula in all_formulas:
        score = story_formula_match_score(formula, blueprint, seed_rank)
        if score >= 0:
            scored.append((score, formula))

    selected: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    used_chapters: set[int] = set()

    for formula_id in blueprint.get("seed_formula_ids") or []:
        seeded = next((formula for score, formula in scored if formula["id"] == formula_id), None)
        if seeded and formula_id not in used_ids:
            selected.append(seeded)
            used_ids.add(formula_id)
            used_chapters.add(formula_chapter_number(seeded))

    for _score, formula in sorted(scored, key=lambda item: (-item[0], formula_sort_key(item[1]["id"]))):
        formula_id = formula["id"]
        chapter = formula_chapter_number(formula)
        if formula_id in used_ids:
            continue
        if len(selected) >= 3 and chapter in used_chapters:
            continue
        selected.append(formula)
        used_ids.add(formula_id)
        used_chapters.add(chapter)
        if len(selected) >= limit:
            break

    if len(selected) < 2:
        for _score, formula in sorted(scored, key=lambda item: (-item[0], formula_sort_key(item[1]["id"]))):
            if formula["id"] not in used_ids:
                selected.append(formula)
                used_ids.add(formula["id"])
            if len(selected) >= 2:
                break

    sorted_selected = sorted(selected[:limit], key=lambda formula: formula_sort_key(formula["id"]))
    selected_ids = [formula["id"] for formula in sorted_selected]

    reverse_candidates: list[str] = []
    previous_chapter = -1
    for formula_id in blueprint.get("seed_formula_ids") or []:
        seeded = next((formula for _score, formula in scored if formula["id"] == formula_id), None)
        if not seeded:
            continue
        chapter = formula_chapter_number(seeded)
        if chapter < previous_chapter and formula_id not in selected_ids:
            reverse_candidates.append(formula_id)
        previous_chapter = max(previous_chapter, chapter)

    return selected_ids, reverse_candidates


def bridge_for_story_step(blueprint: dict[str, Any], index: int) -> tuple[str, str]:
    bridges_zh = blueprint.get("bridges_zh") or []
    bridges_en = blueprint.get("bridges_en") or []
    if index < len(bridges_zh) and index < len(bridges_en):
        return bridges_en[index], bridges_zh[index]
    if index == 0:
        return (
            f"This opening formula establishes the measurable object for {blueprint['symbol']}.",
            f"起点公式先建立 {blueprint['symbol']} 的可测量对象，后续模型在此基础上加限制。",
        )
    return (
        f"The next step adds a new model constraint to the {blueprint['symbol']} storyline.",
        f"下一步为 {blueprint['symbol']} 加入新的模型限制，使主线进入更具体的问题。",
    )


def build_storylines(all_formulas: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {formula["id"]: formula for formula in all_formulas}
    entries: list[dict[str, Any]] = []

    for blueprint in STORYLINE_BLUEPRINTS:
        formula_ids, reverse_candidates = select_story_formula_ids(all_formulas, blueprint)
        if len(formula_ids) < 2:
            LOGGER.warning("Storyline %s has fewer than two formula steps.", blueprint["id"])
            continue

        steps: list[dict[str, Any]] = []
        for index, formula_id in enumerate(formula_ids):
            formula = by_id[formula_id]
            transition_en, transition_zh = bridge_for_story_step(blueprint, index)
            steps.append(
                {
                    "formula_id": formula_id,
                    "title": formula.get("label", raw_formula_id(formula_id)),
                    "transition_en": transition_en,
                    "transition_zh": transition_zh,
                    "support_formula_ids": formula_ids[max(0, index - 1) : index],
                }
            )

        entries.append(
            {
                "id": blueprint["id"],
                "title_en": blueprint["title_en"],
                "title_zh": blueprint["title_zh"],
                "symbol": blueprint["symbol"],
                "intro_en": blueprint["intro_en"],
                "intro_zh": blueprint["intro_zh"],
                "backbone_en": blueprint["backbone_en"],
                "backbone_zh": blueprint["backbone_zh"],
                "entity_keys": sorted(set(blueprint.get("allowed_canonical_symbols") or []) | set(blueprint.get("allowed_family_keys") or [])),
                "steps": steps,
                "audit": {
                    "selection": "blueprint_symbol_entity_filter",
                    "excluded_reverse_formula_ids": reverse_candidates,
                },
            }
        )

    return {"version": 2, "items": entries}


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
    chapter_payloads: dict[str, dict[str, Any]] = {}
    dependency_dir = output_dir / "dependency"
    for chapter_id in sorted(chapter_formulas, key=chapter_sort_key):
        try:
            dependencies, ambiguous = build_dependencies_for_chapter(
                chapter_id,
                chapter_formulas[chapter_id],
                chapter_symbol_indexes[chapter_id],
                chapter_senses[chapter_id],
                global_index,
                global_senses,
                formulas_by_raw_id,
            )
            apply_formula_depths(chapter_formulas[chapter_id], dependencies)
            payload = build_chapter_dependency(
                chapter_id,
                chapter_formulas[chapter_id],
                dependencies,
                chapter_symbol_indexes[chapter_id],
                generated_at,
                ambiguous,
            )
            write_json(dependency_dir / f"{chapter_id}_dependencies.json", payload)
            chapter_payloads[chapter_id] = payload
            all_formulas.extend(chapter_formulas[chapter_id])
            all_dependencies.extend(dependencies)
            edge_count = sum(len(dep.get("prerequisites") or []) for dep in dependencies)
            LOGGER.info(
                "%s: wrote %s formulas, %s prerequisite entries, %s ambiguous symbols",
                chapter_id,
                len(chapter_formulas[chapter_id]),
                edge_count,
                len(ambiguous),
            )
        except Exception as exc:
            LOGGER.error("Failed to build %s: %s", chapter_id, exc, exc_info=True)

    write_json(output_dir / "featured_formulas.json", build_featured_formulas(all_formulas, all_dependencies))
    write_json(output_dir / "formula_search_index.json", build_search_index(all_formulas))
    write_json(output_dir / "learning_paths.json", build_learning_paths(all_formulas))
    write_json(output_dir / "chapter_navigator.json", build_chapter_navigator(chapter_payloads))
    write_json(output_dir / "storylines.json", build_storylines(all_formulas))

    return {
        "chapters": len(chapter_formulas),
        "formulas": len(all_formulas),
        "dependencies": len(all_dependencies),
        "output_dir": str(output_dir),
    }


def normalize_chapter_filter(chapter: str | None, run_all: bool = False) -> str | None:
    if run_all:
        return None
    return chapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--structured-dir", type=Path, default=DEFAULT_STRUCTURED_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--chapter", help="Optional chapter filter, e.g. chapter6")
    parser.add_argument("--all", action="store_true", help="Build all chapters explicitly, ignoring --chapter.")
    parser.add_argument("--log-level", default="INFO")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level.upper()), format="%(levelname)s %(message)s")
    summary = run_pipeline(args.structured_dir, args.output_dir, normalize_chapter_filter(args.chapter, args.all))
    LOGGER.info("Pipeline complete: %s", summary)


if __name__ == "__main__":
    main()
