"""LaTeX symbol extraction and lightweight dependency helpers.

The functions in this module are intentionally conservative. They extract
formula-level symbols for graph construction without trying to solve full
mathematical semantics.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable

from pylatexenc.latexwalker import (
    LatexCharsNode,
    LatexEnvironmentNode,
    LatexGroupNode,
    LatexMacroNode,
    LatexNode,
    LatexWalker,
)


GREEK_MACROS = {
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "varepsilon",
    "zeta",
    "eta",
    "theta",
    "vartheta",
    "iota",
    "kappa",
    "lambda",
    "mu",
    "nu",
    "xi",
    "pi",
    "rho",
    "varrho",
    "sigma",
    "tau",
    "upsilon",
    "phi",
    "varphi",
    "chi",
    "psi",
    "omega",
    "Gamma",
    "Delta",
    "Theta",
    "Lambda",
    "Xi",
    "Pi",
    "Sigma",
    "Upsilon",
    "Phi",
    "Psi",
    "Omega",
}

OPERATOR_MACROS = {
    "Pr",
    "P",
    "E",
    "Var",
    "Cov",
    "cov",
    "corr",
    "det",
    "exp",
    "log",
    "ln",
    "max",
    "min",
}

STYLE_MACROS = {
    "bar",
    "overline",
    "hat",
    "widehat",
    "tilde",
    "widetilde",
    "vec",
    "mathbf",
    "boldsymbol",
    "mathbb",
    "mathcal",
    "mathscr",
    "mathrm",
    "mathit",
    "mathsf",
    "operatorname",
}

NON_SYMBOL_MACROS = {
    "frac",
    "dfrac",
    "tfrac",
    "sqrt",
    "sum",
    "prod",
    "int",
    "iint",
    "iiint",
    "left",
    "right",
    "big",
    "Big",
    "bigg",
    "Bigg",
    "begin",
    "end",
    "limits",
    "nolimits",
    "binom",
    "choose",
    "cdot",
    "times",
    "pm",
    "mp",
    "le",
    "leq",
    "ge",
    "geq",
    "neq",
    "approx",
    "simeq",
    "sim",
    "propto",
    "to",
    "rightarrow",
    "leftarrow",
    "leftrightarrow",
    "infty",
    "ldots",
    "cdots",
    "dots",
    "qquad",
    "quad",
    " ",
    ",",
    ";",
    ":",
    "!",
}

LATIN_SYMBOL_RE = re.compile(r"[A-Za-z](?:[A-Za-z]+)?")
SYMBOL_SPLIT_RE = re.compile(r"\\[A-Za-z]+|[A-Za-z]")


@dataclass(frozen=True)
class Symbol:
    """Normalized symbol representation used by the dependency builder."""

    name: str
    family_key: str


def normalize_symbol(symbol: str) -> str:
    """Normalize a symbol string for stable matching."""

    normalized = symbol.strip()
    normalized = normalized.replace(" ", "")
    normalized = normalized.replace(r"\left", "").replace(r"\right", "")
    normalized = re.sub(r"([_^])\{([^{}]+)\}", r"\1\2", normalized)
    normalized = normalized.replace("'", r"^{\prime}")
    return normalized


def family_key(symbol: str) -> str:
    """Return a coarse symbol-family key by removing adornments and indices."""

    value = normalize_symbol(symbol)
    for macro in STYLE_MACROS:
        value = value.replace(f"\\{macro}", "")
    value = re.sub(r"[_^](?:\{[^{}]*\}|\\?[A-Za-z0-9]+)", "", value)
    value = value.replace("(", "").replace(")", "")
    return value or normalize_symbol(symbol)


def _source(node: LatexNode) -> str:
    return getattr(node, "latex_verbatim", lambda: "")() or ""


def _group_source(group: LatexGroupNode | None) -> str:
    if group is None:
        return ""
    src = _source(group)
    if src.startswith("{") and src.endswith("}"):
        return src[1:-1]
    return src


def _macro_arg_sources(node: LatexMacroNode) -> list[str]:
    args: list[str] = []
    nodeargd = getattr(node, "nodeargd", None)
    if not nodeargd:
        return args
    for arg in getattr(nodeargd, "argnlist", []) or []:
        if arg is None:
            continue
        if isinstance(arg, LatexGroupNode):
            args.append(_group_source(arg))
        else:
            args.append(_source(arg))
    return args


def _append_scripts(base: str, tail: str) -> str:
    cursor = 0
    result = base
    while cursor < len(tail):
        ch = tail[cursor]
        if ch not in "_^":
            cursor += 1
            continue
        if cursor + 1 >= len(tail):
            break
        next_ch = tail[cursor + 1]
        if next_ch == "{":
            depth = 0
            end = cursor + 1
            while end < len(tail):
                if tail[end] == "{":
                    depth += 1
                elif tail[end] == "}":
                    depth -= 1
                    if depth == 0:
                        end += 1
                        break
                end += 1
            result += tail[cursor:end]
            cursor = end
        elif next_ch == "\\":
            match = re.match(r"\\[A-Za-z]+", tail[cursor + 1 :])
            if match:
                result += ch + match.group(0)
                cursor += 1 + len(match.group(0))
            else:
                result += tail[cursor : cursor + 2]
                cursor += 2
        else:
            result += tail[cursor : cursor + 2]
            cursor += 2
    return result


def _symbols_from_chars(text: str) -> set[str]:
    symbols: set[str] = set()
    for match in SYMBOL_SPLIT_RE.finditer(text):
        token = match.group(0)
        if token.startswith("\\"):
            name = token[1:]
            if name in GREEK_MACROS or name in OPERATOR_MACROS:
                symbols.add(token)
        elif token.isalpha():
            symbols.add(token)
    return symbols


def _extract_from_nodes(nodes: Iterable[LatexNode]) -> set[str]:
    symbols: set[str] = set()
    for node in nodes:
        if isinstance(node, LatexCharsNode):
            symbols.update(_symbols_from_chars(node.chars))
            continue

        if isinstance(node, LatexMacroNode):
            macro = node.macroname
            src = _source(node)

            if macro in GREEK_MACROS or macro in OPERATOR_MACROS:
                symbols.add(_append_scripts(f"\\{macro}", src[len(macro) + 1 :]))
                for arg in _macro_arg_sources(node):
                    symbols.update(_extract_symbols_from_latex(arg))
                continue

            if macro in STYLE_MACROS:
                arg_text = "".join(_macro_arg_sources(node))
                inner_symbols = _extract_symbols_from_latex(arg_text)
                if inner_symbols:
                    for inner in inner_symbols:
                        symbols.add(_append_scripts(f"\\{macro}{{{inner}}}", src[len(macro) + 1 + len(arg_text) + 2 :]))
                else:
                    symbols.add(_append_scripts(src, ""))
                continue

            if macro not in NON_SYMBOL_MACROS:
                for arg in _macro_arg_sources(node):
                    symbols.update(_extract_symbols_from_latex(arg))
                continue

            for arg in _macro_arg_sources(node):
                symbols.update(_extract_symbols_from_latex(arg))
            continue

        child_nodes = getattr(node, "nodelist", None)
        if child_nodes:
            symbols.update(_extract_from_nodes(child_nodes))
        elif isinstance(node, LatexGroupNode):
            symbols.update(_extract_from_nodes(node.nodelist))
        elif isinstance(node, LatexEnvironmentNode):
            symbols.update(_extract_from_nodes(node.nodelist))

    return symbols


def _extract_symbols_from_latex(latex: str) -> set[str]:
    if not latex:
        return set()
    try:
        nodes, _, _ = LatexWalker(latex).get_latex_nodes()
        return {normalize_symbol(s) for s in _extract_from_nodes(nodes) if normalize_symbol(s)}
    except Exception:
        return {normalize_symbol(s) for s in _symbols_from_chars(latex) if normalize_symbol(s)}


def extract_symbols(latex: str) -> dict[str, list[dict[str, str]]]:
    """Extract used and defined symbols from one LaTeX formula.

    The left-hand side of the first top-level equality is treated as the
    definition side. All symbols appearing anywhere in the formula are treated
    as used symbols.
    """

    all_symbols = _extract_symbols_from_latex(latex)
    defined_symbols: set[str] = set()
    lhs = _split_first_definition_lhs(latex)
    if lhs:
        defined_symbols = _extract_symbols_from_latex(lhs)

    if not defined_symbols and all_symbols:
        first = sorted(all_symbols, key=lambda s: latex.find(s.replace("\\", "\\")) if s in latex else 9999)
        if first:
            defined_symbols.add(first[0])

    used = sorted(all_symbols)
    defined = sorted(defined_symbols)
    return {
        "symbols_used": [{"symbol": s, "family_key": family_key(s)} for s in used],
        "symbols_defined": [{"symbol": s, "family_key": family_key(s)} for s in defined],
    }


def _split_first_definition_lhs(latex: str) -> str | None:
    depth = 0
    escaped = False
    for idx, ch in enumerate(latex):
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "{":
            depth += 1
            continue
        if ch == "}":
            depth = max(0, depth - 1)
            continue
        if ch == "=" and depth == 0:
            return latex[:idx]
    match = re.search(r"(?:^|\\\\)\s*([^=&]+?)\s*&?=", latex)
    if match:
        return match.group(1)
    return None


def add_to_dict(symbol: dict[str, str], sense_id: str, index: dict[str, list[str]], senses: dict[str, dict[str, Any]]) -> None:
    """Register a symbol sense without overwriting previous senses."""

    name = symbol["symbol"] if isinstance(symbol, dict) else str(symbol)
    index.setdefault(name, [])
    if sense_id not in index[name]:
        index[name].append(sense_id)
    sense = senses.get(sense_id)
    if sense:
        fk = sense.get("family_key") or family_key(name)
        index.setdefault(f"family:{fk}", [])
        if sense_id not in index[f"family:{fk}"]:
            index[f"family:{fk}"].append(sense_id)


def find_recent_definition(
    symbol: dict[str, str],
    position: int,
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
    chapter_id: str,
) -> dict[str, Any] | None:
    """Find the nearest upstream definition in the same chapter."""

    name = symbol["symbol"] if isinstance(symbol, dict) else str(symbol)
    fk = symbol.get("family_key") if isinstance(symbol, dict) else family_key(name)
    candidates = list(symbol_index.get(name, [])) + list(symbol_index.get(f"family:{fk}", []))
    best: dict[str, Any] | None = None
    for sense_id in candidates:
        sense = senses.get(sense_id)
        if not sense:
            continue
        if sense.get("chapter_id") != chapter_id:
            continue
        sense_position = int(sense.get("position", -1))
        if sense_position >= position:
            continue
        if best is None or sense_position > int(best.get("position", -1)):
            best = sense
    return best


def build_dependency_node(
    formula_id: str,
    used_symbols: list[dict[str, str]],
    sense_registry: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Build a dependency node from a formula and resolved symbol senses."""

    prerequisites: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for symbol in used_symbols:
        name = symbol["symbol"]
        sense = sense_registry.get(name)
        if not sense:
            continue
        source_formula = sense.get("formula_id")
        if source_formula and source_formula != formula_id:
            key = ("formula", source_formula)
            if key in seen:
                continue
            seen.add(key)
            prerequisites.append(
                {
                    "type": "formula",
                    "target_id": source_formula,
                    "via_symbol": name,
                    "relation": "defines_symbol",
                    "reason": f"{name} defined by nearest upstream formula",
                    "confidence": 0.86,
                    "cross_chapter": sense.get("chapter_id") != sense.get("dependent_chapter_id", sense.get("chapter_id")),
                }
            )
        elif sense.get("definition"):
            key = ("variable_definition", name)
            if key in seen:
                continue
            seen.add(key)
            prerequisites.append(
                {
                    "type": "variable_definition",
                    "symbol": name,
                    "definition": sense["definition"],
                    "source": sense.get("source", "nearby_text"),
                    "source_chunk_id": sense.get("source_chunk_id"),
                    "confidence": float(sense.get("confidence", 0.65)),
                }
            )
    return {"dependent_id": formula_id, "prerequisites": prerequisites}


def build_sense_registry(
    formulas: list[dict[str, Any]],
    symbol_index: dict[str, list[str]],
    senses: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Build a registry of symbols defined by formulas in a chapter."""

    registry: dict[str, dict[str, Any]] = {}
    for formula in formulas:
        for symbol in formula.get("symbols_defined_detailed", []):
            name = symbol["symbol"]
            sense_id = f"{formula['id']}::{name}"
            sense = {
                "sense_id": sense_id,
                "symbol": name,
                "family_key": symbol.get("family_key") or family_key(name),
                "formula_id": formula["id"],
                "chapter_id": formula["chapter_id"],
                "position": formula["position"],
                "source": formula["id"],
            }
            senses[sense_id] = sense
            add_to_dict(symbol, sense_id, symbol_index, senses)
            registry[name] = sense
    return registry
