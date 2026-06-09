from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .io_utils import write_json
from .models import FormulaRecord, SourceTrace


CHAPTER_HEADING_RE = re.compile(
    r"^(?:#{1,6}\s*)?(?:chapter|ch\.?)\s+(\d+)\b[:.\-\s]*(.*)$",
    re.IGNORECASE,
)
APPENDIX_HEADING_RE = re.compile(r"^(?:#{1,6}\s*)?appendix\s+([A-Z]|\d+)\b[:.\-\s]*(.*)$", re.IGNORECASE)
NUMERIC_HEADING_RE = re.compile(r"^#{1,3}\s*(\d+)\s+(.+)$")
FORMULA_NUMBER_RE = re.compile(r"\(([A]?\d+(?:\.\d+)+(?:[a-z])?)\)", re.IGNORECASE)
LOOSE_FORMULA_NUMBER_RE = re.compile(r"\b(A?\d+(?:\.\d+)+(?:[a-z])?)\b", re.IGNORECASE)


@dataclass
class MarkdownPage:
    page_index: int
    text: str
    source_file: str


@dataclass
class Event:
    kind: str
    text: str
    page_index: int
    line_index: int
    section: str
    subsection: str
    chapter_id: str
    chapter: int
    bbox: list[float] | None = None


def load_pages_from_jsonl(jsonl_path: Path) -> list[MarkdownPage]:
    pages: list[MarkdownPage] = []
    page_index = 0
    with jsonl_path.open("r", encoding="utf-8-sig") as fh:
        for line in fh:
            if not line.strip():
                continue
            payload = json.loads(line)
            result = payload.get("result") or {}
            for item in result.get("layoutParsingResults") or []:
                markdown = ((item.get("markdown") or {}).get("text") or "")
                pages.append(MarkdownPage(page_index=page_index, text=markdown, source_file=str(jsonl_path)))
                page_index += 1
    return pages


def load_pages_from_markdown_dir(markdown_dir: Path) -> list[MarkdownPage]:
    pages: list[MarkdownPage] = []
    for index, path in enumerate(sorted(markdown_dir.glob("*.md"))):
        pages.append(MarkdownPage(page_index=index, text=path.read_text(encoding="utf-8"), source_file=str(path)))
    return pages


def events_from_pages(pages: Iterable[MarkdownPage], source_pdf: str) -> list[Event]:
    events: list[Event] = []
    chapter = 1
    chapter_id = "chapter1"
    section = "Chapter 1"
    subsection = ""
    for page in pages:
        in_formula = False
        formula_lines: list[str] = []
        formula_start_line = 0
        for line_index, raw_line in enumerate(page.text.splitlines()):
            line = raw_line.strip()
            if not line:
                continue
            chapter_match = CHAPTER_HEADING_RE.match(line)
            appendix_match = APPENDIX_HEADING_RE.match(line)
            numeric_match = NUMERIC_HEADING_RE.match(line)
            if not in_formula and chapter_match:
                chapter = int(chapter_match.group(1))
                chapter_id = f"chapter{chapter}"
                section = chapter_match.group(2).strip() or f"Chapter {chapter}"
                subsection = ""
                events.append(Event("heading", section, page.page_index, line_index, section, subsection, chapter_id, chapter))
                continue
            if not in_formula and appendix_match:
                appendix_raw = appendix_match.group(1)
                appendix_number = ord(appendix_raw.upper()) - ord("A") + 1 if appendix_raw.isalpha() else int(appendix_raw)
                chapter = 30 + appendix_number
                chapter_id = f"appendix{appendix_number}"
                section = appendix_match.group(2).strip() or f"Appendix {appendix_raw.upper()}"
                subsection = ""
                events.append(Event("heading", section, page.page_index, line_index, section, subsection, chapter_id, chapter))
                continue
            if not in_formula and numeric_match:
                subsection = numeric_match.group(2).strip()
                events.append(Event("heading", subsection, page.page_index, line_index, section, subsection, chapter_id, chapter))
                continue

            if "$$" in line:
                parts = line.split("$$")
                if len(parts) >= 3:
                    before = parts[0].strip()
                    formula = parts[1].strip()
                    after = "$$".join(parts[2:]).strip()
                    if before:
                        events.append(Event("text", before, page.page_index, line_index, section, subsection, chapter_id, chapter))
                    events.append(Event("formula", formula, page.page_index, line_index, section, subsection, chapter_id, chapter))
                    if after:
                        events.append(Event("text", after, page.page_index, line_index, section, subsection, chapter_id, chapter))
                    continue
                if not in_formula:
                    before = parts[0].strip()
                    if before:
                        events.append(Event("text", before, page.page_index, line_index, section, subsection, chapter_id, chapter))
                    in_formula = True
                    formula_start_line = line_index
                    formula_lines = [parts[1].strip()] if len(parts) > 1 and parts[1].strip() else []
                    continue
                formula_lines.append(parts[0].strip())
                formula = "\n".join(part for part in formula_lines if part).strip()
                if formula:
                    events.append(Event("formula", formula, page.page_index, formula_start_line, section, subsection, chapter_id, chapter))
                after = "$$".join(parts[1:]).strip()
                if after:
                    events.append(Event("text", after, page.page_index, line_index, section, subsection, chapter_id, chapter))
                in_formula = False
                formula_lines = []
                continue

            bracket_formula = _extract_bracket_formula(line)
            if bracket_formula:
                before, formula, after = bracket_formula
                if before:
                    events.append(Event("text", before, page.page_index, line_index, section, subsection, chapter_id, chapter))
                events.append(Event("formula", formula, page.page_index, line_index, section, subsection, chapter_id, chapter))
                if after:
                    events.append(Event("text", after, page.page_index, line_index, section, subsection, chapter_id, chapter))
                continue

            if in_formula:
                formula_lines.append(line)
            else:
                events.append(Event("text", line, page.page_index, line_index, section, subsection, chapter_id, chapter))
    return events


