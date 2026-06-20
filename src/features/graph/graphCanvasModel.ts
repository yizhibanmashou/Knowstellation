import type { Edge, Node } from '@xyflow/react';
import type { ChapterFormula, FormulaDependency, FormulaPrerequisite, SearchFormula } from '../../shared/types/formula';
import type { ConceptGraphPayload, ConceptReference, ConceptView } from '../../shared/types/conceptGraph';
import type { DependencyEdgeData, VariableNodeData } from '../../shared/types/graph';
import { buildCompoundFocusAnnotations, buildFormulaWideFocusAnnotation, type FocusAnnotationNote } from './focusAnnotations.ts';
import { buildFormulaSymbolPrerequisites, explainPrerequisite } from './formulaInfo.ts';
import { layoutPrerequisites } from './graphLayout.ts';

const NON_TEACHING_SYMBOLS = new Set(['\\pi', '\\infty']);

export type GuidedSymbolNote = FocusAnnotationNote;

export function isTeachingVariableSymbol(symbol?: string): boolean {
  return Boolean(symbol) && !NON_TEACHING_SYMBOLS.has(String(symbol));
}

export function shouldRenderVariablePrerequisite(prereq: FormulaPrerequisite): boolean {
  return prereq.type === 'variable_definition' && (prereq.edge_status ?? 'accepted') === 'accepted' && isTeachingVariableSymbol(prereq.symbol);
}

export function shouldRenderFormulaPrerequisite(prereq: FormulaPrerequisite): boolean {
  return prereq.type === 'formula' && (prereq.edge_status ?? 'accepted') === 'accepted';
}

function hasSameChapterFormulaPrerequisite(dependency: FormulaDependency | null): boolean {
  return Boolean(
    dependency?.prerequisites.some(
      (prereq) => shouldRenderFormulaPrerequisite(prereq) && !prereq.cross_chapter,
    ),
  );
}

export function isChapterStarterFormula(formula: ChapterFormula, dependency: FormulaDependency | null): boolean {
  return Number(formula.depth ?? 0) <= 0 && !hasSameChapterFormulaPrerequisite(dependency);
}

export function chapterIdForFormula(formulaId: string, searchLookup: Map<string, SearchFormula>): string {
  return searchLookup.get(formulaId)?.chapter_id || '';
}

function dedupeFocusAnnotations(items: FocusAnnotationNote[]): FocusAnnotationNote[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind || 'symbol'}:${focusAnnotationExactKey(item.target || item.symbol || item.via_symbol || item.meaning || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function focusAnnotationExactKey(value = ''): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathrm|mathit|mathsf)\{([^{}]+)\}/g, '$1')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\^\{([^{}]+)\}/g, '^$1')
    .replace(/[{}]/g, '');
}

function crossFormulaSymbolKey(value = ''): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/\\bar\{/g, '\\overline{')
    .replace(/\\widehat\{/g, '\\hat{')
    .replace(/\\widetilde\{/g, '\\tilde{')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathrm|mathit|mathsf)\{([^{}]+)\}/g, '$1')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\^\{([^{}]+)\}/g, '^$1')
    .replace(/[{}]/g, '');
}

function isSimpleCrossFormulaSymbol(value = ''): boolean {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact) return false;
  return !/[=+\-*/(),;|[\]]/.test(compact) &&
    !/\\(?:frac|dfrac|tfrac|sum|prod|int|left|right|begin|end)\b/.test(compact);
}

function formulaSymbolKeyMap(formula?: ChapterFormula | null): Map<string, string> {
  const symbols = [
    ...(formula?.symbols_defined || []),
    ...(formula?.symbols_used || []),
  ];
  const keys = new Map<string, string>();
  symbols.forEach((symbol) => {
    if (!isSimpleCrossFormulaSymbol(symbol)) return;
    const key = crossFormulaSymbolKey(symbol);
    if (key && !keys.has(key)) keys.set(key, symbol);
  });
  return keys;
}

export function buildFocusSymbolPrerequisites(formula?: ChapterFormula | null, dependency?: FormulaDependency | null): FocusAnnotationNote[] {
  const variablePrerequisites = (dependency?.prerequisites || []).filter(shouldRenderVariablePrerequisite);
  const symbolPrerequisites = [...variablePrerequisites, ...buildFormulaSymbolPrerequisites(formula || undefined)].map((item) => ({
    ...item,
    kind: 'symbol' as const,
  }));
  const formulaWideAnnotation = buildFormulaWideFocusAnnotation(formula);
  return dedupeFocusAnnotations([
    ...buildCompoundFocusAnnotations(formula),
    ...symbolPrerequisites,
    ...(formulaWideAnnotation ? [formulaWideAnnotation] : []),
  ]);
}

