import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { ChapterDependencies } from '../../shared/types/formula';
import type { ConceptGraphPayload } from '../../shared/types/conceptGraph';
import type { FormulaNodeData } from '../../shared/types/graph';
import { buildConceptBackedFocusSymbolPrerequisites, type GuidedSymbolNote } from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';

interface GuidedSymbolOptions {
  center?: boolean;
}

interface UseGuidedSymbolExplanationsParams {
  isChapterGraph: boolean;
  mode: GraphStudyMode;
  focusChapterId: string;
  loadChapter: (chapterId: string) => Promise<ChapterDependencies | null | undefined>;
  loadConceptChapter: (chapterId: string) => Promise<ConceptGraphPayload | null>;
  markExpanded: (formulaId: string) => void;
  refreshNodeData: (items: Node[], chapter?: ChapterDependencies | null) => Node[];
  setNodeLoading: (id: string, loading: boolean) => void;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setSelectedFormulaId: Dispatch<SetStateAction<string | null>>;
  setShowHint: Dispatch<SetStateAction<boolean>>;
  centerOnFormula: (formulaId: string) => void;
}

export function useGuidedSymbolExplanations({
  isChapterGraph,
  mode,
  focusChapterId,
  loadChapter,
  loadConceptChapter,
  markExpanded,
  refreshNodeData,
  setNodeLoading,
  setNodes,
  setSelectedFormulaId,
  setShowHint,
  centerOnFormula,
}: UseGuidedSymbolExplanationsParams) {
  const guidedSymbolRequestRef = useRef(new Map<string, number>());

  return useCallback(
    async (formulaId: string, options: GuidedSymbolOptions = {}) => {
      if (isChapterGraph || mode !== 'formula' || !formulaId) return;

      const requestId = (guidedSymbolRequestRef.current.get(formulaId) || 0) + 1;
      guidedSymbolRequestRef.current.set(formulaId, requestId);
      setSelectedFormulaId(formulaId);
      setNodeLoading(formulaId, true);

      try {
        const [chapter, conceptGraph] = await Promise.all([
          loadChapter(focusChapterId),
          loadConceptChapter(focusChapterId),
        ]);
        const currentFormula = chapter?.formulas.find((item) => item.id === formulaId) || null;
        if (!currentFormula || guidedSymbolRequestRef.current.get(formulaId) !== requestId) return;

        const dependency = chapter?.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
        const symbolPrerequisites = buildConceptBackedFocusSymbolPrerequisites(currentFormula, dependency, conceptGraph);
        const symbolNotes: GuidedSymbolNote[] = symbolPrerequisites.map((item) => ({
          ...item,
          llmStatus: 'ready' as const,
        }));
        setNodes((currentNodes) =>
          refreshNodeData(currentNodes, chapter).map((node) => {
            if (node.id !== formulaId || node.type !== 'formula') return node;
            const data = node.data as unknown as FormulaNodeData;
            return {
              ...node,
              data: {
                ...data,
                symbolExplanations: symbolNotes,
              } satisfies FormulaNodeData,
            };
          }),
        );

        markExpanded(formulaId);
        setShowHint(false);
        if (options.center !== false) centerOnFormula(formulaId);
      } finally {
        if (guidedSymbolRequestRef.current.get(formulaId) === requestId) setNodeLoading(formulaId, false);
      }
    },
    [
      centerOnFormula,
      focusChapterId,
      isChapterGraph,
      loadChapter,
      loadConceptChapter,
      markExpanded,
      mode,
      refreshNodeData,
      setNodeLoading,
      setNodes,
      setSelectedFormulaId,
      setShowHint,
    ],
  );
}
