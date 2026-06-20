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
STYLE_MACRO_RE = re.compile("|".join(sorted(STYLE_MACROS, key=len, reverse=True)))
UNBRACED_STYLE_MACROS = STYLE_MACROS - {"operatorname"}
UNBRACED_STYLE_MACRO_RE = re.compile("|".join(sorted(UNBRACED_STYLE_MACROS, key=len, reverse=True)))

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
SYMBOL_TOKEN_RE = re.compile(
    r"\\[A-Za-z]+(?:_\{[^{}]*\}|_[A-Za-z0-9]+|\^\{[^{}]*\}|\^[A-Za-z0-9]+)*"
    r"|[A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9]+|\^\{[^{}]*\}|\^[A-Za-z0-9]+)*"
)
NESTED_SCRIPT_SYMBOL_TOKEN_RE = re.compile(
    r"(?:\\[A-Za-z]+|[A-Za-z])"
    r"(?:(?:_\{(?:[^{}]|\{[^{}]*\})+\}|_[A-Za-z0-9]+)"
    r"|(?:\^\{(?:[^{}]|\{[^{}]*\})+\}|\^[A-Za-z0-9]+))+"
)
GLUED_SYMBOL_BOUNDARY_RE = re.compile(
    r"((?:\\[A-Za-z]+|[A-Za-z])"
    r"(?:_\{[^{}]*\}|_[A-Za-z0-9]+)?"
    r"(?:\^\{[^{}]*\}|\^[A-Za-z0-9]+))"
    r"(?=(?:\\[A-Za-z]+|[A-Za-z])(?:_\{[^{}]*\}|_[A-Za-z0-9]+)?)"
)
STYLE_SYMBOL_TOKEN_RE = re.compile(
    r"\\(?:bar|overline|hat|widehat|tilde|widetilde|dot|vec|mathbf|boldsymbol)"
    r"\{[^{}]+\}(?:_\{[^{}]*\}|_[A-Za-z0-9]+|\^\{[^{}]*\}|\^[A-Za-z0-9]+)*"
)
BARE_STYLE_SYMBOLS = {f"\\{macro}" for macro in STYLE_MACROS}
NON_SEMANTIC_STYLE_MACROS = {
    "mathbf",
    "boldsymbol",
    "bm",
    "mathbb",
    "mathcal",
    "mathscr",
    "mathrm",
    "mathit",
    "mathsf",
}
TYPESET_TEXT_WORDS = {
    "where",
    "then",
    "with",
    "and",
    "for",
    "if",
    "the",
    "when",
    "otherwise",
}
SCRIPT_MACROS = {"bar", "overline", "hat", "widehat", "tilde", "widetilde", "dot", "vec"}
FUNCTION_LIKE_NAMES = {"E", "P", "Pr", "Var", "Cov", "F"}
ROLE_OPERATOR = "operator"
ROLE_VARIABLE = "variable"
ROLE_FUNCTION = "function"
ROLE_PARAMETER = "parameter"
ROLE_INDEX = "index"
ROLE_SYMBOL = "symbol"
ROLE_COMMAND = "command"
ROLE_COVARIANCE_OPERATOR = "covariance_operator"
ROLE_STATISTIC_VARIANCE = "statistic_variance"
ROLE_MATRIX_SYMBOL = "matrix_symbol"


@dataclass(frozen=True)
class Symbol:
    """Normalized symbol representation used by the dependency builder."""

    name: str
    family_key: str
    canonical_latex: str
    exact_key: str
    role: str = ROLE_SYMBOL
    base: str = ""
    subscript: str = ""
    superscript: str = ""
    accent: str = ""
    occurrence_context: str = ""


def normalize_symbol(symbol: str) -> str:
    """Normalize a symbol string for stable matching."""

    normalized = symbol.strip()
    normalized = normalized.replace("&", "")
    normalized = normalized.replace(" ", "")
    normalized = normalized.replace(r"\left", "").replace(r"\right", "")
    normalized = normalized.replace("'", r"^{\prime}")
    return normalized