def normalize_formulas(events: list[Event], *, source_pdf: str) -> list[FormulaRecord]:
    formula_events = [(index, event) for index, event in enumerate(events) if event.kind == "formula" and clean_latex(event.text)]
    used_ids: dict[str, int] = {}
    formulas: list[FormulaRecord] = []
    chapter_counters: dict[str, int] = {}
    for position, (event_index, event) in enumerate(formula_events):
        latex = clean_latex(event.text)
        before_text = nearby_text(events, event_index, -1, 3)
        after_text = nearby_text(events, event_index, 1, 3)
        number = extract_formula_number(event.text, after_text)
        inferred_chapter = event.chapter
        inferred_chapter_id = event.chapter_id
        if number:
            inferred_chapter_id, inferred_chapter = chapter_from_formula_number(number)
            raw_id = number
        else:
            chapter_counters[event.chapter_id] = chapter_counters.get(event.chapter_id, 0) + 1
            raw_id = f"{chapter_label_number(event.chapter_id)}.u{chapter_counters[event.chapter_id]:03d}"
        formula_id = f"formula_{raw_id}"
        duplicate_index = used_ids.get(formula_id, 0)
        used_ids[formula_id] = duplicate_index + 1
        duplicate = duplicate_index > 0
        if duplicate:
            formula_id = f"{formula_id}_dup{duplicate_index + 1}"

        context = " ".join(part for part in [before_text, after_text] if part).strip()
        confidence, review_flags = score_formula(latex, raw_id, context, duplicate=duplicate, numbered=bool(number))
        if event.chapter_id != inferred_chapter_id and not number:
            inferred_chapter_id = event.chapter_id
            inferred_chapter = event.chapter
        source_trace = SourceTrace(
            source_pdf=source_pdf,
            page=event.page_index,
            bbox=event.bbox,
            ocr_block_id=f"page_{event.page_index}:line_{event.line_index}:formula_{position}",
            latex_source="paddleocr-vl-1.6-markdown",
            markdown_file=None,
        )
        formulas.append(
            FormulaRecord(
                id=formula_id,
                raw_id=raw_id,
                latex=latex,
                label=f"Formula {raw_id}",
                chapter_id=inferred_chapter_id,
                chapter=inferred_chapter,
                section=event.section or f"Chapter {inferred_chapter}",
                subsection=event.subsection,
                position=position,
                context_text=context,
                confidence=confidence,
                review_flags=review_flags,
                source_trace=source_trace,
            )
        )
    return formulas


