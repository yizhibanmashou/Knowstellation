from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


LOW_CONFIDENCE_THRESHOLD = 0.75


@dataclass
class SourceTrace:
    source_pdf: str
    page: int | None
    bbox: list[float] | None
    ocr_block_id: str
    latex_source: str
    markdown_file: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "source_pdf": self.source_pdf,
            "page": self.page,
            "bbox": self.bbox,
            "ocr_block_id": self.ocr_block_id,
            "latex_source": self.latex_source,
            "markdown_file": self.markdown_file,
        }


@dataclass
class FormulaRecord:
    id: str
    raw_id: str
    latex: str
    label: str
    chapter_id: str
    chapter: int
    section: str
    subsection: str
    position: int
    context_text: str
    confidence: float
    review_flags: list[str]
    source_trace: SourceTrace
    symbols_used: list[str] = field(default_factory=list)
    symbols_defined: list[str] = field(default_factory=list)
    symbols_used_detailed: list[dict[str, Any]] = field(default_factory=list)
    symbols_defined_detailed: list[dict[str, Any]] = field(default_factory=list)
    depth: int = 0

    @property
    def is_low_confidence(self) -> bool:
        return self.confidence < LOW_CONFIDENCE_THRESHOLD or "low_confidence_ocr" in self.review_flags

    def to_dependency_formula(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "latex": self.latex,
            "label": self.label,
            "chapter_id": self.chapter_id,
            "section": self.section,
            "subsection": self.subsection,
            "position": self.position,
            "depth": self.depth,
            "context_text": self.context_text,
            "symbols_used": self.symbols_used,
            "symbols_defined": self.symbols_defined,
            "confidence": round(self.confidence, 4),
            "review_flags": self.review_flags,
            "source_trace": self.source_trace.to_json(),
        }

    def to_search_formula(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "number": self.raw_id,
            "chapter": self.chapter,
            "chapter_id": self.chapter_id,
            "section": self.section,
            "label": self.label,
            "latex_preview": self.latex,
            "context": self.context_text,
            "keywords": keywords_for_formula(self),
            "confidence": round(self.confidence, 4),
            "review_flags": self.review_flags,
            "source_trace": self.source_trace.to_json(),
        }


def keywords_for_formula(formula: FormulaRecord) -> list[str]:
    text = " ".join([formula.section, formula.subsection, formula.context_text])
    words: list[str] = []
    seen: set[str] = set()
    for raw in text.replace("-", " ").replace("/", " ").split():
        word = "".join(ch for ch in raw if ch.isalnum())
        if len(word) < 3:
            continue
        key = word.lower()
        if key in seen:
            continue
        seen.add(key)
        words.append(word)
        if len(words) >= 24:
            break
    return words
