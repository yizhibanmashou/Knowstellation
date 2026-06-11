import type { SearchFormula } from '../../shared/types/formula';
import type {
  ChapterLearningEntry,
  ChapterNavigatorPayload,
  LanguageCode,
  StudyContext,
  ThemeRoute,
  ThemeRoutesPayload,
} from '../../shared/types/learning';

export function getChapterByNumber(payload: ChapterNavigatorPayload, chapterNumber: number): ChapterLearningEntry | null {
  for (const group of payload.groups) {
    const chapter = group.chapters.find((item) => item.chapter === chapterNumber);
    if (chapter) return chapter;
  }
  return null;
}

export function getChapterById(payload: ChapterNavigatorPayload, chapterId: string): ChapterLearningEntry | null {
  for (const group of payload.groups) {
    const chapter = group.chapters.find((item) => item.chapter_id === chapterId);
    if (chapter) return chapter;
  }
  return null;
}

export function getThemeRouteById(payload: ThemeRoutesPayload, routeId: string): ThemeRoute | null {
  return payload.paths.find((route) => route.id === routeId) || null;
}

export function inferChapterTitleFromSearchIndex(chapterNumber: number, searchIndex: SearchFormula[]): string | null {
  return searchIndex.find((formula) => formula.chapter === chapterNumber && formula.section.trim())?.section.trim() || null;
}

export function resolveRecommendedChapterFormulaId(chapter: ChapterLearningEntry, searchIndex: SearchFormula[]): string | null {
  const availableFormulaIds = new Set(searchIndex.filter((item) => item.chapter_id === chapter.chapter_id).map((item) => item.id));
  const firstAvailable = (formulaIds: string[]) => formulaIds.find((id) => availableFormulaIds.has(id)) || null;

  return (
    firstAvailable(chapter.representative_formula_ids) ||
    firstAvailable(chapter.backbone_formula_ids) ||
    firstAvailable(chapter.full_formula_ids) ||
    searchIndex.find((item) => item.chapter_id === chapter.chapter_id)?.id ||
    null
  );
}

export function getStudyFormulaIds(context: StudyContext): string[] {
  if (context.type === 'chapter') {
    return context.layer === 'full' ? context.chapter.full_formula_ids : context.chapter.backbone_formula_ids;
  }
  if (context.type === 'theme') return context.route.formula_ids;
  return [];
}

export function getText(value: { en: string; zh?: string }, language: LanguageCode): string {
  if (language === 'zh') return value.zh || value.en;
  return value.en;
}