def normalize_latex_for_symbol_scan(latex: str) -> str:
    """Repair OCR-glued adjacent symbols before tokenization."""

    value = strip_typeset_text_words(latex)
    value = normalize_unbraced_style_macros(value)
    value = re.sub(r"\{\{(\\?[A-Za-z])\}\}", r"{\1}", value)
    value = value.replace("&", " ")
    value = re.sub(r"\\begin\s*\{(?:array|tabular)\}\s*\{[^{}]*\}", " ", value)
    value = re.sub(r"\\(?:begin|end)\s*\{[^{}]*\}", " ", value)
    value = re.sub(r"\\\\+", " ", value)
    previous = None
    while previous != value:
        previous = value
        value = GLUED_SYMBOL_BOUNDARY_RE.sub(r"\1 ", value)
    return value


def strip_typeset_text_words(latex: str) -> str:
    r"""Remove prose words encoded as ``\mathrm{...}``/``\text{...}``."""

    def replace(match: re.Match[str]) -> str:
        compact = re.sub(r"[^A-Za-z]+", "", match.group(1)).lower()
        return " " if compact in TYPESET_TEXT_WORDS else match.group(0)

    return re.sub(r"\\(?:mathrm|text)\{([^{}]+)\}", replace, str(latex or ""))


def normalize_unbraced_style_macros(latex: str) -> str:
    r"""Normalize ``\mathbf V``/``\hat p`` style input to braced LaTeX."""

    macro_names = UNBRACED_STYLE_MACRO_RE.pattern
    pattern = re.compile(
        rf"\\({macro_names})\s*(\\[A-Za-z]+|[A-Za-z])"
        r"((?:_\{[^{}]*\}|_[A-Za-z0-9]+|\^\{[^{}]*\}|\^[A-Za-z0-9]+)*)"
    )
    previous = None
    value = latex
    while previous != value:
        previous = value
        value = pattern.sub(r"\\\1{\2}\3", value)
    return value


def _normalize_script_braces(value: str) -> str:
    value = re.sub(r"_\{([^{}]+)\}", r"_\1", value)
    value = re.sub(r"\^\{([^{}]+)\}", r"^\1", value)
    return value


def canonical_symbol(symbol: str) -> str:
    """Return a conservative canonical form preserving meaningful scripts."""

    value = normalize_symbol(normalize_unbraced_style_macros(symbol))
    for macro in ("bar", "overline"):
        value = value.replace(f"\\{macro}", "\\overline")
    if value.startswith("\\widehat"):
        value = value.replace("\\widehat", "\\hat", 1)
    if value.startswith("\\widetilde"):
        value = value.replace("\\widetilde", "\\tilde", 1)
    return _normalize_script_braces(value)


def is_sigma_covariance_call(symbol: str) -> bool:
    value = canonical_symbol(symbol)
    return bool(re.match(r"^\\sigma(?:\\left)?[\(\[].*,.*(?:\\right)?[\)\]]$", value))


def is_sigma_variance_quantity(symbol: str) -> bool:
    value = canonical_symbol(symbol)
    return bool(re.match(r"^\\sigma(?:_[A-Za-z0-9\\]+)?\^2(?:\(.*\))?$", value))


def is_sigma_matrix_symbol(symbol: str) -> bool:
    value = canonical_symbol(symbol)
    return value in {r"\Sigma", r"\mathbf{\Sigma}", r"\boldsymbol{\Sigma}"}


def family_key(symbol: str) -> str:
    """Return a coarse symbol-family key by removing adornments and indices."""

    value = canonical_symbol(symbol)
    if is_sigma_covariance_call(value):
        return r"\sigma_cov"
    if is_sigma_variance_quantity(value):
        return r"\sigma_var"
    if is_sigma_matrix_symbol(value):
        return r"\Sigma_matrix"
    for macro in STYLE_MACROS:
        value = value.replace(f"\\{macro}", "")
    value = re.sub(r"[_^](?:\{[^{}]*\}|\\?[A-Za-z0-9]+)", "", value)
    value = value.replace("(", "").replace(")", "")
    value = value.replace("{", "").replace("}", "")
    return value or normalize_symbol(symbol)


def exact_key(symbol: str) -> str:
    return canonical_symbol(symbol)