export function buildConceptBackedFocusSymbolPrerequisites(
  formula?: ChapterFormula | null,
  dependency?: FormulaDependency | null,
  conceptGraph?: ConceptGraphPayload | null,
): FocusAnnotationNote[] {
  const fallbackNotes = buildFocusSymbolPrerequisites(formula, dependency);
  if (!formula || !conceptGraph?.views?.length) return fallbackNotes;

  const symbolKeys = formulaSymbolKeyMap(formula);
  const conceptNotes = [
    ...viewsForFormula(conceptGraph, formula.id).map((view) => ({ view, symbol: undefined, includeReferences: true })),
    ...viewsForFormulaSymbols(conceptGraph, symbolKeys, formula.id).map((item) => ({ ...item, includeReferences: false })),
  ].flatMap(({ view, symbol, includeReferences }) => [
    conceptViewToFocusAnnotation(view, 'defined', symbol),
    ...(includeReferences ? (view.introduced_concepts || []).map((reference) => conceptReferenceToFocusAnnotation(reference, view)) : []),
    ...(includeReferences ? (view.prerequisite_concepts || []).map((reference) => conceptReferenceToFocusAnnotation(reference, view)) : []),
  ]).filter((item): item is FocusAnnotationNote => Boolean(item));

  if (conceptNotes.length) {
    return dedupeFocusAnnotations([
      ...conceptNotes,
      ...fallbackNotes,
    ]);
  }

  return dedupeFocusAnnotations([
    ...buildCompoundFocusAnnotations(formula),
    ...fallbackNotes,
  ]);
}

function viewsForFormula(conceptGraph: ConceptGraphPayload, formulaId: string): ConceptView[] {
  return (conceptGraph.views || [])
    .filter((view) => view.defined_by_formula_id === formulaId)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function viewsForFormulaSymbols(conceptGraph: ConceptGraphPayload, symbolKeys: Map<string, string>, formulaId: string): Array<{ view: ConceptView; symbol?: string }> {
  if (!symbolKeys.size) return [];
  return (conceptGraph.views || [])
    .map((view) => {
      if (!view.defined_symbol || view.defined_by_formula_id === formulaId || !isSimpleCrossFormulaSymbol(view.defined_symbol)) return false;
      const formulaSymbol = symbolKeys.get(crossFormulaSymbolKey(view.defined_symbol));
      return formulaSymbol ? { view, symbol: formulaSymbol } : false;
    })
    .filter((item): item is { view: ConceptView; symbol: string } => Boolean(item))
    .sort((a, b) => Number(b.view.confidence || 0) - Number(a.view.confidence || 0));
}

function conceptViewToFocusAnnotation(view: ConceptView, role: 'defined' | 'used', matchedFormulaSymbol?: string): FocusAnnotationNote | null {
  const symbol = clean(matchedFormulaSymbol || view.defined_symbol);
  const definition = conceptDefinition(view);
  if (!symbol || !definition || !isTeachingVariableSymbol(symbol)) return null;
  return {
    type: 'variable_definition',
    symbol,
    meaning: definition,
    definition,
    source: 'concept_graph',
    source_excerpt: view.source_sentence,
    confidence: view.confidence,
    edge_status: 'accepted',
    concept_id: view.concept_id,
    symbol_role: role,
    kind: 'symbol',
    shortLabel: view.name,
    llmText: definition,
    llmStatus: 'ready',
    target: matchedFormulaSymbol || undefined,
  } as FocusAnnotationNote;
}

function conceptReferenceToFocusAnnotation(reference: ConceptReference, parent: ConceptView): FocusAnnotationNote | null {
  const symbol = clean(reference.symbol || reference.via_symbol);
  const definition = conceptDefinition(reference);
  if (!symbol || !definition || !isTeachingVariableSymbol(symbol)) return null;
  return {
    type: 'variable_definition',
    symbol,
    meaning: definition,
    definition,
    source: 'concept_graph',
    source_excerpt: reference.source_sentence || parent.source_sentence,
    confidence: reference.confidence,
    edge_status: 'accepted',
    concept_id: reference.concept_id,
    symbol_role: 'used',
    kind: 'symbol',
    shortLabel: reference.name,
    llmText: definition,
    llmStatus: 'ready',
  } as FocusAnnotationNote;
}

function conceptDefinition(value: Pick<ConceptView | ConceptReference, 'definition' | 'definition_zh' | 'name'>): string {
  return clean(value.definition_zh || value.definition || value.name);
}

function clean(value = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function markSelectedFormulaNode(items: Node[], formulaId: string | null): Node[] {
  return items.map((node) => (node.type === 'formula' ? { ...node, selected: Boolean(formulaId && node.id === formulaId) } : node));
}

export function buildVariableNodes(formulaId: string, parent: Node, variables: FormulaPrerequisite[], baseNodes: Node[]): Node[] {
  const positions = layoutPrerequisites(parent, variables, baseNodes);
  return variables.map((prereq, index) => ({
    id: `${formulaId}::var::${prereq.symbol}`,
    type: 'variableDefinition',
    position: positions[index],
    data: {
      prerequisite: prereq,
    } satisfies VariableNodeData,
    draggable: false,
    selectable: false,
  })) satisfies Node[];
}

export function buildVariableEdges(formulaId: string, variables: FormulaPrerequisite[]): Edge[] {
  return variables.map((prereq) => ({
    id: `${formulaId}::var::${prereq.symbol}->${formulaId}`,
    source: `${formulaId}::var::${prereq.symbol}`,
    target: formulaId,
    type: 'dependency',
    data: {
      via: prereq.symbol || 'concept',
      crossChapter: false,
      confidence: prereq.confidence,
      explanation: explainPrerequisite(prereq),
    } satisfies DependencyEdgeData,
  })) satisfies Edge[];
}
