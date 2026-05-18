import { useEffect, useState } from 'react';
import type { FeaturedFormula, SearchFormula } from '../types/formula';
import type { LearningPathsPayload } from '../types/path';
import { loadJSON } from '../utils/loadJSON';

export interface FormulaDataState {
  featured: FeaturedFormula[];
  searchIndex: SearchFormula[];
  paths: LearningPathsPayload['paths'];
  loading: boolean;
  error: string | null;
}

export function useFormulaData(): FormulaDataState {
  const [state, setState] = useState<FormulaDataState>({
    featured: [],
    searchIndex: [],
    paths: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadJSON<{ featured: FeaturedFormula[] }>('/data/featured_formulas.json', controller.signal),
      loadJSON<SearchFormula[]>('/data/formula_search_index.json', controller.signal),
      loadJSON<LearningPathsPayload>('/data/learning_paths.json', controller.signal),
    ])
      .then(([featuredPayload, searchIndex, pathsPayload]) => {
        setState({
          featured: featuredPayload.featured,
          searchIndex,
          paths: pathsPayload.paths,
          loading: false,
          error: null,
        });
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, []);

  return state;
}