def symbol_role(symbol: str) -> str:
    value = canonical_symbol(symbol)
    if is_sigma_covariance_call(value):
        return ROLE_COVARIANCE_OPERATOR
    if is_sigma_variance_quantity(value):
        return ROLE_STATISTIC_VARIANCE
    if is_sigma_matrix_symbol(value):
        return ROLE_MATRIX_SYMBOL
    if any(value.startswith(f"\\{macro}") for macro in OPERATOR_MACROS):
        return ROLE_OPERATOR
    if value.startswith("\\") and value[1:] in GREEK_MACROS:
        return ROLE_VARIABLE
    if re.match(r"^[A-Za-z]+(?:_[A-Za-z0-9]+)?$", value) and "_" in value:
        return ROLE_PARAMETER
    if re.match(r"^[A-Za-z]_[A-Za-z0-9]+$", value):
        return ROLE_INDEX
    if value.startswith("\\") and any(value.startswith(f"\\{macro}") for macro in SCRIPT_MACROS):
        return ROLE_SYMBOL
    if re.match(r"^[A-Za-z]$", value):
        return ROLE_VARIABLE
    return ROLE_SYMBOL


def split_symbol_parts(symbol: str) -> tuple[str, str, str]:
    value = canonical_symbol(symbol)
    if "(" in value:
        value = value.split("(", 1)[0]
    base = value
    subscript = ""
    superscript = ""
    if "_" in value:
        base, tail = value.split("_", 1)
        if "^" in tail:
            subscript, superscript = tail.split("^", 1)
        else:
            subscript = tail
    elif "^" in value:
        base, superscript = value.split("^", 1)
    return base, subscript, superscript


def is_operator_symbol(symbol: str) -> bool:
    value = canonical_symbol(symbol)
    if is_sigma_covariance_call(value):
        return True
    if value.startswith("\\"):
        return value[1:] in OPERATOR_MACROS or value[1:] in NON_SYMBOL_MACROS
    return value in {"E", "P", "Pr", "Var", "Cov"}


def is_atomic_symbol(symbol: str) -> bool:
    """Return True for visually atomic symbols such as ``D`` or ``\\mu``."""

    if is_operator_symbol(symbol):
        return False
    value = family_key(symbol)
    value = value.replace("{", "").replace("}", "")
    if value.startswith("\\"):
        macro = value[1:]
        return macro in GREEK_MACROS
    return len(value) == 1 and value.isalpha()


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
    nested_spans: list[tuple[int, int]] = []
    for match in NESTED_SCRIPT_SYMBOL_TOKEN_RE.finditer(text):
        token = match.group(0)
        if token.startswith("\\"):
            macro_match = re.match(r"\\([A-Za-z]+)", token)
            name = macro_match.group(1) if macro_match else token[1:]
            if name in NON_SYMBOL_MACROS:
                continue
            if name in OPERATOR_MACROS and not re.search(r"[_^]", token):
                continue
        symbols.add(token)
        nested_spans.append(match.span())

    style_spans: list[tuple[int, int]] = []
    for match in STYLE_SYMBOL_TOKEN_RE.finditer(text):
        if any(start <= match.start() and match.end() <= end for start, end in nested_spans):
            continue
        symbols.add(match.group(0))
        style_spans.append(match.span())

    protected_spans = [*nested_spans, *style_spans]

    for match in SYMBOL_TOKEN_RE.finditer(text):
        if any(start <= match.start() and match.end() <= end for start, end in protected_spans):
            continue
        token = match.group(0)
        next_text = text[match.end() :].lstrip()
        if token.startswith("\\"):
            macro_match = re.match(r"\\([A-Za-z]+)", token)
            name = macro_match.group(1) if macro_match else token[1:]
            if name in GREEK_MACROS:
                symbols.add(token)
            elif name in OPERATOR_MACROS:
                continue
        elif token in FUNCTION_LIKE_NAMES and next_text.startswith("("):
            continue
        elif token.isalpha():
            symbols.add(token)
        elif re.match(r"^[A-Za-z](?:_\{[^{}]*\}|_[A-Za-z0-9]+|\^\{[^{}]*\}|\^[A-Za-z0-9]+)+$", token):
            symbols.add(token)
    return symbols