def write_normalized_artifacts(output_dir: Path, pages: list[MarkdownPage], events: list[Event], formulas: list[FormulaRecord]) -> None:
    write_json(
        output_dir / "normalized_pages.json",
        [{"page_index": page.page_index, "source_file": page.source_file, "text_length": len(page.text)} for page in pages],
    )
    write_json(
        output_dir / "normalized_blocks.json",
        [
            {
                "kind": event.kind,
                "text": event.text,
                "page": event.page_index,
                "line": event.line_index,
                "chapter_id": event.chapter_id,
                "section": event.section,
                "subsection": event.subsection,
            }
            for event in events
        ],
    )
    write_json(
        output_dir / "formula_records.json",
        [
            {
                **formula.to_dependency_formula(),
                "raw_id": formula.raw_id,
                "source_trace": formula.source_trace.to_json(),
            }
            for formula in formulas
        ],
    )


def _extract_bracket_formula(line: str) -> tuple[str, str, str] | None:
    start = line.find(r"\[")
    end = line.find(r"\]")
    if start >= 0 and end > start:
        return line[:start].strip(), line[start + 2 : end].strip(), line[end + 2 :].strip()
    return None


def clean_latex(value: str) -> str:
    latex = value.strip()
    latex = latex.strip("$")
    latex = re.sub(r"\\tag\{([^{}]+)\}", "", latex)
    latex = FORMULA_NUMBER_RE.sub("", latex)
    return " ".join(latex.split())


def nearby_text(events: list[Event], index: int, direction: int, limit: int) -> str:
    parts: list[str] = []
    cursor = index + direction
    while 0 <= cursor < len(events) and len(parts) < limit:
        event = events[cursor]
        if event.kind == "formula":
            break
        if event.kind == "text":
            parts.append(event.text)
        cursor += direction
    if direction < 0:
        parts.reverse()
    return " ".join(parts)


def extract_formula_number(raw_formula: str, after_text: str) -> str | None:
    for text in (raw_formula, after_text):
        match = FORMULA_NUMBER_RE.search(text)
        if match:
            return normalize_formula_number(match.group(1))
    after_lines = [part.strip() for part in after_text.split(". ") if part.strip()]
    if after_lines:
        first = after_lines[0]
        if len(first) <= 20:
            match = LOOSE_FORMULA_NUMBER_RE.search(first)
            if match:
                return normalize_formula_number(match.group(1))
    return None


def normalize_formula_number(value: str) -> str:
    return value.strip().replace(" ", "")


def chapter_from_formula_number(number: str) -> tuple[str, int]:
    appendix = re.match(r"^A(\d+)\.", number, re.IGNORECASE)
    if appendix:
        appendix_number = int(appendix.group(1))
        return f"appendix{appendix_number}", 30 + appendix_number
    match = re.match(r"^(\d+)\.", number)
    if match:
        chapter = int(match.group(1))
        return f"chapter{chapter}", chapter
    return "chapter1", 1


def chapter_label_number(chapter_id: str) -> str:
    appendix = re.match(r"appendix(\d+)", chapter_id, re.IGNORECASE)
    if appendix:
        return f"A{appendix.group(1)}"
    match = re.match(r"chapter(\d+)", chapter_id, re.IGNORECASE)
    return match.group(1) if match else "1"


def score_formula(latex: str, raw_id: str, context: str, *, duplicate: bool, numbered: bool) -> tuple[float, list[str]]:
    confidence = 0.98
    flags: list[str] = []
    if not numbered:
        confidence -= 0.2
        flags.append("missing_formula_number")
    if duplicate:
        confidence -= 0.18
        flags.append("duplicate_formula_number")
    if len(latex) < 6 or not re.search(r"[A-Za-z\\]", latex):
        confidence -= 0.28
        flags.append("suspicious_short_formula")
    if len(context) < 32:
        confidence -= 0.12
        flags.append("short_context")
    if latex.count("{") != latex.count("}"):
        confidence -= 0.25
        flags.append("unbalanced_latex_braces")
    confidence = max(0.05, min(1.0, confidence))
    if confidence < 0.75 and "low_confidence_ocr" not in flags:
        flags.append("low_confidence_ocr")
    return confidence, flags
