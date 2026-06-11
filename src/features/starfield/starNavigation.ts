import type { ChapterLearningEntry, ChapterNavigatorPayload } from '../../shared/types/learning';
import type { FeaturedFormula, SearchFormula } from '../../shared/types/formula';
import { compactChapterId, displayChapterId, rawFormulaNumber } from '../../shared/utils/constants';
import { formatChapterLabel } from '../../shared/utils/uiCopy';

export type StarNodeKind = 'chapter' | 'formula';

export interface StarNode {
  id: string;
  kind: StarNodeKind;
  label: string;
  displayLabel?: string;
  fullLabel?: string;
  title: string;
  subtitle: string;
  chapterId?: string;
  chapterRank?: number;
  formulaCount?: number;
  latex?: string;
  context?: string;
  section?: string;
  isBackbone?: boolean;
  importance: number;
}

export function flattenChapters(payload: ChapterNavigatorPayload): ChapterLearningEntry[] {
  return payload.groups.flatMap((group) => group.chapters);
}

export function buildChapterStarNodes(payload: ChapterNavigatorPayload): StarNode[] {
  return flattenChapters(payload).map((chapter) => ({
    id: chapter.chapter_id,
    kind: 'chapter',
    label: formatChapterLabel(chapter.chapter_id, chapter.chapter),
    displayLabel: compactChapterId(chapter.chapter_id, chapter.chapter),
    fullLabel: formatChapterLabel(chapter.chapter_id, chapter.chapter),
    title: chapter.title_zh || chapter.title_en.replace(' Formula Navigator', ''),
    subtitle: chapter.section_hint || chapter.description_zh || chapter.description_en,
    chapterId: chapter.chapter_id,
    chapterRank: chapter.chapter,
    formulaCount: chapter.full_formula_ids.length,
    importance: Math.max(1, chapter.full_formula_ids.length / 30),
  }));
}

export function buildFormulaStarNodes(input: {
  chapter: ChapterLearningEntry;
  searchIndex: SearchFormula[];
  featured: FeaturedFormula[];
}): StarNode[] {
  const formulaIds = new Set(input.chapter.full_formula_ids);
  const backboneIds = new Set(input.chapter.backbone_formula_ids);
  const featuredLookup = new Map(input.featured.map((item) => [item.id, item]));
  return input.searchIndex
    .filter((formula) => formulaIds.has(formula.id))
    .map((formula) => {
      const featured = featuredLookup.get(formula.id);
      const isBackbone = backboneIds.has(formula.id);
      return {
        id: formula.id,
        kind: 'formula' as const,
        label: rawFormulaNumber(formula.id),
        displayLabel: rawFormulaNumber(formula.id),
        fullLabel: formula.label,
        title: formula.label,
        subtitle: formula.section || input.chapter.title_zh || input.chapter.title_en,
        chapterId: input.chapter.chapter_id,
        chapterRank: input.chapter.chapter,
        latex: formula.latex_preview,
        context: formula.context,
        section: formula.section,
        isBackbone,
        importance: isBackbone ? 3.2 : featured?.importance || 1,
      };
    });
}
