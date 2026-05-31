import type { FormulaLearningCopyPayload, SearchFormula, StorylineEntry } from '../types/formula';
import type { ChapterNavigatorPayload, ThemeRoute } from '../types/learning';
import { GraphWorkspace } from '../components/GraphView/GraphWorkspace';

interface GraphPageProps {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  storylines: StorylineEntry[];
}

export function GraphPage({ chapterNavigator, themeRoutes, searchIndex, formulaLearningCopy, storylines }: GraphPageProps) {
  return (
    <section className="graph-page min-h-screen bg-[#02040a] pt-20 text-slate-100">
      <GraphWorkspace chapterNavigator={chapterNavigator} themeRoutes={themeRoutes} searchIndex={searchIndex} formulaLearningCopy={formulaLearningCopy} storylines={storylines} />
    </section>
  );
}
