import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchFormula } from '../../shared/types/formula';
import type { ChapterLearningEntry } from '../../shared/types/learning';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { inferChapterTitleFromSearchIndex, resolveRecommendedChapterFormulaId } from './learningNavigator';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../../shared/utils/uiCopy';

interface ChapterCardProps {
  chapter: ChapterLearningEntry;
  searchIndex: SearchFormula[];
}

export function ChapterCard({ chapter, searchIndex }: ChapterCardProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE).navigator;
  const first = resolveRecommendedChapterFormulaId(chapter, searchIndex);
  const chapterTitle = chapter.description_zh || chapter.section_hint || inferChapterTitleFromSearchIndex(chapter.chapter, searchIndex) || chapter.title_zh || chapter.title_en;

  return (
    <article className={`learning-card ${open ? 'learning-card--open' : ''}`}>
      <button type="button" className="learning-card__summary" onClick={() => setOpen((value) => !value)}>
        <span className="learning-card__eyebrow">{formatChapterLabel(chapter.chapter_id, chapter.chapter)}</span>
        <strong>{chapter.title_zh || chapter.title_en.replace(' Formula Navigator', '')}</strong>
        <span>{chapter.backbone_formula_ids.length} {copy.roots} · {chapter.full_formula_ids.length} {copy.formulas}</span>
      </button>
      {open ? (
        <div className="learning-card__preview">
          <p>{chapterTitle}</p>
          <div className="learning-card__sequence">
            {chapter.representative_formula_ids.map((id) => (
              <span key={id}>{rawFormulaNumber(id)}</span>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              first
                ? navigate(`/graph/${first}?study=chapter&chapterId=${chapter.chapter_id}&layer=backbone&entry=chapter`)
                : navigate(`/graph/chapter/${chapter.chapter_id}?study=chapter&chapterId=${chapter.chapter_id}&layer=full`)
            }
          >
            {copy.enterChapter}
          </button>
        </div>
      ) : null}
    </article>
  );
}
