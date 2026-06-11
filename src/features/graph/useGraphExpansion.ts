import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { MarkerType, type Edge, type Node, type XYPosition } from '@xyflow/react';
import type { ChapterDependencies, ChapterFormula } from '../../shared/types/formula';
import type { DependencyEdgeData, FormulaExpansionIntent, FormulaNodeData, VariableNodeData } from '../../shared/types/graph';
import { explainPrerequisite } from './formulaInfo';
import { layoutPrerequisites, layoutSuccessors } from './graphLayout';
import { shouldRenderFormulaPrerequisite, shouldRenderVariablePrerequisite } from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';

const MAX_VISIBLE_SUCCESSORS = 5;

export type GuidedExpansionStage = 'none' | 'concepts' | 'successors';

interface UseGraphExpansionParams {
  canUseFormula: (formulaId: string) => boolean;
  focusChapterId: string;
  focusFormulaId: string;
  guidedUnlock: boolean;
  guidedStages: Record<string, GuidedExpansionStage>;
  loadChapter: (chapterId: string) => Promise<ChapterDependencies | null | undefined>;
  makeFormulaNode: (
    formula: ChapterFormula,
    position: XYPosition,
    focused?: boolean,
    role?: FormulaNodeData['role'],
    chapter?: ChapterDependencies | null,
  ) => Node;
  markExpanded: (formulaId: string) => void;
  markLearned: (chapterId: string, formulaId: string) => void;
  mode: GraphStudyMode;
  nodesRef: MutableRefObject<Node[]>;
  refreshNodeData: (items: Node[], chapter?: ChapterDependencies | null) => Node[];
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setGuidedStages: Dispatch<SetStateAction<Record<string, GuidedExpansionStage>>>;
  setNodeLoading: (id: string, loading: boolean) => void;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setShowHint: Dispatch<SetStateAction<boolean>>;
  setStandaloneFocusId: Dispatch<SetStateAction<string | null>>;
  fitAfterExpand: () => void;
}

