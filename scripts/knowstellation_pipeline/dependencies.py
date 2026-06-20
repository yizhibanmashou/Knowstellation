"""Build Knowstellation frontend dependency data from structured JSON."""

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

PROJECT_ROOT = Path(__file__).resolve().parents[2]
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
NON_SEMANTIC_STYLE_MACROS = {"mathbf", "boldsymbol", "bm", "mathbb", "mathrm", "mathit", "mathsf"}
SCRIPT_STYLE_MACRO_ALIASES = {
    "bar": "overline",
    "widehat": "hat",
    "widetilde": "tilde",
}
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
EDGE_CONTEXT = "context"
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
CORE_POPGEN_SYMBOLS = {
    "N",
    "p",
    "q",
    "R",
    "S",
    "w",
    "z",
    "h",
    "\\mu",
    "\\sigma",
}
LOW_PRECISION_FAMILY_KEYS = {
    "A",
    "D",
    "I",
    "P",
    "R",
    "S",
    "T",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "k",
    "m",
    "n",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "\\alpha",
    "\\beta",
    "\\gamma",
    "\\delta",
    "\\Delta",
    "\\epsilon",
    "\\lambda",
    "\\mu",
    "\\omega",
    "\\sigma_var",
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
    value = normalize_unbraced_function_style_macros(strip_nonsemantic_style_macros(str(symbol).strip()))
    value = value.replace(" ", "")
    value = value.replace("\\widehat", "\\hat").replace("\\widetilde", "\\tilde")
    value = value.replace("\\bar", "\\overline")
    value = normalize_function_style_script_braces(value)
    return value


def normalize_function_style_script_braces(symbol: str) -> str:
    macro_group = "|".join(sorted(FUNCTION_STYLE_MACROS, key=len, reverse=True))
    value = symbol
    value = re.sub(rf"^(\\(?:{macro_group})\{{[^{{}}]+\}})_\{{([^{{}}]+)\}}", r"\1_\2", value)
    value = re.sub(rf"^(\\(?:{macro_group})\{{[^{{}}]+\}})\^\{{([^{{}}]+)\}}", r"\1^\2", value)
    return value


def normalize_unbraced_function_style_macros(symbol: str) -> str:
    macro_group = "|".join(sorted(FUNCTION_STYLE_MACROS, key=len, reverse=True))
    pattern = re.compile(
        rf"\\({macro_group})\s*(\\[A-Za-z]+|[A-Za-z])"
        r"((?:_\{[^{}]*\}|_[A-Za-z0-9]+|\^\{[^{}]*\}|\^[A-Za-z0-9]+)*)"
    )
    previous = None
    value = symbol
    while previous != value:
        previous = value
        value = pattern.sub(r"\\\1{\2}\3", value)
    return value


def strip_nonsemantic_style_macros(symbol: str) -> str:
    value = symbol
    previous = None
    macro_group = "|".join(sorted(NON_SEMANTIC_STYLE_MACROS))
    while previous != value:
        previous = value
        value = re.sub(rf"\\(?:{macro_group})\{{([^{{}}]+)\}}", r"\1", value)
        value = re.sub(rf"\\(?:{macro_group})\s+(\\?[A-Za-z])", r"\1", value)
    return value


def is_nonsemantic_style_symbol(symbol: str) -> bool:
    macro_group = "|".join(sorted(NON_SEMANTIC_STYLE_MACROS))
    return bool(re.match(rf"^\\(?:{macro_group})(?:\{{|\\s+)", str(symbol or "").strip()))


def compatible_nonsemantic_style_family_match(symbol: dict[str, str], sense: dict[str, Any]) -> bool:
    name = symbol["symbol"]
    if not is_nonsemantic_style_symbol(name):
        return False
    query_key = canonical_symbol_key(symbol.get("canonical_latex") or name)
    sense_key = canonical_symbol_key(sense.get("canonical_latex") or str(sense.get("symbol") or ""))
    if not query_key or not sense_key or sense_key == query_key:
        return False
    return sense_key.startswith(f"{query_key}_") or sense_key.startswith(f"{query_key}^")


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
    def normalize_formula_order(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        ordered = sorted(items, key=lambda f: formula_sort_key(f["id"]))
        for order, formula in enumerate(ordered):
            formula["source_position"] = int(formula.get("position", order))
            formula["position"] = order
        return ordered

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
        return normalize_formula_order(formulas)

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
    return normalize_formula_order(formulas)


def register_formula_senses(formulas: list[dict[str, Any]]) -> tuple[dict[str, list[str]], dict[str, dict[str, Any]]]:
    symbol_index: dict[str, list[str]] = {}
    senses: dict[str, dict[str, Any]] = {}
    for formula in formulas:
        for symbol in formula.get("symbols_defined_detailed", []):
            sense_id = f"{formula['id']}::{symbol['symbol']}"
            sense = {
                "sense_id": sense_id,
                "symbol": symbol["symbol"],
                "canonical_latex": canonical_symbol_key(symbol.get("canonical_latex") or symbol["symbol"]),
                "exact_key": canonical_symbol_key(symbol.get("exact_key") or symbol["symbol"]),
                "family_key": symbol.get("family_key") or family_key(symbol["symbol"]),
                "base": symbol.get("base") or "",
                "subscript": symbol.get("subscript") or "",
                "superscript": symbol.get("superscript") or "",
                "accent": symbol.get("accent") or "",
                "role": symbol.get("role") or "",
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
            add_index(global_index, f"canonical:{canonical_symbol_key(sense.get('canonical_latex') or sense['symbol'])}", sense_id)
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


def compact_symbol_part(value: Any) -> str:
    return re.sub(r"[\s{}]", "", str(value or ""))


def record_canonical_symbol(record: dict[str, Any]) -> str:
    return canonical_symbol_key(record.get("canonical_latex") or str(record.get("symbol") or ""))


def variance_subject_key(record: dict[str, Any]) -> str:
    """Return the semantic target of a sigma-squared quantity, if one is explicit."""

    canonical = compact_symbol_part(record_canonical_symbol(record))
    match = re.match(r"^\\sigma(?:_([^()^]+))?\^2(?:\(([^()]*)\))?$", canonical)
    if not match:
        return ""
    subscript, argument = match.groups()
    if subscript:
        return compact_symbol_part(subscript)
    return compact_symbol_part(argument)


def script_signature(record: dict[str, Any]) -> tuple[str, str, str, str]:
    canonical = record_canonical_symbol(record)
    base = compact_symbol_part(record.get("base"))
    subscript = compact_symbol_part(record.get("subscript"))
    superscript = compact_symbol_part(record.get("superscript"))
    accent = compact_symbol_part(record.get("accent"))
    if not base or (not subscript and not superscript):
        parsed_base, parsed_subscript, parsed_superscript = split_symbol_family(canonical)
        base = base or compact_symbol_part(parsed_base)
        subscript = subscript or compact_symbol_part(parsed_subscript)
        superscript = superscript or compact_symbol_part(parsed_superscript)
    return base, subscript, superscript, accent


def has_matching_script_signature(symbol: dict[str, Any], sense: dict[str, Any]) -> bool:
    symbol_base, symbol_subscript, symbol_superscript, symbol_accent = script_signature(symbol)
    sense_base, sense_subscript, sense_superscript, sense_accent = script_signature(sense)
    if not symbol_base or symbol_base != sense_base:
        return False
    if not (symbol_subscript or symbol_superscript or symbol_accent):
        return False
    return (
        symbol_subscript == sense_subscript
        and symbol_superscript == sense_superscript
        and symbol_accent == sense_accent
    )


def allow_family_review_candidate(symbol: dict[str, Any], sense: dict[str, Any]) -> bool:
    symbol_canonical = record_canonical_symbol(symbol)
    sense_canonical = record_canonical_symbol(sense)
    if not symbol_canonical or not sense_canonical or symbol_canonical == sense_canonical:
        return False
    if compatible_nonsemantic_style_family_match(symbol, sense):
        return True

    fk = symbol.get("family_key") or family_key(str(symbol.get("symbol") or ""))
    if fk == r"\sigma_var":
        symbol_subject = variance_subject_key(symbol)
        sense_subject = variance_subject_key(sense)
        return bool(symbol_subject and sense_subject and symbol_subject == sense_subject)
    if fk in LOW_PRECISION_FAMILY_KEYS:
        return has_matching_script_signature(symbol, sense)
    return True


def edge_status(evidence: str) -> str:
    if evidence == EDGE_COMPOUND:
        return EDGE_CONTEXT
    if evidence in {EDGE_EXACT, EDGE_CANONICAL, EDGE_EXPLICIT, EDGE_TEXT}:
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
    if str(symbol).strip().startswith(tuple(f"\\{macro}" for macro in NON_SEMANTIC_STYLE_MACROS)):
        return False
    if canonical.startswith(tuple(f"\\{macro}" for macro in FUNCTION_STYLE_MACROS)):
        return False
    if canonical in CORE_POPGEN_SYMBOLS or (fk or family_key(symbol)) in CORE_POPGEN_SYMBOLS:
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
    return False


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
    canonical_sense_id: str | None = None,
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
        "canonical_sense_id": canonical_sense_id,
        "edge_weight": 0.28 if evidence == EDGE_COMPOUND else 1.0 if evidence in {EDGE_EXACT, EDGE_EXPLICIT} else 0.82 if evidence == EDGE_CANONICAL else 0.65 if evidence == EDGE_TEXT else 0.45,
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


def symbol_edge_evidence(symbol_name: str, sense: dict[str, Any], family_sense: dict[str, Any] | None) -> str:
    if family_sense or sense.get("symbol") != symbol_name:
        return EDGE_CANONICAL
    return EDGE_EXACT


def merge_symbol_evidence_into_existing_prereq(
    prereq: dict[str, Any],
    *,
    symbol_name: str,
    formula: dict[str, Any],
    sense: dict[str, Any],
    family_sense: dict[str, Any] | None,
    symbol: dict[str, str],
    sense_to_cluster: dict[str, str] | None,
) -> bool:
    """Upgrade an existing explicit edge when the same target is also symbol-supported."""

    if prereq.get("type") != "formula" or prereq.get("cross_chapter"):
        return False
    evidence = symbol_edge_evidence(symbol_name, sense, family_sense)
    if prereq.get("edge_evidence") not in {EDGE_EXPLICIT, EDGE_COMPOUND}:
        return False

    prereq.update(
        {
            "via_symbol": symbol_name,
            "relation": "defines_symbol",
            "reason": f"{symbol_name} defined by nearest upstream formula in {formula['chapter_id']}; nearby text also cites the formula.",
            "confidence": max(float(prereq.get("confidence", 0) or 0), 0.78 if family_sense else 0.84),
            "edge_status": edge_status(evidence),
            "edge_evidence": evidence,
            "canonical_symbol": canonical_symbol_key(symbol.get("canonical_latex") or symbol_name),
            "symbol_role": symbol.get("role") or symbol_role(symbol_name),
            "sense_id": str(sense.get("sense_id") or ""),
            "canonical_sense_id": (sense_to_cluster or {}).get(str(sense.get("sense_id") or "")),
            "edge_weight": 1.0 if evidence == EDGE_EXACT else 0.82,
            "review_note": (
                "Explicit source citation upgraded by nearest upstream family match."
                if family_sense
                else "Explicit source citation upgraded by nearest upstream formula match."
            ),
        }
    )
    return True


def sense_cluster_key(sense: dict[str, Any], formulas_by_public: dict[str, dict[str, Any]]) -> tuple[str, str, str]:
    formula = formulas_by_public.get(str(sense.get("formula_id") or "")) or {}
    subsection = str(formula.get("subsection") or formula.get("section") or "")
    canonical = canonical_symbol_key(str(sense.get("canonical_latex") or sense.get("symbol") or ""))
    return str(sense.get("chapter_id") or ""), subsection, canonical


def build_symbol_sense_clusters(
    senses: dict[str, dict[str, Any]],
    formulas: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    formulas_by_public = {formula["id"]: formula for formula in formulas}
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for sense in senses.values():
        grouped[sense_cluster_key(sense, formulas_by_public)].append(sense)

    clusters: list[dict[str, Any]] = []
    sense_to_cluster: dict[str, str] = {}
    for (_chapter_id, subsection, canonical), members in sorted(grouped.items(), key=lambda item: item[0]):
        members = sorted(members, key=lambda sense: (int(sense.get("position", 0)), str(sense.get("sense_id") or "")))
        representative = members[0]
        cluster_id = f"{representative['chapter_id']}::{slugify(subsection or 'chapter')}::{canonical}"
        for sense in members:
            sense_to_cluster[str(sense.get("sense_id") or "")] = cluster_id
        clusters.append(
            {
                "canonical_sense_id": cluster_id,
                "canonical_symbol": canonical,
                "symbol": representative.get("symbol"),
                "chapter_id": representative.get("chapter_id"),
                "subsection": subsection,
                "representative_sense_id": representative.get("sense_id"),
                "representative_formula_id": representative.get("formula_id"),
                "member_sense_ids": [sense.get("sense_id") for sense in members],
                "member_formula_ids": [sense.get("formula_id") for sense in members],
                "merge_basis": "same_chapter_subsection_canonical_symbol",
                "confidence": 0.9 if len(members) > 1 else 0.82,
            }
        )
    return clusters, sense_to_cluster


def slugify(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower()).strip("-")
    return text[:80] or "section"


def find_cross_chapter_definitions(
    symbol: dict[str, str],
    dependent: dict[str, Any],
    global_index: dict[str, list[str]],
    global_senses: dict[str, dict[str, Any]],
    sense_to_cluster: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    current_chapter = int(dependent["chapter"])
    fk = symbol.get("family_key") or family_key(symbol["symbol"])
    canonical = canonical_symbol_key(symbol.get("canonical_latex") or symbol["symbol"])
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
                canonical_sense_id=(sense_to_cluster or {}).get(str(sense.get("sense_id") or "")),
                review_note="Earlier chapter exact/canonical symbol match.",
                source_chunk_id=sense.get("source_chunk_id"),
            )
        )
    ambiguous = build_ambiguous_entry(
        symbol,
        dependent,
        family_matches,
        min_candidates=1,
        reason="Cross-chapter family-only symbol matches require semantic review before entering the main graph.",
        edge_evidence=EDGE_FAMILY,
    )
    return results, ambiguous


def find_recent_family_definition(
    symbol: dict[str, str],
    position: int,
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    chapter_id: str,
) -> dict[str, Any] | None:
    """Return only style-normalization family matches that are safe enough for the main graph."""

    name = symbol["symbol"]
    fk = symbol.get("family_key") or family_key(name)
    if is_stoplisted_symbol(name, fk):
        return None
    candidates: list[dict[str, Any]] = []
    for sense_id in symbol_index.get(f"family:{fk}", []):
        sense = senses.get(sense_id)
        if not sense or sense.get("chapter_id") != chapter_id:
            continue
        sense_position = int(sense.get("position", -1))
        if sense_position >= position:
            continue
        if sense.get("symbol") == name:
            continue
        if canonical_symbol_key(sense.get("canonical_latex") or str(sense.get("symbol") or "")) == (
            canonical_symbol_key(symbol.get("canonical_latex") or name)
        ):
            continue
        if not compatible_nonsemantic_style_family_match(symbol, sense):
            continue
        candidates.append(sense)
    unique_targets = {str(candidate.get("formula_id") or "") for candidate in candidates if candidate.get("formula_id")}
    if not unique_targets or len(unique_targets) >= AMBIGUOUS_CANDIDATE_THRESHOLD:
        return None
    return max(candidates, key=lambda candidate: int(candidate.get("position", -1)))


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
        if not allow_family_review_candidate(symbol, sense):
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
        if sense.get("symbol") == name or canonical_symbol_key(sense.get("canonical_latex") or str(sense.get("symbol") or "")) == canonical_symbol_key(symbol.get("canonical_latex") or name):
            continue
        if not allow_family_review_candidate(symbol, sense):
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


TEXT_DEFINITION_SYMBOL_CORE_RE = (
    r"\\(?:bar|overline|hat|widehat|tilde|widetilde|mathbf|boldsymbol|mathrm|mathit|mathsf|mathbb)\{?\\?[A-Za-z]\}?"
    r"|\\[A-Za-z]+"
    r"|[A-Za-z]"
)
TEXT_DEFINITION_SYMBOL_RE = (
    rf"(?<![A-Za-z\\])\$?\s*(?P<symbol>(?:{TEXT_DEFINITION_SYMBOL_CORE_RE})"
    r"(?:_\{[^{}]{1,24}\}|_[A-Za-z0-9]{1,16}|\^\{[^{}]{1,24}\}|\^[A-Za-z0-9])?)\s*\$?(?![A-Za-z])"
)
TEXT_DEFINITION_PATTERNS = [
    (
        "where_definition",
        re.compile(
            rf"\bwhere\s+(?:the\s+)?{TEXT_DEFINITION_SYMBOL_RE}\s+"
            r"(?:is|are|denotes?|represents?)\s+(?P<definition>[^.;\n]{1,260})",
            re.IGNORECASE,
        ),
    ),
    (
        "let_definition",
        re.compile(
            rf"\b(?:let|letting)\s+(?:the\s+)?{TEXT_DEFINITION_SYMBOL_RE}\s+"
            r"(?:be|denote|represent|=)\s+(?P<definition>[^.;\n]{1,260})",
            re.IGNORECASE,
        ),
    ),
    (
        "direct_definition",
        re.compile(
            rf"{TEXT_DEFINITION_SYMBOL_RE}\s+"
            r"(?:is\s+defined\s+as|are\s+defined\s+as|denotes?|represents?|is\s+the|are\s+the|is\s+an?|are\s+an?)\s+"
            r"(?P<definition>[^.;\n]{1,260})",
            re.IGNORECASE,
        ),
    ),
]
BAD_TEXT_DEFINITION_FRAGMENTS = {
    "a",
    "an",
    "and",
    "are",
    "be",
    "defined",
    "denote",
    "denotes",
    "for",
    "if",
    "is",
    "let",
    "the",
    "then",
    "where",
    "with",
}


def definition_scan_text(text: str) -> str:
    value = DISPLAY_EQUATION_RE.sub(" ", str(text or ""))
    value = FORMULA_REF_RE.sub(" ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def clean_text_definition_candidate(value: str) -> str | None:
    definition = re.sub(r"\s+", " ", str(value or "")).strip(" ,:()[]")
    definition = re.split(r"\s+\b(?:where|whereas|and\s+where|with|for)\b\s+", definition, maxsplit=1, flags=re.IGNORECASE)[0]
    definition = definition.strip(" ,:()[]")
    if not definition:
        return None
    lower = definition.lower()
    if lower in BAD_TEXT_DEFINITION_FRAGMENTS:
        return None
    if re.match(r"^(?:where|if|for|when|while|then|and|or|with|because|as)\b", lower):
        return None
    if "$$" in definition or r"\begin" in definition or r"\end" in definition or "[[" in definition:
        return None
    if re.fullmatch(r"[A-Za-z]", definition):
        return None
    formula_markers = len(re.findall(r"\\[A-Za-z]+|[_^=<>]", definition))
    if formula_markers >= 4:
        return None
    words = re.findall(r"[A-Za-z][A-Za-z-]*", definition)
    if not words:
        return None
    if len(words) == 1 and len(re.sub(r"[^A-Za-z]+", "", definition)) < 4:
        return None
    return definition


def iter_text_definition_matches(text: str) -> list[tuple[str, str, str]]:
    matches: list[tuple[str, str, str]] = []
    scan_text = definition_scan_text(text)
    if not scan_text:
        return matches
    for source, pattern in TEXT_DEFINITION_PATTERNS:
        for match in pattern.finditer(scan_text):
            symbol = match.group("symbol")
            definition = clean_text_definition_candidate(match.group("definition"))
            if not symbol or not definition:
                continue
            matches.append((text_definition_key(symbol), definition, source))
    return matches


def extract_chapter_text_defined_symbols(formulas: list[dict[str, Any]]) -> set[str]:
    defined: set[str] = set()
    for formula in formulas:
        text = formula.get("context_text") or ""
        for key, _definition, _source in iter_text_definition_matches(text):
            defined.add(key)
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
    target_key = text_definition_key(symbol)
    for key, definition, source in iter_text_definition_matches(context):
        if key == target_key:
            return definition[:220], f"nearby_text:{source}"

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
    sense_to_cluster: dict[str, str] | None = None,
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
            if target["chapter_id"] != chapter_id:
                continue
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

        for symbol in formula.get("symbols_defined_detailed", []):
            symbol_name = symbol["symbol"]
            if symbol.get("role") == "operator" or is_stoplisted_symbol(symbol_name, symbol.get("family_key")):
                continue
            sense = find_recent_definition(symbol, formula["position"], symbol_index, senses, chapter_id)
            family_sense = None
            if not sense:
                family_sense = find_recent_family_definition(symbol, formula["position"], symbol_index, senses, chapter_id)
                sense = family_sense
            if not sense or sense.get("formula_id") not in formulas_by_public:
                continue
            target_id = sense["formula_id"]
            if target_id == formula["id"] or ("formula", target_id) not in seen_targets:
                continue
            existing = next(
                (
                    prereq
                    for prereq in prereqs
                    if prereq.get("type") == "formula" and prereq.get("target_id") == target_id
                ),
                None,
            )
            if existing:
                merge_symbol_evidence_into_existing_prereq(
                    existing,
                    symbol_name=symbol_name,
                    formula=formula,
                    sense=sense,
                    family_sense=family_sense,
                    symbol=symbol,
                    sense_to_cluster=sense_to_cluster,
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
            family_sense = None
            if not sense:
                family_sense = find_recent_family_definition(symbol, formula["position"], symbol_index, senses, chapter_id)
                sense = family_sense
            if sense and sense.get("formula_id") in formulas_by_public:
                ambiguous_entry = collect_same_chapter_ambiguous(symbol, formula, symbol_index, senses, chapter_id)
                if ambiguous_entry:
                    add_ambiguous_once(ambiguous, seen_ambiguous, ambiguous_entry)
                    continue
                target_id = sense["formula_id"]
                if target_id != formula["id"]:
                    key = ("formula", target_id)
                    if key in seen_targets:
                        existing = next(
                            (
                                prereq
                                for prereq in prereqs
                                if prereq.get("type") == "formula" and prereq.get("target_id") == target_id
                            ),
                            None,
                        )
                        if existing:
                            merge_symbol_evidence_into_existing_prereq(
                                existing,
                                symbol_name=symbol_name,
                                formula=formula,
                                sense=sense,
                                family_sense=family_sense,
                                symbol=symbol,
                                sense_to_cluster=sense_to_cluster,
                            )
                    else:
                        seen_targets.add(key)
                        prereqs.append(
                            build_edge_prerequisite(
                                target_id,
                                symbol_name,
                                "defines_symbol",
                                f"{symbol_name} defined by nearest upstream formula in {chapter_id}",
                                0.78 if family_sense else 0.84,
                                False,
                                EDGE_CANONICAL if family_sense or sense.get("symbol") != symbol_name else EDGE_EXACT,
                                canonical_symbol=canonical_symbol_key(symbol.get("canonical_latex") or symbol_name),
                                symbol_role_value=symbol.get("role") or symbol_role(symbol_name),
                                sense_id=str(sense.get("sense_id") or ""),
                                canonical_sense_id=(sense_to_cluster or {}).get(str(sense.get("sense_id") or "")),
                                review_note="Nearest upstream family match." if family_sense else "Nearest upstream formula match.",
                            )
                        )
                continue

            add_ambiguous_once(ambiguous, seen_ambiguous, collect_family_candidates(symbol, formula, symbol_index, senses, chapter_id))

            if allow_cross_chapter_lookup(chapter_id):
                cross_matches, ambiguous_entry = find_cross_chapter_definitions(symbol, formula, global_index, global_senses, sense_to_cluster)
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
                            canonical_symbol=canonical_symbol_key(symbol.get("canonical_latex") or symbol_name),
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
        "source_position": formula.get("source_position", formula.get("position", 0)),
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
    symbol_sense_clusters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    public_symbol_index = {key: value for key, value in symbol_index.items() if not key.startswith("family:")}
    return {
        "chapter_id": chapter_id,
        "version": 1,
        "generated_at": generated_at,
        "formulas": [serializable_formula(formula) for formula in formulas],
        "dependencies": dependencies,
        "symbol_index": public_symbol_index,
        "symbol_sense_clusters": symbol_sense_clusters or [],
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


def select_formula_root_ids(formulas: list[dict[str, Any]], dependencies: list[dict[str, Any]]) -> list[str]:
    formula_ids = {formula["id"] for formula in formulas}
    dependent_with_formula_prereqs: set[str] = set()
    for dep in dependencies:
        dependent_id = dep.get("dependent_id")
        if dependent_id not in formula_ids:
            continue
        for prereq in dep.get("prerequisites") or []:
            if (
                prereq.get("type") == "formula"
                and prereq.get("target_id") in formula_ids
                and not prereq.get("cross_chapter")
                and prereq.get("edge_status", "accepted") == "accepted"
            ):
                dependent_with_formula_prereqs.add(dependent_id)
                break
    roots = [formula for formula in formulas if formula["id"] not in dependent_with_formula_prereqs]
    if not roots:
        roots = sorted(formulas, key=lambda item: (int(item.get("position", 0)), formula_sort_key(item["id"])))[:1]
    return [
        formula["id"]
        for formula in sorted(roots, key=lambda item: (int(item.get("position", 0)), formula_sort_key(item["id"])))
    ]


def select_backbone_ids(formulas: list[dict[str, Any]], dependencies: list[dict[str, Any]], limit: int = 14) -> list[str]:
    scores = formula_centrality_scores(formulas, dependencies)
    formula_roots = set(select_formula_root_ids(formulas, dependencies))
    roots = [formula for formula in formulas if formula["id"] in formula_roots]
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
        formula_root_ids = select_formula_root_ids(formulas, dependencies)
        backbone_ids = select_backbone_ids(formulas, dependencies)
        full_ids = [formula["id"] for formula in sorted(formulas, key=lambda item: (int(item.get("position", 0)), formula_sort_key(item["id"])))]
        representative_ids = backbone_ids[:5] or full_ids[:5]
        difficulty = next((group["difficulty"] for group in CHAPTER_GROUPS if group["min"] <= rank <= group["max"]), "intermediate")
        if label.startswith("Chapter "):
            chapter_title_zh = f"第 {label.removeprefix('Chapter ')} 章"
        elif label.startswith("Appendix "):
            chapter_title_zh = f"附录 {label.removeprefix('Appendix ')}"
        else:
            chapter_title_zh = label
        entries_by_rank[rank] = {
            "chapter": rank,
            "chapter_id": chapter_id,
            "title_en": f"{label} Formula Navigator",
            "title_zh": f"{chapter_title_zh}公式导航",
            "description_en": f"{label} contains {len(formulas)} formulas. Start from the highlighted roots, then expand the local dependency map one step at a time.",
            "description_zh": f"本章包含 {len(formulas)} 个公式。建议先从概念起点建立术语地图，再进入公式起点展开依赖图谱。",
            "section_hint": first_section,
            "formula_root_ids": formula_root_ids,
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
            symbol_sense_clusters, sense_to_cluster = build_symbol_sense_clusters(
                chapter_senses[chapter_id],
                chapter_formulas[chapter_id],
            )
            dependencies, ambiguous = build_dependencies_for_chapter(
                chapter_id,
                chapter_formulas[chapter_id],
                chapter_symbol_indexes[chapter_id],
                chapter_senses[chapter_id],
                global_index,
                global_senses,
                formulas_by_raw_id,
                sense_to_cluster,
            )
            apply_formula_depths(chapter_formulas[chapter_id], dependencies)
            payload = build_chapter_dependency(
                chapter_id,
                chapter_formulas[chapter_id],
                dependencies,
                chapter_symbol_indexes[chapter_id],
                generated_at,
                ambiguous,
                symbol_sense_clusters,
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
    # Storylines are curated manually in data/frontend/storylines.json.
    # Pipeline must NOT overwrite this file.
    # write_json(output_dir / "storylines.json", ...)  # DISABLED

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
