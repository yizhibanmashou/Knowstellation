import type { FormulaLearningCopyPayload, SearchFormula, StorylineEntry } from '../shared/types/formula';
import type { ChapterNavigatorPayload, ThemeRoute } from '../shared/types/learning';
import type { ConceptChapterNavigation, ConceptSearchResult } from '../shared/types/search';
import { GraphWorkspace } from '../features/graph/GraphWorkspace';

interface GraphPageProps {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
  searchIndex: SearchFormula[];
  conceptIndex: ConceptSearchResult[];
  conceptChapters: ConceptChapterNavigation[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  takeawayCache: Record<string, string>;
  storylines: StorylineEntry[];
}

export function GraphPage({ chapterNavigator, themeRoutes, searchIndex, conceptIndex, conceptChapters, formulaLearningCopy, takeawayCache, storylines }: GraphPageProps) {
  return (
    <section className="graph-page min-h-screen bg-[#02040a] pt-20 text-slate-100">
      <GraphWorkspace chapterNavigator={chapterNavigator} themeRoutes={themeRoutes} searchIndex={searchIndex} conceptIndex={conceptIndex} conceptChapters={conceptChapters} formulaLearningCopy={formulaLearningCopy} takeawayCache={takeawayCache} storylines={storylines} />
    </section>
  );
}
