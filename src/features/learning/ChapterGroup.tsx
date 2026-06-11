import { useState } from 'react';
import type { SearchFormula } from '../../shared/types/formula';
import type { ChapterGroup as ChapterGroupType } from '../../shared/types/learning';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { ChapterCard } from './ChapterCard';

interface ChapterGroupProps {
  group: ChapterGroupType;
  searchIndex: SearchFormula[];
}

export function ChapterGroup({ group, searchIndex }: ChapterGroupProps) {
  const [open, setOpen] = useState(true);
  const copy = getUiCopy(DEFAULT_LANGUAGE).navigator;

  return (
    <section className="chapter-group">
      <button type="button" className="chapter-group__header" onClick={() => setOpen((value) => !value)}>
        <span>{group.title_zh || group.title_en}</span>
        <span>{group.chapters.length} {copy.chapters}</span>
      </button>
      {open ? (
        <div className="chapter-group__body">
          {group.chapters.map((chapter) => (
            <ChapterCard key={chapter.chapter} chapter={chapter} searchIndex={searchIndex} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
