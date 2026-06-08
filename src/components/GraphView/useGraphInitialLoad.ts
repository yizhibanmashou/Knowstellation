import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { MarkerType, type Edge, type Node, type XYPosition } from '@xyflow/react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { ChapterDependencies, ChapterFormula, FormulaDependency } from '../../types/formula';
import type { DependencyEdgeData, FormulaNodeData } from '../../types/graph';
import { rawFormulaNumber } from '../../utils/constants';
import type { FocusAnnotationNote } from '../../utils/focusAnnotations';
import { explainPrerequisite } from '../../utils/formulaInfo';
import { formatChapterLabel, type getUiCopy } from '../../utils/uiCopy';
import { buildVariableEdges, buildVariableNodes, buildFocusSymbolPrerequisites, isChapterStarterFormula, markSelectedFormulaNode, shouldRenderFormulaPrerequisite } from './graphCanvasModel';
import { chapterGraphBounds, layoutChapterGraph } from './graphLayout';
import type { GraphStudyMode } from './GraphModeControls';
import type { GuidedExpansionStage } from './useGraphExpansion';

const MAX_STARTER_VARIABLES = 4;

type MakeStaticFormulaNode = (
  formula: ChapterFormula,
  position: XYPosition,
  focused?: boolean,
  role?: FormulaNodeData['role'],
  symbolExplanations?: FocusAnnotationNote[],
  chapterGraph?: boolean,
) => Node;

interface UseGraphInitialLoadParams {
  autoExpandedFocusRef: MutableRefObject<string | null>;
  copy: ReturnType<typeof getUiCopy>['graph'];
  disabled?: boolean;
  focusChapterId: string;
  focusFormulaId: string;
  isChapterGraph: boolean;
  loadChapter: (chapterId: string) => Promise<ChapterDependencies | null | undefined>;
  makeStaticFormulaNode: MakeStaticFormulaNode;
  mode: GraphStudyMode;
  reactFlow: ReactFlowInstance;
  routeSelectedFormulaId: string | null;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setGraphNotice: Dispatch<SetStateAction<string | null>>;
  setGuidedStages: Dispatch<SetStateAction<Record<string, GuidedExpansionStage>>>;
  setLoadingIds: Dispatch<SetStateAction<Set<string>>>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setSelectedFormulaId: Dispatch<SetStateAction<string | null>>;
  setShowHint: Dispatch<SetStateAction<boolean>>;
  setStandaloneFocusId: Dispatch<SetStateAction<string | null>>;
}

function buildChapterGraphEdges(chapter: ChapterDependencies): Edge[] {
  const formulaIds = new Set(chapter.formulas.map((formula) => formula.id));
  const graphEdges: Edge[] = [];
  chapter.dependencies.forEach((dependency) => {
    dependency.prerequisites.forEach((prereq) => {
      if (!shouldRenderFormulaPrerequisite(prereq) || !prereq.target_id || !formulaIds.has(prereq.target_id) || !formulaIds.has(dependency.dependent_id)) return;
      const edgeId = `${prereq.target_id}->${dependency.dependent_id}`;
      if (graphEdges.some((edge) => edge.id === edgeId)) return;
      graphEdges.push({
        id: edgeId,
        source: prereq.target_id,
        target: dependency.dependent_id,
        type: 'dependency',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
        data: {
          via: prereq.via_symbol || 'uses',
          crossChapter: false,
          confidence: prereq.confidence || 0.8,
          explanation: explainPrerequisite(prereq),
        } satisfies DependencyEdgeData,
      });
    });
  });
  return graphEdges;
}

