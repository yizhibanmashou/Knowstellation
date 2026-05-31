import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { FormulaLearningCopyPayload, SearchFormula, StorylineEntry } from '../../types/formula';
import type { ChapterNavigatorPayload, ThemeRoute } from '../../types/learning';
import { useStudyContext } from '../../hooks/useStudyContext';
import { GraphCanvas } from './GraphCanvas';
import { GraphInfoPanel } from './GraphInfoPanel';
import { GraphModeControls, type GraphStudyMode } from './GraphModeControls';
import { StudyTimeline } from './StudyTimeline';
import { WorkspacePanel } from './WorkspacePanel';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../utils/uiCopy';

interface GraphWorkspaceProps {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
  searchIndex: SearchFormula[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  storylines: StorylineEntry[];
}

type WorkspacePanelState = 'open' | 'half' | 'collapsed';

function getInitialLeftPanelState(): WorkspacePanelState {
  if (typeof window === 'undefined') return 'open';
  return window.matchMedia('(orientation: landscape) and (max-height: 520px) and (max-width: 960px)').matches ? 'collapsed' : 'open';
}

export function GraphWorkspace({ chapterNavigator, themeRoutes, searchIndex, formulaLearningCopy, storylines }: GraphWorkspaceProps) {
  const { chapterId: routeChapterId = '', focusFormulaId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph;
  const [leftState, setLeftState] = useState<WorkspacePanelState>(getInitialLeftPanelState);
  const studyContext = useStudyContext({ chapterNavigator, themeRoutes });
  const mode = useMemo<GraphStudyMode>(() => {
    const requested = params.get('mode');
    if (routeChapterId) return 'explore';
    return requested === 'explore' ? 'explore' : 'guided';
  }, [params, routeChapterId]);

  useEffect(() => {
    if (params.get('mode') !== 'focus') return;
    const next = new URLSearchParams(params);
    next.delete('mode');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const setMode = (nextMode: GraphStudyMode) => {
    if (routeChapterId && nextMode !== 'explore') {
      const selectedFormulaId = params.get('selected');
      const fallbackFormulaId = searchIndex.find((item) => item.chapter_id === routeChapterId)?.id;
      const targetFormulaId = selectedFormulaId || fallbackFormulaId;
      if (!targetFormulaId) return;
      const next = new URLSearchParams(params);
      next.set('chapterId', routeChapterId);
      next.delete('selected');
      if (nextMode === 'guided') next.delete('mode');
      else next.set('mode', nextMode);
      navigate(`/graph/${targetFormulaId}?${next.toString()}`);
      return;
    }
    if (!routeChapterId && nextMode === 'explore') {
      const chapterId = params.get('chapterId') || searchIndex.find((item) => item.id === focusFormulaId)?.chapter_id;
      if (chapterId) {
        const next = new URLSearchParams(params);
        next.set('mode', 'explore');
        next.delete('chapterId');
        navigate(`/graph/chapter/${chapterId}?${next.toString()}`);
        return;
      }
    }
    const next = new URLSearchParams(params);
    if (nextMode === 'guided') next.delete('mode');
    else next.set('mode', nextMode);
    setParams(next, { replace: true });
  };
  const workspaceClassName = ['graph-workspace', 'graph-workspace--two-column', leftState === 'collapsed' ? 'graph-workspace--left-collapsed' : ''].filter(Boolean).join(' ');

  return (
    <div className={workspaceClassName}>
      <WorkspacePanel side="left" label={copy.panelLabel} state={leftState} onStateChange={setLeftState}>
        <GraphInfoPanel searchIndex={searchIndex} studyContext={studyContext} formulaLearningCopy={formulaLearningCopy} storylines={storylines} />
      </WorkspacePanel>
      <section className="graph-workspace__main">
        <div className="graph-space-decor" aria-hidden="true">
          <span className="graph-space-decor__meteor graph-space-decor__meteor--one" />
          <span className="graph-space-decor__meteor graph-space-decor__meteor--two" />
          <span className="graph-space-decor__meteor graph-space-decor__meteor--three" />
        </div>
        <GraphCanvas searchIndex={searchIndex} mode={mode} studyContext={studyContext} storylines={storylines} toolbar={<GraphModeControls mode={mode} onModeChange={setMode} />} />
        <StudyTimeline studyContext={studyContext} searchIndex={searchIndex} />
      </section>
    </div>
  );
}
