import { useEffect, useState } from 'react';
import type { FeaturedFormula, FormulaLearningCopyPayload, SearchFormula, StorylineEntry, StorylinePayload } from '../../shared/types/formula';
import type { ChapterNavigatorPayload, ThemeRoutesPayload } from '../../shared/types/learning';
import type { ConceptSearchResult } from '../../shared/types/search';
import { loadJSON } from '../../shared/utils/loadJSON';

export interface FormulaDataState {
  featured: FeaturedFormula[];
  searchIndex: SearchFormula[];
  conceptIndex: ConceptSearchResult[];
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
    conceptIndex: [],
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
    const conceptIndexRequest = loadJSON<{ items: ConceptSearchResult[] }>('/data/concept_graph/concept_search_index.json', controller.signal).catch((error: Error) => {
      if (error.name === 'AbortError') throw error;
      return { items: [] };
    });
    Promise.all([
      loadJSON<{ featured: FeaturedFormula[] }>('/data/featured_formulas.json', controller.signal),
      loadJSON<SearchFormula[]>('/data/formula_search_index.json', controller.signal),
      loadJSON<ChapterNavigatorPayload>('/data/chapter_navigator.json', controller.signal),
      conceptIndexRequest,
    ])
      .then(([featuredPayload, searchIndex, chapterNavigator, conceptSearchIndex]) => {
        setState((current) => ({
          ...current,
          featured: featuredPayload.featured,
          searchIndex,
          conceptIndex: conceptSearchIndex.items,
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