def _regex_symbols_from_latex(latex: str) -> set[str]:
    return _symbols_from_chars(latex)


def _matching_close(open_ch: str) -> str:
    return ")" if open_ch == "(" else "]"


def _call_has_top_level_comma(text: str, open_index: int) -> bool:
    open_ch = text[open_index]
    close_ch = _matching_close(open_ch)
    depth = 0
    brace_depth = 0
    cursor = open_index
    while cursor < len(text):
        ch = text[cursor]
        if ch == "{":
            brace_depth += 1
        elif ch == "}":
            brace_depth = max(0, brace_depth - 1)
        elif brace_depth == 0 and ch == open_ch:
            depth += 1
        elif brace_depth == 0 and ch == close_ch:
            depth -= 1
            if depth == 0:
                return False
        elif brace_depth == 0 and ch == "," and depth == 1:
            return True
        cursor += 1
    return False


def _call_argument_text(text: str, open_index: int) -> str | None:
    open_ch = text[open_index]
    close_ch = _matching_close(open_ch)
    depth = 0
    brace_depth = 0
    cursor = open_index
    while cursor < len(text):
        ch = text[cursor]
        if ch == "{":
            brace_depth += 1
        elif ch == "}":
            brace_depth = max(0, brace_depth - 1)
        elif brace_depth == 0 and ch == open_ch:
            depth += 1
        elif brace_depth == 0 and ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : cursor]
        cursor += 1
    return None


def _sigma_call_open_matches(latex: str) -> Iterable[re.Match[str]]:
    return re.finditer(r"\\sigma(?:\s*\\left)?\s*([\(\[])", latex)


def _has_sigma_covariance_call(latex: str) -> bool:
    for match in _sigma_call_open_matches(latex):
        open_index = match.start(1)
        if _call_has_top_level_comma(latex, open_index):
            return True
    return False


def _is_operator_call_expression(latex: str) -> bool:
    value = latex.strip()
    return bool(
        re.match(r"^\\sigma(?:\s*\\left)?\s*[\(\[].*,.*[\)\]]\s*$", value)
        or re.match(r"^(?:E|\\?Pr|\\?Var|\\?Cov|\\?cov|\\?corr|\\?det|\\?ln|\\?log|\\?exp)\s*(?:\\left)?\s*[\(\[]", value)
    )


def _clean_lhs_for_definition(latex: str) -> str:
    value = normalize_latex_for_symbol_scan(latex).strip()
    return re.sub(r"^\{[lcr|@{}\s*]+\}\s*", "", value).strip()


def _has_lhs_expression_syntax(latex: str) -> bool:
    value = _clean_lhs_for_definition(latex)
    value = re.sub(r"[_^]\{(?:[^{}]|\{[^{}]*\})*\}", "", value)
    value = re.sub(r"[_^](?:\\?[A-Za-z0-9]+)", "", value)
    if re.search(r"\\(?:sum|prod|int|iint|iiint|frac|dfrac|tfrac|sqrt|left|right)(?=[^A-Za-z]|$)", value):
        return True
    if re.search(r"\\(?:cdot|times|pm|mp)(?=[^A-Za-z]|$)", value):
        return True
    return bool(re.search(r"[+\-*/=,<>]", value))


def _definition_symbols_from_operator_lhs(latex: str) -> set[str]:
    value = _clean_lhs_for_definition(latex)
    match = re.match(r"^E\s*(?:\\left)?\s*([\(\[])", value)
    if not match:
        return set()
    args = _call_argument_text(value, match.start(1))
    if args is None or "," in args or r"\mid" in args or "|" in args:
        return set()
    if _has_lhs_expression_syntax(args):
        return set()
    symbols = _extract_symbols_from_latex(args)
    return symbols if len(symbols) == 1 else set()


def _looks_like_function_head(text: str) -> bool:
    value = text.strip()
    if not value:
        return False
    if re.search(r"[+\-*/=<>]", value):
        return False
    if re.search(r"\\(?:frac|sum|prod|int|sqrt|left|right)(?=[^A-Za-z]|$)", value):
        return False
    return bool(re.search(r"\\[A-Za-z]+|[A-Za-z]", value))


