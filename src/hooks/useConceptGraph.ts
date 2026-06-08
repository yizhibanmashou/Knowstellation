import { useCallback, useState } from 'react';
import type { ConceptGraphPayload, ConceptView } from '../types/conceptGraph';
import { loadJSON } from '../utils/loadJSON';

interface ConceptGraphCache {
  chapters: Map<string, ConceptGraphPayload>;
  pending: Map<string, Promise<ConceptGraphPayload>>;
}

const conceptGraphCache: ConceptGraphCache = { chapters: new Map(), pending: new Map() };

export interface ConceptGraphApi {
  loadConceptChapter: (chapterId: string) => Promise<ConceptGraphPayload | null>;
  getConceptView: (chapterId: string, conceptOrFormulaId: string) => Promise<ConceptView | null>;
  getDefaultConceptForFormula: (chapterId: string, formulaId: string) => Promise<ConceptView | null>;
  error: string | null;
}

function rankConceptView(view: ConceptView): number {
  const reviewPenalty = view.review_flags.length ? 0.08 : 0;
  const symbolPenalty = view.defined_symbol === view.supporting_formula_label ? 0.12 : 0;
  const name = view.name.toLowerCase();
  const genericPenalty = /\b(index|variable|count|number of categories|formula .* concept)\b/.test(name) ? 0.1 : 0;
  const coreBonus = /\b(probability|fitness|trait|selection|response|variance|covariance|likelihood|frequency|expectation)\b/.test(name) ? 0.08 : 0;
  return view.confidence + coreBonus - reviewPenalty - symbolPenalty - genericPenalty;
}

function bestViewForFormula(graph: ConceptGraphPayload, formulaId: string): ConceptView | null {
  const candidates = graph.views.filter((view) => view.defined_by_formula_id === formulaId);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => rankConceptView(b) - rankConceptView(a))[0];
}

export function useConceptGraph(): ConceptGraphApi {
  const [error, setError] = useState<string | null>(null);

  const loadConceptChapter = useCallback(async (chapterId: string) => {
    if (!chapterId) return null;
    if (conceptGraphCache.chapters.has(chapterId)) {
      setError(null);
      return conceptGraphCache.chapters.get(chapterId)!;
    }

    let promise = conceptGraphCache.pending.get(chapterId);
    if (!promise) {
      promise = loadJSON<ConceptGraphPayload>(`/data/concept_graph/${chapterId}_concept_graph.json`)
        .then((data) => {
          conceptGraphCache.chapters.set(chapterId, data);
          return data;
        })
        .finally(() => {
          conceptGraphCache.pending.delete(chapterId);
        });
      conceptGraphCache.pending.set(chapterId, promise);
    }

    try {
      const graph = await promise;
      setError(null);
      return graph;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const getConceptView = useCallback(
    async (chapterId: string, conceptOrFormulaId: string) => {
      const graph = await loadConceptChapter(chapterId);
      if (!graph || !conceptOrFormulaId) return null;
      return graph.views.find((view) => view.concept_id === conceptOrFormulaId)
        || bestViewForFormula(graph, conceptOrFormulaId)
        || null;
    },
    [loadConceptChapter],
  );

  const getDefaultConceptForFormula = useCallback(
    async (chapterId: string, formulaId: string) => {
      const graph = await loadConceptChapter(chapterId);
      if (!graph || !formulaId) return null;
      return bestViewForFormula(graph, formulaId);
    },
    [loadConceptChapter],
  );

  return { loadConceptChapter, getConceptView, getDefaultConceptForFormula, error };
}
