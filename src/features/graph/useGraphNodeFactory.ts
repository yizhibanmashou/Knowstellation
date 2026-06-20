import { useCallback, type MutableRefObject } from 'react';
import type { Node, XYPosition } from '@xyflow/react';
import type { ChapterDependencies, ChapterFormula } from '../../shared/types/formula';
import type { ConceptGraphPayload } from '../../shared/types/conceptGraph';
import type { FormulaExpansionIntent, FormulaNodeData } from '../../shared/types/graph';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { resolveNextStudyFormulaId } from '../learning/learningNavigator';
import type { FocusAnnotationNote } from './focusAnnotations';
import { buildConceptBackedFocusSymbolPrerequisites, shouldRenderFormulaPrerequisite } from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';

interface UseGraphNodeFactoryParams {
  expandFormulaRef: MutableRefObject<(formulaId: string, intent?: FormulaExpansionIntent) => void>;
  focusChapterId: string;
  focusFormulaId: string;
  isChapterGraph: boolean;
  learnedByChapter: Record<string, Set<string>>;
  loadingIds: Set<string>;
  mode: GraphStudyMode;
  onOpenStudyFormula: (formulaId: string) => void;
  studyFormulaIds: string[];
}

export function useGraphNodeFactory({
  expandFormulaRef,
  focusChapterId,
  focusFormulaId,
  isChapterGraph,
  learnedByChapter,
  loadingIds,
  mode,
  onOpenStudyFormula,
  studyFormulaIds,
}: UseGraphNodeFactoryParams) {
  const studyTargetFor = useCallback(
    (formulaId: string): Pick<FormulaNodeData, 'studyNextFormulaId' | 'studyNextFormulaLabel' | 'studyNextFormulaLocked' | 'onOpenStudyFormula'> => {
      const nextFormulaId = resolveNextStudyFormulaId(studyFormulaIds, formulaId);
      if (!nextFormulaId) return { onOpenStudyFormula };
      return {
        studyNextFormulaId: nextFormulaId,
        studyNextFormulaLabel: rawFormulaNumber(nextFormulaId),
        studyNextFormulaLocked: false,
        onOpenStudyFormula,
      };
    },
    [onOpenStudyFormula, studyFormulaIds],
  );

  const relationStateFor = useCallback(
    (
      formulaId: string,
      chapter?: ChapterDependencies | null,
      fallback?: Pick<FormulaNodeData, 'hasGraphPrerequisites' | 'hasGraphSuccessors'>,
    ): Pick<FormulaNodeData, 'hasGraphPrerequisites' | 'hasGraphSuccessors'> => {
      if (!chapter) {
        return {
          hasGraphPrerequisites: fallback?.hasGraphPrerequisites,
          hasGraphSuccessors: fallback?.hasGraphSuccessors,
        };
      }
      const dependency = chapter.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
      const hasGraphPrerequisites = Boolean(
        dependency?.prerequisites.some((prereq) => shouldRenderFormulaPrerequisite(prereq) && !prereq.cross_chapter && prereq.target_id),
      );
      const hasGraphSuccessors = chapter.dependencies.some((dep) =>
        dep.prerequisites.some((prereq) => shouldRenderFormulaPrerequisite(prereq) && prereq.target_id === formulaId && !prereq.cross_chapter),
      );
      return { hasGraphPrerequisites, hasGraphSuccessors };
    },
    [],
  );

  const makeStaticFormulaNode = useCallback(
    (
      formula: ChapterFormula,
      position: XYPosition,
      focused = false,
      role: FormulaNodeData['role'] = 'successor',
      symbolExplanations: FocusAnnotationNote[] = [],
      chapterGraph = false,
      chapter?: ChapterDependencies | null,
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
        ...relationStateFor(formula.id, chapter),
        symbolExplanations,
        ...studyTargetFor(formula.id),
        onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => expandFormulaRef.current(formulaId, intent),
      } satisfies FormulaNodeData,
    }),
    [expandFormulaRef, mode, relationStateFor, studyTargetFor],
  );

  const makeFormulaNode = useCallback(
    (
      formula: ChapterFormula,
      position: XYPosition,
      focused = false,
      role: FormulaNodeData['role'] = 'successor',
      chapter?: ChapterDependencies | null,
      conceptGraph?: ConceptGraphPayload | null,
    ): Node => {
      const locked = false;
      const learned = Boolean(learnedByChapter[focusChapterId]?.has(formula.id));
      const dependency = chapter?.dependencies.find((dep) => dep.dependent_id === formula.id) || null;
      const focusSymbolExplanations = mode === 'formula' && !isChapterGraph
        ? buildConceptBackedFocusSymbolPrerequisites(formula, dependency, conceptGraph)
        : [];
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
          lockedReason: undefined,
          lockedTargetFormulaId: undefined,
          lockedTargetLabel: undefined,
          learned,
          ...relationStateFor(formula.id, chapter),
          ...studyTargetFor(formula.id),
          symbolExplanations: focusSymbolExplanations,
          onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => expandFormulaRef.current(formulaId, intent),
        } satisfies FormulaNodeData,
      };
    },
    [
      expandFormulaRef,
      focusChapterId,
      isChapterGraph,
      learnedByChapter,
      mode,
      relationStateFor,
      studyTargetFor,
    ],
  );

  const refreshNodeData = useCallback(
    (items: Node[], chapter?: ChapterDependencies | null) =>
      items.map((node) => {
        if (node.type !== 'formula') return node;
        const data = node.data as unknown as FormulaNodeData;
        const locked = false;
        return {
          ...node,
          data: {
            ...data,
            focused: !isChapterGraph && node.id === focusFormulaId,
            loading: loadingIds.has(node.id),
            role: !isChapterGraph && node.id === focusFormulaId ? 'focus' : data.role === 'focus' ? 'expanded' : data.role,
            mode,
            locked,
            lockedReason: undefined,
            lockedTargetFormulaId: undefined,
            lockedTargetLabel: undefined,
            learned: Boolean(learnedByChapter[focusChapterId]?.has(node.id)),
            ...relationStateFor(node.id, chapter, data),
            ...studyTargetFor(node.id),
            chapterGraph: isChapterGraph || data.chapterGraph,
            onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => expandFormulaRef.current(formulaId, intent),
          } satisfies FormulaNodeData,
        };
      }),
    [
      expandFormulaRef,
      focusChapterId,
      focusFormulaId,
      isChapterGraph,
      learnedByChapter,
      loadingIds,
      mode,
      relationStateFor,
      studyTargetFor,
    ],
  );

  return {
    makeFormulaNode,
    makeStaticFormulaNode,
    refreshNodeData,
  };
}