def _lhs_top_level_function_call(latex: str) -> tuple[str, str] | None:
    value = normalize_latex_for_symbol_scan(latex).strip()
    brace_depth = 0
    for idx, ch in enumerate(value):
        if ch == "{":
            brace_depth += 1
            continue
        if ch == "}":
            brace_depth = max(0, brace_depth - 1)
            continue
        if ch not in "([" or brace_depth != 0:
            continue
        head = value[:idx].strip()
        if not _looks_like_function_head(head):
            return None
        args = _call_argument_text(value, idx)
        if args is None:
            return None
        return head, args
    return None


def _definition_symbols_from_function_lhs(latex: str) -> set[str]:
    if _is_operator_call_expression(latex):
        return set()
    call = _lhs_top_level_function_call(latex)
    if not call:
        return set()
    head, _args = call
    return _extract_symbols_from_latex(head)


def _definition_symbols_from_simple_lhs(latex: str) -> set[str]:
    value = _clean_lhs_for_definition(latex)
    if _is_operator_call_expression(value):
        return _definition_symbols_from_operator_lhs(value)
    function_symbols = _definition_symbols_from_function_lhs(value)
    if function_symbols:
        return function_symbols
    if _has_lhs_expression_syntax(value):
        return set()
    symbols = _extract_symbols_from_latex(value)
    return symbols if len(symbols) == 1 else set()


def _sigma_variance_call_symbols(latex: str) -> set[str]:
    symbols: set[str] = set()
    pattern = re.compile(
        r"(\\sigma(?:_\{[^{}]+\}|_[A-Za-z0-9]+)?(?:\^\{2\}|\^2))"
        r"\s*(?:\\left)?\s*([\(\[])"
    )
    for match in pattern.finditer(latex):
        open_index = match.start(2)
        if _call_has_top_level_comma(latex, open_index):
            continue
        args = _call_argument_text(latex, open_index)
        if args is None:
            continue
        symbols.add(f"{normalize_symbol(match.group(1))}({normalize_symbol(args)})")
    return symbols


def _sigma_variance_fragments(symbols: Iterable[str]) -> set[str]:
    fragments: set[str] = {r"\sigma"}
    for symbol in symbols:
        head = canonical_symbol(symbol).split("(", 1)[0]
        fragments.add(head)
        base, subscript, superscript = split_symbol_parts(head)
        fragments.add(base)
        if subscript:
            fragments.add(subscript.strip("{}"))
        if superscript:
            fragments.add(superscript.strip("{}"))
        if subscript and superscript:
            fragments.add(f"{subscript.strip('{}')}^{superscript.strip('{}')}")
    return {fragment for fragment in fragments if fragment}


def _discard_by_canonical(symbols: set[str], fragments: Iterable[str]) -> None:
    fragment_keys = {canonical_symbol(fragment) for fragment in fragments if fragment}
    for symbol in list(symbols):
        if canonical_symbol(symbol) in fragment_keys:
            symbols.discard(symbol)


def _styled_inner_fragments(symbols: Iterable[str]) -> set[str]:
    fragments: set[str] = set()
    macro_names = "|".join(sorted(NON_SEMANTIC_STYLE_MACROS, key=len, reverse=True))
    pattern = re.compile(rf"^\\(?:{macro_names})\{{(.+)\}}(?:[_^].*)?$")
    for symbol in symbols:
        match = pattern.match(symbol)
        if not match:
            continue
        fragments.update(_extract_symbols_from_latex(match.group(1)))
    return fragments


def _alphabetic_script_letter_fragments(latex: str) -> set[str]:
    fragments: set[str] = set()
    for match in re.finditer(r"[_^]\{([^{}]+)\}|[_^]([A-Za-z]{2,})", latex):
        script = match.group(1) or match.group(2) or ""
        for word in re.findall(r"[A-Za-z]{2,}", script):
            fragments.update(word)
    return fragments


