import { useCallback, useState } from 'react';
import type { ConceptGraphPayload, ConceptReference, ConceptView, ConceptViewEdge } from '../../shared/types/conceptGraph';
import { loadJSON } from '../../shared/utils/loadJSON';

interface ConceptGraphCache {
  chapters: Map<string, ConceptGraphPayload>;
  pending: Map<string, Promise<ConceptGraphPayload>>;
}

const conceptGraphCache: ConceptGraphCache = { chapters: new Map(), pending: new Map() };

const FORMULA_ARTIFACT_CONCEPT_RE = /^formula\s+\S+\s+(?:relationship|result|concept)$/i;
const SYMBOL_FRAGMENT_CONCEPT_RE = /(?:\b(?:simeq|frac|left|right|mathrm)\b|simeq|frac|left|right|simmathrm|simleft)/i;
const RAW_SYMBOL_CONCEPT_RE = /^(?:[A-Za-z]|[A-Za-z]_[A-Za-z0-9]+|[A-Za-z]\s+Sub\s+[A-Za-z0-9]+|[A-Za-z]\s+Power\s+[A-Za-z0-9]+)$/i;
const GENERIC_SYMBOL_CONCEPT_RE = /^(?:pi constant|order term|nablaw-bar|d-hat)$/i;

function isSymbolOnlyConcept(value: { name?: string; title?: string; defined_symbol?: string; symbol?: string } = {}): boolean {
  const name = normalizeConceptText(value.name || value.title || '');
  const symbol = normalizeConceptText(value.defined_symbol || value.symbol || '');
  const compactSymbol = symbol.replace(/\s+/g, '');
  if (!name) return false;
  if (/^updated\s+/i.test(name)) return true;
  if (RAW_SYMBOL_CONCEPT_RE.test(name)) return true;
  if (SYMBOL_FRAGMENT_CONCEPT_RE.test(name)) return true;
  if (GENERIC_SYMBOL_CONCEPT_RE.test(name)) return true;
  if (/[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/\\(?:left|right|simeq|frac|sum|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|_[A-Za-z0-9]+)$/.test(compactSymbol) && /^(?:[A-Za-z]_|[A-Za-z]\s+Sub\b)/i.test(name)) return true;
  if (/^[A-Za-z](?:\^\{?(?:\\prime|')\}?|')/.test(compactSymbol) && /^updated\b/i.test(name)) return true;
  return false;
}

function isFormulaArtifactConcept(value: { concept_id?: string; name?: string; title?: string; defined_symbol?: string; symbol?: string; concept_type?: string } = {}): boolean {
  const conceptId = String(value.concept_id || '').toLowerCase();
  const name = String(value.name || value.title || '').trim();
  const symbol = String(value.defined_symbol || value.symbol || '').trim();
  const type = String(value.concept_type || '').toLowerCase();
  return (
    conceptId.endsWith('_statement') ||
    type === 'formula_evidence_view' ||
    type === 'formula_symbol' ||
    isSymbolOnlyConcept(value) ||
    FORMULA_ARTIFACT_CONCEPT_RE.test(name) ||
    (/^formula\s+\S+$/i.test(symbol) && /relationship|result/i.test(name))
  );
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

function conceptMeaningKey(value: { name?: string; title?: string; defined_symbol?: string; symbol?: string; via_symbol?: string } = {}): string {
  return `${normalizeConceptText(value.name || value.title || '').toLowerCase()}:${baseSymbol(value.defined_symbol || value.symbol || value.via_symbol || '').toLowerCase()}`;
}

function isSameConceptMeaning(left: Parameters<typeof conceptMeaningKey>[0], right: Parameters<typeof conceptMeaningKey>[0]): boolean {
  const leftKey = conceptMeaningKey(left);
  const rightKey = conceptMeaningKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function isSameConceptView(reference: ConceptReference, currentView?: ConceptView): boolean {
  if (!currentView) return false;
  if (reference.view_id && currentView.view_id) return reference.view_id === currentView.view_id;
  const referenceFormulaId = reference.defined_by_formula_id || reference.from_formula_id || '';
  if (reference.concept_id && currentView.concept_id && reference.concept_id === currentView.concept_id) {
    return Boolean(referenceFormulaId && referenceFormulaId === currentView.defined_by_formula_id);
  }
  if (referenceFormulaId && referenceFormulaId !== currentView.defined_by_formula_id) return false;
  return isSameConceptMeaning(reference, currentView);
}

function isFormulaReferenceText(value = ''): boolean {
  return /^(?:equation|formula)\s+[A-Za-z]?\d+(?:\.\d+)?[a-z]?$/i.test(normalizeConceptText(value));
}

function isFormulaReferenceDependency(value: ConceptReference | ConceptViewEdge): boolean {
  const record = value as ConceptReference & ConceptViewEdge;
  return normalizeConceptText(record.relation || '') === 'explicit_reference'
    || isFormulaReferenceText(record.via_symbol)
    || isFormulaReferenceText(record.derived_from_formula_edge?.via_symbol);
}

function mergeConceptReference(existing: ConceptReference, incoming: ConceptReference): ConceptReference {
  return {
    ...existing,
    definition: existing.definition || incoming.definition,
    definition_zh: existing.definition_zh || incoming.definition_zh,
    confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
    prerequisite_concepts: existing.prerequisite_concepts?.length ? existing.prerequisite_concepts : incoming.prerequisite_concepts,
    introduced_concepts: existing.introduced_concepts?.length ? existing.introduced_concepts : incoming.introduced_concepts,
  };
}

function sanitizeConceptReferences(references: ConceptReference[] = [], currentView?: ConceptView): ConceptReference[] {
  const byKey = new Map<string, ConceptReference>();
  references
    .filter((reference) => !isFormulaArtifactConcept(reference) && !isFormulaReferenceDependency(reference))
    .filter((reference) => !currentView || !isSameConceptView(reference, currentView))
    .forEach((reference) => {
      const key = conceptMeaningKey(reference) || reference.concept_id;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeConceptReference(existing, reference) : reference);
    });
  return [...byKey.values()].map((reference) => ({
    ...reference,
    prerequisite_concepts: sanitizeConceptReferences(reference.prerequisite_concepts || [], currentView),
    introduced_concepts: (reference.introduced_concepts || []).filter((item) => !isFormulaArtifactConcept(item) && !isFormulaReferenceDependency(item)),
  }));
}

function sanitizeConceptGraphPayload(data: ConceptGraphPayload): ConceptGraphPayload {
  const views = (data.views || []).filter((view) => !isFormulaArtifactConcept(view));
  const validIds = new Set(views.map((view) => view.concept_id));
  const validEdgeIds = new Set(views.flatMap((view) => [view.concept_id, view.view_id].filter(Boolean) as string[]));
  return {
    ...data,
    views: views.map((view) => ({
      ...view,
      prerequisite_concepts: sanitizeConceptReferences(view.prerequisite_concepts || [], view)
        .filter((reference) => validIds.has(reference.concept_id)),
      successor_concepts: sanitizeConceptReferences(view.successor_concepts || [], view)
        .filter((reference) => validIds.has(reference.concept_id)),
      introduced_concepts: sanitizeConceptReferences(view.introduced_concepts || [], view),
      edges: (view.edges || []).filter((edge) => (
        edge.relation !== 'introduced_for'
        && validEdgeIds.has(edge.from)
        && validEdgeIds.has(edge.to)
        && edge.from !== edge.to
        && !isFormulaReferenceDependency(edge)
      )),
    })),
  };
}

export interface ConceptGraphApi {
  loadConceptChapter: (chapterId: string) => Promise<ConceptGraphPayload | null>;
  getConceptView: (chapterId: string, conceptOrFormulaId: string) => Promise<ConceptView | null>;
  getDefaultConceptForFormula: (chapterId: string, formulaId: string) => Promise<ConceptView | null>;
  error: string | null;
}

function rankConceptView(view: ConceptView): number {
  const symbolPenalty = view.defined_symbol === view.supporting_formula_label ? 0.12 : 0;
  const name = view.name.toLowerCase();
  const genericPenalty = /\b(index|variable|count|number of categories|formula .* concept)\b/.test(name) ? 0.1 : 0;
  const coreBonus = /\b(probability|fitness|trait|selection|response|variance|covariance|likelihood|frequency|expectation)\b/.test(name) ? 0.08 : 0;
  return view.confidence + coreBonus - symbolPenalty - genericPenalty;
}

function bestViewForFormula(graph: ConceptGraphPayload, formulaId: string): ConceptView | null {
  const candidates = graph.views.filter(
    (view) => view.defined_by_formula_id === formulaId || (view.formula_references || []).some((reference) => reference.formula_id === formulaId),
  );
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
          const sanitized = sanitizeConceptGraphPayload(data);
          conceptGraphCache.chapters.set(chapterId, sanitized);
          return sanitized;
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
      return graph.views.find((view) => view.view_id === conceptOrFormulaId)
        || graph.views.find((view) => view.concept_id === conceptOrFormulaId)
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
