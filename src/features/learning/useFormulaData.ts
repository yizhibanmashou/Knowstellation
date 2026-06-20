import { useEffect, useState } from 'react';
import type { FeaturedFormula, FormulaLearningCopyPayload, SearchFormula, StorylineEntry, StorylinePayload } from '../../shared/types/formula';
import type { ChapterNavigatorPayload, ThemeRoutesPayload } from '../../shared/types/learning';
import type { ConceptChapterNavigation, ConceptNavigationEntry, ConceptSearchIndexPayload, ConceptSearchResult } from '../../shared/types/search';
import { loadJSON } from '../../shared/utils/loadJSON';

const FORMULA_ARTIFACT_CONCEPT_RE = /^formula\s+\S+\s+(?:relationship|result|concept)$/i;
const SYMBOL_FRAGMENT_CONCEPT_RE = /(?:\b(?:simeq|frac|left|right|mathrm)\b|simeq|frac|left|right|simmathrm|simleft)/i;
const RAW_SYMBOL_CONCEPT_RE = /^(?:[A-Za-z]|[A-Za-z]_[A-Za-z0-9]+|[A-Za-z]\s+Sub\s+[A-Za-z0-9]+|[A-Za-z]\s+Power\s+[A-Za-z0-9]+)$/i;
const GENERIC_SYMBOL_CONCEPT_RE = /^(?:change|delta|alpha|beta|gamma|pi constant|time|order term|nablaw-bar|d-hat)$/i;