def _top_level_single_letter_appears(latex: str, symbol: str) -> bool:
    clean = strip_typeset_text_words(latex)
    clean = re.sub(r"[_^]\{[^{}]*\}", " ", clean)
    clean = re.sub(r"[_^][A-Za-z0-9]+", " ", clean)
    clean = re.sub(r"\\[A-Za-z]+", " ", clean)
    return bool(re.search(rf"(?<![A-Za-z]){re.escape(symbol)}(?![A-Za-z])", clean))


def _discard_script_word_fragments(symbols: set[str], latex: str) -> None:
    for fragment in _alphabetic_script_letter_fragments(latex):
        if not _top_level_single_letter_appears(latex, fragment):
            symbols.discard(fragment)


def _compound_fragments(symbol: str) -> set[str]:
    fragments: set[str] = set()
    value = normalize_symbol(symbol)
    if "_" not in value and "^" not in value:
        return fragments
    base, subscript, superscript = split_symbol_parts(value)
    if base and re.fullmatch(r"\\?[A-Za-z]", base):
        fragments.add(base)
    for script in (subscript, superscript):
        cleaned = script.strip("{}")
        if len(cleaned) > 1 and cleaned.isalpha():
            fragments.update(cleaned)
        elif re.fullmatch(r"\\?[A-Za-z]", cleaned):
            fragments.add(cleaned)
        elif "_" in cleaned or "^" in cleaned or "\\" in cleaned:
            inner_symbols = _extract_symbols_from_latex(cleaned)
            fragments.update(inner_symbols)
            for inner_symbol in inner_symbols:
                fragments.update(_compound_fragments(inner_symbol))
    clean_subscript = subscript.strip("{}")
    clean_superscript = superscript.strip("{}")
    if clean_subscript and clean_superscript:
        fragments.add(f"{clean_subscript}^{clean_superscript}")
    return fragments


def _is_compound_symbol(symbol: str) -> bool:
    value = normalize_symbol(symbol)
    return "_" in value or "^" in value


def _remove_compound_fragments(symbols: set[str], protected_atomic: set[str]) -> set[str]:
    fragments: set[str] = set()
    for symbol in symbols:
        fragments.update(_compound_fragments(symbol))
    result: set[str] = set()
    for symbol in symbols:
        if symbol in fragments and symbol not in protected_atomic:
            continue
        if not _is_compound_symbol(symbol):
            canonical = canonical_symbol(symbol)
            if any(other != symbol and _is_compound_symbol(other) and canonical_symbol(other).startswith(f"{canonical}_") for other in symbols):
                continue
        result.add(symbol)
    return result


def _extract_from_nodes(nodes: Iterable[LatexNode]) -> set[str]:
    symbols: set[str] = set()
    for node in nodes:
        if isinstance(node, LatexCharsNode):
            symbols.update(_symbols_from_chars(node.chars))
            continue

        if isinstance(node, LatexMacroNode):
            macro = node.macroname
            src = _source(node)

            if macro in GREEK_MACROS:
                symbols.add(_append_scripts(f"\\{macro}", src[len(macro) + 1 :]))
                for arg in _macro_arg_sources(node):
                    symbols.update(_extract_symbols_from_latex(arg))
                continue

            if macro in OPERATOR_MACROS:
                operator_symbol = _append_scripts(f"\\{macro}", src[len(macro) + 1 :])
                symbols.add(operator_symbol)
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
    scan_latex = normalize_latex_for_symbol_scan(latex)
    try:
        nodes, _, _ = LatexWalker(scan_latex).get_latex_nodes()
        regex_symbols = _regex_symbols_from_latex(scan_latex)
        protected_atomic = {normalize_symbol(s) for s in regex_symbols if not _compound_fragments(s)}
        variance_calls = _sigma_variance_call_symbols(scan_latex)
        symbols = _extract_from_nodes(nodes) | regex_symbols | variance_calls
        variance_fragments = _sigma_variance_fragments(variance_calls)
        _discard_by_canonical(symbols, variance_fragments)
        normalized = {normalize_symbol(s) for s in symbols if normalize_symbol(s)}
        normalized.difference_update(BARE_STYLE_SYMBOLS)
        _discard_by_canonical(normalized, _styled_inner_fragments(normalized))
        _discard_by_canonical(normalized, variance_fragments)
        _discard_script_word_fragments(normalized, scan_latex)
        if _has_sigma_covariance_call(scan_latex):
            normalized.discard(r"\sigma")
        return _remove_compound_fragments(normalized, protected_atomic)
    except Exception:
        regex_symbols = _regex_symbols_from_latex(scan_latex)
        variance_calls = _sigma_variance_call_symbols(scan_latex)
        protected_atomic = {normalize_symbol(s) for s in regex_symbols if not _compound_fragments(s)}
        normalized = {normalize_symbol(s) for s in (regex_symbols | variance_calls) if normalize_symbol(s)}
        normalized.difference_update(BARE_STYLE_SYMBOLS)
        _discard_by_canonical(normalized, _sigma_variance_fragments(variance_calls))
        _discard_script_word_fragments(normalized, scan_latex)
        if _has_sigma_covariance_call(scan_latex):
            normalized.discard(r"\sigma")
        return _remove_compound_fragments(normalized, protected_atomic)