export function useGraphInitialLoad({
  autoExpandedFocusRef,
  copy,
  disabled = false,
  focusChapterId,
  focusFormulaId,
  isChapterGraph,
  loadChapter,
  makeStaticFormulaNode,
  mode,
  reactFlow,
  routeSelectedFormulaId,
  setEdges,
  setGraphNotice,
  setGuidedStages,
  setLoadingIds,
  setNodes,
  setSelectedFormulaId,
  setShowHint,
  setStandaloneFocusId,
}: UseGraphInitialLoadParams) {
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    setNodes([]);
    setEdges([]);
    setGraphNotice(null);
    setGuidedStages({});
    setLoadingIds(new Set());
    setStandaloneFocusId(null);
    setSelectedFormulaId(focusFormulaId || null);
    autoExpandedFocusRef.current = null;

    if (isChapterGraph) {
      loadChapter(focusChapterId).then((chapter) => {
        if (cancelled || !chapter) return;
        if (!chapter.formulas.length) {
          setGraphNotice(`${copy.emptyChapter} ${formatChapterLabel(focusChapterId)}`);
          return;
        }
        const positions = layoutChapterGraph(chapter.formulas, chapter.dependencies);
        const formulaNodes = chapter.formulas.map((formula) => makeStaticFormulaNode(formula, positions.get(formula.id) || { x: 120, y: 96 }, false, 'expanded', [], true));
        const graphEdges = buildChapterGraphEdges(chapter);
        const requestedFormulaId = routeSelectedFormulaId && chapter.formulas.some((formula) => formula.id === routeSelectedFormulaId)
          ? routeSelectedFormulaId
          : chapter.formulas[0]?.id || null;
        setNodes(markSelectedFormulaNode(formulaNodes, requestedFormulaId));
        setEdges(graphEdges);
        setSelectedFormulaId(requestedFormulaId);
        setShowHint(false);
        const firstNode = formulaNodes.find((node) => node.id === requestedFormulaId) || formulaNodes[0];
        window.setTimeout(() => {
          if (firstNode) {
            reactFlow.setCenter(firstNode.position.x + 134, firstNode.position.y + 78, { zoom: 0.66, duration: 650 });
          } else {
            const bounds = chapterGraphBounds(chapter.formulas.length);
            reactFlow.fitView({ padding: 0.18, duration: 650, minZoom: bounds.minZoom, maxZoom: 0.82 });
          }
        }, 80);
      });
      return () => {
        cancelled = true;
      };
    }
    if (!focusFormulaId) return;

    loadChapter(focusChapterId).then((chapter) => {
      if (!chapter) {
        if (!cancelled) setGraphNotice(`${copy.dataError} ${formatChapterLabel(focusChapterId)}`);
        return;
      }
      const formula = chapter?.formulas.find((item) => item.id === focusFormulaId);
      if (cancelled) return;
      if (!formula) {
        setGraphNotice(`${copy.missingFormula} ${rawFormulaNumber(focusFormulaId)} · ${formatChapterLabel(focusChapterId)}`);
        return;
      }
      const dependency: FormulaDependency | null = chapter.dependencies.find((dep) => dep.dependent_id === focusFormulaId) || null;
      const focusSymbolExplanations = buildFocusSymbolPrerequisites(formula, dependency);
      const symbolExplanations = mode === 'guided' ? focusSymbolExplanations : [];
      const formulaNode = makeStaticFormulaNode(formula, { x: 260, y: 280 }, true, 'focus', symbolExplanations);
      if (isChapterStarterFormula(formula, dependency)) {
        const starterVariables = focusSymbolExplanations.slice(0, MAX_STARTER_VARIABLES);
        setNodes([formulaNode, ...buildVariableNodes(focusFormulaId, formulaNode, starterVariables, [formulaNode])]);
        setEdges(buildVariableEdges(focusFormulaId, starterVariables));
      } else {
        setNodes([formulaNode]);
        setEdges([]);
      }
      window.setTimeout(() => {
        reactFlow.fitView({ padding: 0.35, duration: 500, maxZoom: 1.08 });
      }, 60);
    });

    return () => {
      cancelled = true;
    };
  }, [
    autoExpandedFocusRef,
    copy.dataError,
    copy.emptyChapter,
    copy.missingFormula,
    disabled,
    focusChapterId,
    focusFormulaId,
    isChapterGraph,
    loadChapter,
    makeStaticFormulaNode,
    mode,
    reactFlow,
    routeSelectedFormulaId,
    setEdges,
    setGraphNotice,
    setGuidedStages,
    setLoadingIds,
    setNodes,
    setSelectedFormulaId,
    setShowHint,
    setStandaloneFocusId,
  ]);
}