export function useGraphExpansion({
  canUseFormula,
  focusChapterId,
  focusFormulaId,
  guidedUnlock,
  guidedStages,
  loadChapter,
  makeFormulaNode,
  markExpanded,
  markLearned,
  mode,
  nodesRef,
  refreshNodeData,
  setEdges,
  setGuidedStages,
  setNodeLoading,
  setNodes,
  setShowHint,
  setStandaloneFocusId,
  fitAfterExpand,
}: UseGraphExpansionParams) {
  return useCallback(
    async (formulaId: string, intent: FormulaExpansionIntent = 'auto') => {
      if (!canUseFormula(formulaId)) return;
      const initialParent = nodesRef.current.find((node) => node.id === formulaId);
      if (!initialParent) return;

      setNodeLoading(formulaId, true);
      try {
        const chapter = await loadChapter(focusChapterId);
        const dependency = chapter?.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
        const currentFormula = chapter?.formulas.find((item) => item.id === formulaId);

        const dependents = (chapter?.dependencies || []).filter((dep) =>
          dep.prerequisites.some((prereq) => shouldRenderFormulaPrerequisite(prereq) && prereq.target_id === formulaId && !prereq.cross_chapter),
        );
        if (formulaId === focusFormulaId) setStandaloneFocusId(dependents.length === 0 ? formulaId : null);

        const currentStage = guidedStages[formulaId] || 'none';
        const shouldShowConcepts = intent === 'prerequisites' || (intent === 'auto' && (mode !== 'guided' || currentStage === 'none'));
        const shouldShowSuccessors = intent === 'successors' || (intent === 'auto' && (mode !== 'guided' || currentStage !== 'none'));
        const shownDependents = shouldShowSuccessors ? dependents.slice(0, MAX_VISIBLE_SUCCESSORS) : [];
        const successorFormulas = new Map<string, ChapterFormula>();
        shownDependents.forEach((dep) => {
          const formula = chapter?.formulas.find((item) => item.id === dep.dependent_id);
          if (formula) successorFormulas.set(dep.dependent_id, formula);
        });

        setNodes((currentNodes) => {
          const parent = currentNodes.find((node) => node.id === formulaId);
          if (!parent) return currentNodes;
          const nextNodes = [...currentNodes];

          if (shouldShowConcepts) {
            const allPrereqs = (dependency?.prerequisites || []).filter((item) =>
              shouldRenderVariablePrerequisite(item) || shouldRenderFormulaPrerequisite(item)
            );
            const positions = layoutPrerequisites(parent, allPrereqs, nextNodes);
            allPrereqs.forEach((prereq, index) => {
              if (prereq.type === 'variable_definition') {
                const conceptId = `${formulaId}::var::${prereq.symbol}`;
                if (!nextNodes.some((item) => item.id === conceptId)) {
                  nextNodes.push({
                    id: conceptId,
                    type: 'variableDefinition',
                    position: positions[index],
                    data: { prerequisite: prereq, formulaId, formulaLatex: currentFormula?.latex || '' } satisfies VariableNodeData,
                    draggable: false,
                    selectable: false,
                  });
                }
              } else if (prereq.type === 'formula' && prereq.target_id) {
                const prereqFormula = chapter?.formulas.find((item) => item.id === prereq.target_id);
                if (prereqFormula && !nextNodes.some((item) => item.id === prereqFormula.id)) {
                  nextNodes.push(makeFormulaNode(prereqFormula, positions[index], false, 'prerequisite', chapter));
                }
              }
            });
          }

          const positions = layoutSuccessors(parent, successorFormulas.size, nextNodes);
          [...successorFormulas.values()].forEach((formula, index) => {
            if (nextNodes.some((node) => node.id === formula.id)) return;
            nextNodes.push(makeFormulaNode(formula, positions[index], false, 'successor', chapter));
          });
          return refreshNodeData(nextNodes, chapter);
        });

        setEdges((currentEdges) => {
          const nextEdges = [...currentEdges];
          if (shouldShowConcepts) {
            (dependency?.prerequisites || []).forEach((prereq) => {
              if (shouldRenderVariablePrerequisite(prereq)) {
                const sourceId = `${formulaId}::var::${prereq.symbol}`;
                const edgeId = `${sourceId}->${formulaId}`;
                if (nextEdges.some((edge) => edge.id === edgeId)) return;
                nextEdges.push({
                  id: edgeId,
                  source: sourceId,
                  target: formulaId,
                  type: 'dependency',
                  data: {
                    via: prereq.symbol || 'concept',
                    crossChapter: false,
                    confidence: prereq.confidence,
                    explanation: explainPrerequisite(prereq),
                  } satisfies DependencyEdgeData,
                });
              } else if (shouldRenderFormulaPrerequisite(prereq) && prereq.target_id) {
                const edgeId = `${prereq.target_id}->${formulaId}`;
                if (nextEdges.some((edge) => edge.id === edgeId)) return;
                nextEdges.push({
                  id: edgeId,
                  source: prereq.target_id,
                  target: formulaId,
                  type: 'dependency',
                  markerEnd: { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
                  data: {
                    via: prereq.via_symbol || 'uses',
                    crossChapter: Boolean(prereq.cross_chapter),
                    confidence: prereq.confidence || 0.8,
                    explanation: explainPrerequisite(prereq),
                  } satisfies DependencyEdgeData,
                });
              }
            });
          }
          shownDependents.forEach((dep) => {
            const prereq = dep.prerequisites.find((item) => shouldRenderFormulaPrerequisite(item) && item.target_id === formulaId);
            const edgeId = `${formulaId}->${dep.dependent_id}`;
            if (nextEdges.some((edge) => edge.id === edgeId)) return;
            nextEdges.push({
              id: edgeId,
              source: formulaId,
              target: dep.dependent_id,
              type: 'dependency',
              markerEnd: { type: MarkerType.ArrowClosed, color: '#e2e8f0' },
              data: {
                via: prereq?.via_symbol || 'next',
                crossChapter: false,
                confidence: prereq?.confidence || 0.8,
                explanation: prereq ? explainPrerequisite(prereq) : '这条公式接在当前公式之后，用来继续推进同一段推导。',
              } satisfies DependencyEdgeData,
            });
          });
          return nextEdges;
        });

        if (guidedUnlock) markLearned(focusChapterId, formulaId);
        if (mode === 'guided') {
          setGuidedStages((current) => ({
            ...current,
            [formulaId]: shouldShowSuccessors ? 'successors' : 'concepts',
          }));
        }
        markExpanded(formulaId);
        setShowHint(false);
        fitAfterExpand();
      } finally {
        setNodeLoading(formulaId, false);
      }
    },
    [
      canUseFormula,
      fitAfterExpand,
      focusChapterId,
      focusFormulaId,
      guidedStages,
      guidedUnlock,
      loadChapter,
      makeFormulaNode,
      markExpanded,
      markLearned,
      mode,
      nodesRef,
      refreshNodeData,
      setEdges,
      setGuidedStages,
      setNodeLoading,
      setNodes,
      setShowHint,
      setStandaloneFocusId,
    ],
  );
}
