import { useCallback, type MutableRefObject } from 'react';
import type { Node, XYPosition } from '@xyflow/react';
import type { ChapterDependencies, ChapterFormula } from '../../types/formula';
import type { FormulaExpansionIntent, FormulaNodeData } from '../../types/graph';
import type { FocusAnnotationNote } from '../../utils/focusAnnotations';
import { formatLockedFormulaReason, resolveLockedFormulaGuidance } from '../../utils/lockedGuidance';
import { buildFocusSymbolPrerequisites } from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';

interface UseGraphNodeFactoryParams {
  canUseFormula: (formulaId: string) => boolean;
  expandFormulaRef: MutableRefObject<(formulaId: string, intent?: FormulaExpansionIntent) => void>;
  focusChapterId: string;
  focusFormula: (formulaId: string, intent?: FormulaExpansionIntent) => void;
  focusFormulaId: string;
  handleLockedTarget: (formulaId: string) => void;
  isChapterGraph: boolean;
  learnedByChapter: Record<string, Set<string>>;
  loadingIds: Set<string>;
  lockedReasonCopy: string;
  mode: GraphStudyMode;
  shouldShowLockedReason: boolean;
}

export function useGraphNodeFactory({
  canUseFormula,
  expandFormulaRef,
  focusChapterId,
  focusFormula,
  focusFormulaId,
  handleLockedTarget,
  isChapterGraph,
  learnedByChapter,
  loadingIds,
  lockedReasonCopy,
  mode,
  shouldShowLockedReason,
}: UseGraphNodeFactoryParams) {
  const getLockedGuidanceForFormula = useCallback(
    (chapter: ChapterDependencies | null | undefined, formulaId: string) => {
      if (!shouldShowLockedReason) return null;
      const learned = learnedByChapter[focusChapterId] || new Set<string>();
      const guidance = resolveLockedFormulaGuidance(chapter, formulaId, learned);
      return {
        guidance,
        reason: formatLockedFormulaReason(lockedReasonCopy, guidance),
      };
    },
    [focusChapterId, learnedByChapter, lockedReasonCopy, shouldShowLockedReason],
  );

  const makeStaticFormulaNode = useCallback(
    (
      formula: ChapterFormula,
      position: XYPosition,
      focused = false,
      role: FormulaNodeData['role'] = 'successor',
      symbolExplanations: FocusAnnotationNote[] = [],
      chapterGraph = false,
    ): Node => ({
      id: formula.id,
      type: 'formula',
      position,
      data: {
        formula,
        focused,
        loading: false,
        role: focused ? 'focus' : role,
        mode,
        locked: false,
        learned: false,
        chapterGraph,
        symbolExplanations,
        onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => expandFormulaRef.current(formulaId, intent),
        onLockedTarget: handleLockedTarget,
      } satisfies FormulaNodeData,
    }),
    [expandFormulaRef, handleLockedTarget, mode],
  );

  const makeFormulaNode = useCallback(
    (
      formula: ChapterFormula,
      position: XYPosition,
      focused = false,
      role: FormulaNodeData['role'] = 'successor',
      chapter?: ChapterDependencies | null,
    ): Node => {
      const locked = isChapterGraph ? false : !canUseFormula(formula.id);
      const learned = Boolean(learnedByChapter[focusChapterId]?.has(formula.id));
      const focusSymbolExplanations = mode === 'guided' && !isChapterGraph ? buildFocusSymbolPrerequisites(formula, null) : [];
      const lockedGuidance = locked ? getLockedGuidanceForFormula(chapter, formula.id) : null;
      return {
        id: formula.id,
        type: 'formula',
        position,
        data: {
          formula,
          focused,
          loading: false,
          role: focused ? 'focus' : role,
          mode,
          locked,
          lockedReason: locked && shouldShowLockedReason ? lockedGuidance?.reason || lockedReasonCopy : undefined,
          lockedTargetFormulaId: lockedGuidance?.guidance?.formulaId,
          lockedTargetLabel: lockedGuidance?.guidance?.label,
          learned,
          symbolExplanations: focusSymbolExplanations,
          onExpand: focusFormula,
          onLockedTarget: handleLockedTarget,
        } satisfies FormulaNodeData,
      };
    },
    [
      canUseFormula,
      focusChapterId,
      focusFormula,
      getLockedGuidanceForFormula,
      handleLockedTarget,
      isChapterGraph,
      learnedByChapter,
      lockedReasonCopy,
      mode,
      shouldShowLockedReason,
    ],
  );

  const refreshNodeData = useCallback(
    (items: Node[], chapter?: ChapterDependencies | null) =>
      items.map((node) => {
        if (node.type !== 'formula') return node;
        const data = node.data as unknown as FormulaNodeData;
        const locked = isChapterGraph ? false : !canUseFormula(node.id);
        const lockedGuidance = locked ? getLockedGuidanceForFormula(chapter, node.id) : null;
        return {
          ...node,
          data: {
            ...data,
            focused: !isChapterGraph && node.id === focusFormulaId,
            loading: loadingIds.has(node.id),
            role: !isChapterGraph && node.id === focusFormulaId ? 'focus' : data.role === 'focus' ? 'expanded' : data.role,
            mode,
            locked,
            lockedReason: locked && shouldShowLockedReason ? lockedGuidance?.reason || data.lockedReason || lockedReasonCopy : undefined,
            lockedTargetFormulaId: locked ? lockedGuidance?.guidance?.formulaId || data.lockedTargetFormulaId : undefined,
            lockedTargetLabel: locked ? lockedGuidance?.guidance?.label || data.lockedTargetLabel : undefined,
            learned: Boolean(learnedByChapter[focusChapterId]?.has(node.id)),
            chapterGraph: isChapterGraph || data.chapterGraph,
            onExpand: focusFormula,
            onLockedTarget: handleLockedTarget,
          } satisfies FormulaNodeData,
        };
      }),
    [
      canUseFormula,
      focusChapterId,
      focusFormula,
      focusFormulaId,
      getLockedGuidanceForFormula,
      handleLockedTarget,
      isChapterGraph,
      learnedByChapter,
      loadingIds,
      lockedReasonCopy,
      mode,
      shouldShowLockedReason,
    ],
  );

  return {
    makeFormulaNode,
    makeStaticFormulaNode,
    refreshNodeData,
  };
}
