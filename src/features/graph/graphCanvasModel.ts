import type { Edge, Node } from '@xyflow/react';
import type { ChapterFormula, FormulaDependency, FormulaPrerequisite, SearchFormula } from '../../shared/types/formula';
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
    const key = `${item.kind || 'symbol'}:${item.symbol || item.via_symbol || item.meaning || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
