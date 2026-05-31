import { useEffect, useState } from 'react';
import type { FeaturedFormula, FormulaLearningCopyPayload, SearchFormula, StorylineEntry, StorylinePayload } from '../types/formula';
import type { ChapterNavigatorPayload, ThemeRoutesPayload } from '../types/learning';
import { loadJSON } from '../utils/loadJSON';

export interface FormulaDataState {
  featured: FeaturedFormula[];
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  storylines: StorylineEntry[];
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoutesPayload['paths'];
  loading: boolean;
  supplementalLoading: boolean;
  error: string | null;
}

export function useFormulaData(): FormulaDataState {
  const [state, setState] = useState<FormulaDataState>({
    featured: [],
    searchIndex: [],
    formulaLearningCopy: {},
    storylines: [],
    chapterNavigator: { groups: [] },
    themeRoutes: [],
    loading: true,
    supplementalLoading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadJSON<{ featured: FeaturedFormula[] }>('/data/featured_formulas.json', controller.signal),
      loadJSON<SearchFormula[]>('/data/formula_search_index.json', controller.signal),
      loadJSON<ChapterNavigatorPayload>('/data/chapter_navigator.json', controller.signal),
    ])
      .then(([featuredPayload, searchIndex, chapterNavigator]) => {
        setState((current) => ({
          ...current,
          featured: featuredPayload.featured,
          searchIndex,
          chapterNavigator,
          loading: false,
          error: null,
        }));
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: error.message }));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadJSON<FormulaLearningCopyPayload>('/data/formula_learning_copy.json', controller.signal),
      loadJSON<ThemeRoutesPayload>('/data/learning_paths.json', controller.signal),
      loadJSON<StorylinePayload>('/data/storylines.json', controller.signal),
    ])
      .then(([learningCopyPayload, themeRoutesPayload, storylinePayload]) => {
        setState((current) => ({
          ...current,
          formulaLearningCopy: learningCopyPayload.items,
          themeRoutes: themeRoutesPayload.paths,
          storylines: storylinePayload.items,
          supplementalLoading: false,
        }));
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          supplementalLoading: false,
          error: current.error || error.message,
        }));
      });
    return () => controller.abort();
  }, []);

  return state;
}