def extract_symbols(latex: str) -> dict[str, list[dict[str, str]]]:
    """Extract used and defined symbols from one LaTeX formula.

    The left-hand side of the first top-level equality is treated as the
    definition side. All symbols appearing anywhere in the formula are treated
    as used symbols.
    """

    all_symbols = _extract_symbols_from_latex(latex)
    defined_symbols: set[str] = set()
    lhs = _split_first_definition_lhs(latex)
    lhs_is_operator_call = False
    if lhs:
        lhs_is_operator_call = _is_operator_call_expression(lhs)
        defined_symbols = _definition_symbols_from_simple_lhs(lhs)

    used = sorted(symbol for symbol in all_symbols if not is_operator_symbol(symbol))
    defined = sorted(symbol for symbol in defined_symbols if not is_operator_symbol(symbol))

    used_detailed = [
        {
            "symbol": s,
            "canonical_latex": canonical_symbol(s),
            "family_key": family_key(s),
            "exact_key": exact_key(s),
            "role": symbol_role(s),
            "base": split_symbol_parts(s)[0],
            "subscript": split_symbol_parts(s)[1],
            "superscript": split_symbol_parts(s)[2],
            "accent": "overline" if "\\overline" in s or "\\bar" in s else "hat" if "\\hat" in s or "\\widehat" in s else "tilde" if "\\tilde" in s or "\\widetilde" in s else "vec" if "\\vec" in s else "",
            "occurrence_context": "formula",
        }
        for s in used
        if not is_operator_symbol(s)
    ]
    defined_detailed = [
        {
            "symbol": s,
            "canonical_latex": canonical_symbol(s),
            "family_key": family_key(s),
            "exact_key": exact_key(s),
            "role": symbol_role(s),
            "base": split_symbol_parts(s)[0],
            "subscript": split_symbol_parts(s)[1],
            "superscript": split_symbol_parts(s)[2],
            "accent": "overline" if "\\overline" in s or "\\bar" in s else "hat" if "\\hat" in s or "\\widehat" in s else "tilde" if "\\tilde" in s or "\\widetilde" in s else "vec" if "\\vec" in s else "",
            "occurrence_context": "definition",
        }
        for s in defined
        if not is_operator_symbol(s)
    ]
    return {
        "symbols_used": [{"symbol": s, "family_key": family_key(s)} for s in used],
        "symbols_defined": [{"symbol": s, "family_key": family_key(s)} for s in defined],
        "symbols_used_detailed": used_detailed,
        "symbols_defined_detailed": defined_detailed,
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
    exact_candidates = list(symbol_index.get(name, []))
    canonical = symbol.get("canonical_latex") if isinstance(symbol, dict) else canonical_symbol(name)
    canonical_candidates = list(symbol_index.get(f"canonical:{canonical}", []))

    def choose_best(candidates: list[str]) -> dict[str, Any] | None:
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

    exact_best = choose_best(exact_candidates)
    if exact_best is not None:
        return exact_best
    return choose_best(canonical_candidates)


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