function isSymbolOnlyConcept(value: { title?: string; symbol?: string } = {}): boolean {
  const title = normalizeConceptText(value.title || '');
  const symbol = normalizeConceptText(value.symbol || '');
  const compactSymbol = symbol.replace(/\s+/g, '');
  if (!title) return false;
  if (/^updated\s+/i.test(title)) return true;
  if (RAW_SYMBOL_CONCEPT_RE.test(title)) return true;
  if (SYMBOL_FRAGMENT_CONCEPT_RE.test(title)) return true;
  if (GENERIC_SYMBOL_CONCEPT_RE.test(title)) return true;
  if (/[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/\\(?:left|right|simeq|frac|sum|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|_[A-Za-z0-9]+)$/.test(compactSymbol) && /^(?:[A-Za-z]_|[A-Za-z]\s+Sub\b)/i.test(title)) return true;
  if (/^[A-Za-z](?:\^\{?(?:\\prime|')\}?|')/.test(compactSymbol) && /^updated\b/i.test(title)) return true;
  return false;
}

function isFormulaArtifactConcept(value: { id?: string; concept_id?: string; title?: string; symbol?: string } = {}): boolean {
  const id = String(value.id || '').toLowerCase();
  const conceptId = String(value.concept_id || '').toLowerCase();
  const title = String(value.title || '').trim();
  return conceptId.endsWith('_statement') || id.includes('_statement') || isSymbolOnlyConcept(value) || FORMULA_ARTIFACT_CONCEPT_RE.test(title);
}

function normalizeConceptText(value = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function baseSymbol(symbol = ''): string {
  return String(symbol || '')
    .trim()
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\s+(\\?[A-Za-z])/g, '$1')
    .replace(/\\overline\{([^{}]+)\}/g, '$1')
    .replace(/\\bar\{([^{}]+)\}/g, '$1')
    .replace(/\\widehat\{([^{}]+)\}/g, '$1')
    .replace(/\\hat\{([^{}]+)\}/g, '$1')
    .replace(/_\{[^{}]+\}/g, '')
    .replace(/\^\{[^{}]+\}/g, '')
    .replace(/[{}]/g, '')
    .replace(/^\\/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function conceptMeaningKey(value: { title?: string; symbol?: string; canonical_concept_id?: string } = {}): string {
  if (value.canonical_concept_id) return `canonical:${value.canonical_concept_id}`;
  return `${normalizeConceptText(value.title || '').toLowerCase()}:${baseSymbol(value.symbol || '').toLowerCase()}`;
}

function formulaSortValue(value = ''): number {
  const match = String(value).match(/formula_([A-Za-z]?)(\d+)\.(\d+)([a-z]?)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const appendixOffset = match[1] ? 10_000 : 0;
  return appendixOffset + Number(match[2]) * 1000 + Number(match[3]) + (match[4] ? match[4].charCodeAt(0) / 1000 : 0);
}

function compareConceptItems(left: ConceptSearchResult, right: ConceptSearchResult): number {
  return (
    formulaSortValue(left.formula_id) - formulaSortValue(right.formula_id) ||
    String(left.title || '').localeCompare(String(right.title || ''), undefined, { numeric: true, sensitivity: 'base' }) ||
    String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
  );
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    result.push(next);
  }
  return result;
}

function mergeConceptSearchItems(items: ConceptSearchResult[]): {
  items: ConceptSearchResult[];
  idToRepresentativeId: Map<string, string>;
} {
  const groups = new Map<string, ConceptSearchResult[]>();
  items.forEach((item) => {
    const key = conceptMeaningKey(item) || item.concept_id;
    const current = groups.get(key) || [];
    current.push(item);
    groups.set(key, current);
  });

  const idToRepresentativeId = new Map<string, string>();
  const merged = [...groups.values()].map((group) => {
    const sorted = group.slice().sort(compareConceptItems);
    const representative = sorted[0];
    sorted.forEach((item) => idToRepresentativeId.set(item.concept_id, representative.concept_id));
    return {
      ...representative,
      canonical_concept_id: representative.canonical_concept_id,
      canonical_concept_name: representative.canonical_concept_name,
      aliases: uniqueStrings(sorted.flatMap((item) => item.aliases || [])),
      occurrenceCount: sorted.reduce((sum, item) => sum + (item.occurrenceCount || 1), 0),
      relatedFormulaLabels: uniqueStrings(sorted.flatMap((item) => item.relatedFormulaLabels?.length ? item.relatedFormulaLabels : [item.formula_label])),
      primaryFormulaId: representative.primaryFormulaId || representative.formula_id,
    };
  }).sort(compareConceptItems);

  return { items: merged, idToRepresentativeId };
}

function mergeConceptNavigation(chapters: ConceptChapterNavigation[]): ConceptChapterNavigation[] {
  return (chapters || []).map((chapter) => {
    const validIds = new Set(
      (chapter.concept_navigation || [])
        .filter((entry) => !isFormulaArtifactConcept(entry))
        .map((entry) => entry.concept_id),
    );
    const concept_navigation = (chapter.concept_navigation || [])
      .filter((entry) => validIds.has(entry.concept_id) && !isFormulaArtifactConcept(entry))
      .sort((left, right) => left.depth - right.depth || left.order - right.order || formulaSortValue(left.formula_id) - formulaSortValue(right.formula_id))
      .map((entry, order) => {
      const nextPrerequisites = uniqueStrings((entry.prerequisite_concept_ids || [])
          .filter((conceptId) => conceptId && conceptId !== entry.concept_id && validIds.has(conceptId)));
        return {
          ...entry,
          prerequisite_concept_ids: nextPrerequisites,
          occurrence_count: entry.occurrence_count || 1,
          related_formula_labels: entry.related_formula_labels || (entry.formula_label ? [entry.formula_label] : []),
          order,
        };
      });
    return {
      ...chapter,
      concept_root_ids: concept_navigation
        .filter((entry) => entry.prerequisite_concept_ids.length === 0)
        .map((entry) => entry.concept_id),
      concept_navigation,
    };
  });
}

function sanitizeConceptSearchIndex(payload: ConceptSearchIndexPayload): ConceptSearchIndexPayload {
  const rawItems = (payload.items || []).filter((item) => !isFormulaArtifactConcept(item));
  const { items } = mergeConceptSearchItems(rawItems);
  const chapters = mergeConceptNavigation(payload.chapters || []);
  return { ...payload, items, chapters };
}

export interface FormulaDataState {
  featured: FeaturedFormula[];
  searchIndex: SearchFormula[];
  conceptIndex: ConceptSearchResult[];
  conceptChapters: ConceptChapterNavigation[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  takeawayCache: Record<string, string>;
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
    conceptChapters: [],
    formulaLearningCopy: {},
    takeawayCache: {},
    storylines: [],
    chapterNavigator: { groups: [] },
    themeRoutes: [],
    loading: true,
    supplementalLoading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    const conceptIndexRequest = loadJSON<ConceptSearchIndexPayload>('/data/concept_graph/concept_search_index.json', controller.signal).catch((error: Error) => {
      if (error.name === 'AbortError') throw error;
      return { items: [], chapters: [] };
    });
    Promise.all([
      loadJSON<{ featured: FeaturedFormula[] }>('/data/featured_formulas.json', controller.signal),
      loadJSON<SearchFormula[]>('/data/formula_search_index.json', controller.signal),
      loadJSON<ChapterNavigatorPayload>('/data/chapter_navigator.json', controller.signal),
      conceptIndexRequest,
    ])
      .then(([featuredPayload, searchIndex, chapterNavigator, conceptSearchIndex]) => {
        const sanitizedConceptSearchIndex = sanitizeConceptSearchIndex(conceptSearchIndex);
        setState((current) => ({
          ...current,
          featured: featuredPayload.featured,
          searchIndex,
          conceptIndex: sanitizedConceptSearchIndex.items,
          conceptChapters: sanitizedConceptSearchIndex.chapters || [],
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
      loadJSON<Record<string, string>>('/data/takeaway_cache.json', controller.signal).catch(() => ({})),
    ])
      .then(([learningCopyPayload, themeRoutesPayload, storylinePayload, takeawayCache]) => {
        setState((current) => ({
          ...current,
          formulaLearningCopy: learningCopyPayload.items,
          takeawayCache,
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
