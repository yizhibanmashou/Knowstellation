import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { ChapterDependencies } from '../../shared/types/formula';
import type { FormulaNodeData } from '../../shared/types/graph';
import { generateVariableDetailsBatch } from '../../shared/services/llmClient';
import { buildFocusSymbolPrerequisites, type GuidedSymbolNote } from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';

interface GuidedSymbolOptions {
  center?: boolean;
}

interface UseGuidedSymbolExplanationsParams {
  isChapterGraph: boolean;
  mode: GraphStudyMode;
  focusChapterId: string;
  loadChapter: (chapterId: string) => Promise<ChapterDependencies | null | undefined>;
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
      if (isChapterGraph || mode !== 'guided' || !formulaId) return;

      const requestId = (guidedSymbolRequestRef.current.get(formulaId) || 0) + 1;
      guidedSymbolRequestRef.current.set(formulaId, requestId);
      setSelectedFormulaId(formulaId);
      setNodeLoading(formulaId, true);

      try {
        const chapter = await loadChapter(focusChapterId);
        const currentFormula = chapter?.formulas.find((item) => item.id === formulaId) || null;
        if (!currentFormula || guidedSymbolRequestRef.current.get(formulaId) !== requestId) return;

        const dependency = chapter?.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
        const symbolPrerequisites = buildFocusSymbolPrerequisites(currentFormula, dependency);
        const llmSymbolPrerequisites = symbolPrerequisites.filter((item) => item.kind !== 'formula');
        const loadingSymbolNotes: GuidedSymbolNote[] = symbolPrerequisites.map((item) => ({
          ...item,
          llmStatus: item.kind === 'formula' ? 'ready' as const : 'loading' as const,
        }));
        setNodes((currentNodes) =>
          refreshNodeData(currentNodes, chapter).map((node) => {
            if (node.id !== formulaId || node.type !== 'formula') return node;
            const data = node.data as unknown as FormulaNodeData;
            return {
              ...node,
              data: {
                ...data,
                symbolExplanations: loadingSymbolNotes,
              } satisfies FormulaNodeData,
            };
          }),
        );

        if (!llmSymbolPrerequisites.length) {
          markExpanded(formulaId);
          setShowHint(false);
          return;
        }

        const batch = await generateVariableDetailsBatch({
          formulaId,
          latex: currentFormula.latex || '',
          context: currentFormula.context_text || '',
          symbols: llmSymbolPrerequisites.map((prereq) => ({
            symbol: prereq.symbol || prereq.via_symbol || 'symbol',
            kind: prereq.kind || 'symbol',
            prerequisite: prereq,
          })),
          language: 'zh',
        }).catch(() => null);
        const detailBySymbol = new Map(batch?.items.map((item) => [item.symbol, item]) || []);
        const symbolNotes: GuidedSymbolNote[] = symbolPrerequisites.map((prereq) => {
          if (prereq.kind === 'formula') return { ...prereq, llmStatus: 'ready' as const };
          const symbol = prereq.symbol || prereq.via_symbol || 'symbol';
          const detail = detailBySymbol.get(symbol);
          return detail
            ? {
                ...prereq,
                shortLabel: detail.shortLabel,
                llmText: detail.text,
                llmStatus: 'ready' as const,
              }
            : { ...prereq, llmStatus: 'ready' as const };
        });

        if (guidedSymbolRequestRef.current.get(formulaId) !== requestId) return;
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
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
