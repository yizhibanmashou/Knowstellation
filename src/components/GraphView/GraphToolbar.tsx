import type { ReactNode } from 'react';
import { ArrowLeft, MousePointerClick, RefreshCcw } from 'lucide-react';
import type { GraphStudyMode } from './GraphModeControls';
import type { getUiCopy } from '../../utils/uiCopy';

interface GraphToolbarProps {
  copy: ReturnType<typeof getUiCopy>['graph'];
  mode: GraphStudyMode;
  toolbar?: ReactNode;
  storylineId: string | null;
  storylineTitle?: string | null;
  isChapterGraph: boolean;
  showHint: boolean;
  onBackToStoryline: () => void;
  onHome: () => void;
  onExpand: () => void;
  onDismissHint: () => void;
}

export function GraphToolbar({
  copy,
  mode,
  toolbar,
  storylineId,
  storylineTitle,
  isChapterGraph,
  showHint,
  onBackToStoryline,
  onHome,
  onExpand,
  onDismissHint,
}: GraphToolbarProps) {
  return (
    <div className="graph-toolbar absolute left-[22px] right-5 top-4 z-20 flex flex-wrap items-center gap-2">
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
      {!isChapterGraph ? (
        <button type="button" onClick={onExpand} className="graph-toolbar-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold">
          <RefreshCcw size={16} />
          {copy.expand}
        </button>
      ) : null}
      {showHint ? (
        <div className="graph-onboarding-hint animate-[fadeSlideUp_0.5s_ease_0.6s_both]" role="status">
          <MousePointerClick size={16} className="graph-onboarding-hint__icon shrink-0" />
          <span>{copy.hints[mode]}</span>
          <button type="button" onClick={onDismissHint} aria-label={copy.dismissHint}>
            x
          </button>
        </div>
      ) : null}
    </div>
  );
}
