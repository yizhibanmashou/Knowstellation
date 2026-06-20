import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, RefreshCcw } from 'lucide-react';
import type { GraphStudyMode } from './GraphModeControls';
import type { getUiCopy } from '../../shared/utils/uiCopy';
import type { ConceptLearningNav } from './conceptLearning';

interface FormulaLearningTarget {
  formulaId: string;
  label: string;
}

interface FormulaLearningNav {
  previous: FormulaLearningTarget | null;
  next: FormulaLearningTarget | null;
}

interface GraphToolbarProps {
  copy: ReturnType<typeof getUiCopy>['graph'];
  mode: GraphStudyMode;
  toolbar?: ReactNode;
  conceptBackLabel?: string | null;
  conceptLearningNav?: ConceptLearningNav | null;
  formulaLearningNav?: FormulaLearningNav | null;
  storylineId: string | null;
  storylineTitle?: string | null;
  isChapterGraph: boolean;
  showHint: boolean;
  onBackToConcept?: () => void;
  onBackToStoryline: () => void;
  onHome: () => void;
  onOpenNextConcept?: () => void;
  onOpenFormulaStep?: (formulaId: string) => void;
  onExpand: () => void;
  standaloneNotice?: string | null;
  onDismissHint: () => void;
}

export function GraphToolbar({
  copy,
  mode,
  toolbar,
  conceptBackLabel,
  conceptLearningNav,
  formulaLearningNav,
  storylineId,
  storylineTitle,
  isChapterGraph,
  onBackToConcept,
  onBackToStoryline,
  onHome,
  onOpenNextConcept,
  onOpenFormulaStep,
  onExpand,
  standaloneNotice,
}: GraphToolbarProps) {
  const nextConcept = conceptLearningNav?.nextFromCurrent;
  const nextConceptLabel = nextConcept?.source === 'adjacent' ? '相邻概念' : '下一概念';
  return (
    <div className="graph-toolbar absolute left-[22px] right-5 top-4 z-20">
      <div className="graph-toolbar__primary">
        {storylineId ? (
          <button
            type="button"
            onClick={onBackToStoryline}
            className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
            title={`${copy.fromStoryline}${storylineTitle || ''}`}
          >
            <ArrowLeft size={16} />
            Storyline
          </button>
        ) : null}
        <button type="button" onClick={onHome} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
          {copy.home}
        </button>
        {toolbar}
      </div>

      <div className="graph-toolbar__secondary">
        {!isChapterGraph && conceptBackLabel && onBackToConcept ? (
          <button
            type="button"
            onClick={onBackToConcept}
            className="graph-toolbar-button graph-toolbar-button--concept-nav inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
            title={conceptBackLabel}
            aria-label={conceptBackLabel}
          >
            <ArrowLeft size={16} />
            <span>{conceptBackLabel}</span>
          </button>
        ) : null}
        {mode === 'concept' && nextConcept && onOpenNextConcept ? (
          <button
            type="button"
            onClick={onOpenNextConcept}
            className="graph-toolbar-button graph-toolbar-button--concept-nav inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
            title={`${nextConcept.title}${nextConcept.formulaLabel ? ` - ${nextConcept.formulaLabel}` : ''}`}
          >
            <span>{nextConceptLabel}</span>
            <ArrowRight size={16} />
          </button>
        ) : null}
        {mode === 'formula' && !isChapterGraph && formulaLearningNav?.previous && onOpenFormulaStep ? (
          <button
            type="button"
            onClick={() => onOpenFormulaStep(formulaLearningNav.previous!.formulaId)}
            className="graph-toolbar-button graph-toolbar-button--sequence-nav inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
            title={formulaLearningNav.previous.label}
            aria-label={`上一个公式：${formulaLearningNav.previous.label}`}
          >
            <ArrowLeft size={16} />
            <span>上一个公式</span>
          </button>
        ) : null}
        {mode === 'formula' && !isChapterGraph && formulaLearningNav?.next && onOpenFormulaStep ? (
          <button
            type="button"
            onClick={() => onOpenFormulaStep(formulaLearningNav.next!.formulaId)}
            className="graph-toolbar-button graph-toolbar-button--sequence-nav inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold"
            title={formulaLearningNav.next.label}
            aria-label={`下一个公式：${formulaLearningNav.next.label}`}
          >
            <span>下一个公式</span>
            <ArrowRight size={16} />
          </button>
        ) : null}
        {!isChapterGraph && mode !== 'concept' && mode !== 'conceptMap' ? (
          <button type="button" onClick={onExpand} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
            <RefreshCcw size={16} />
            {copy.expand}
          </button>
        ) : null}
        {standaloneNotice ? <span className="graph-toolbar__status-chip">{standaloneNotice}</span> : null}
      </div>
    </div>
  );
}
