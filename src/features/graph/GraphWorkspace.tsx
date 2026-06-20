import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { FormulaLearningCopyPayload, SearchFormula, StorylineEntry } from '../../shared/types/formula';
import type { ChapterLayer, ChapterNavigatorPayload, ThemeRoute } from '../../shared/types/learning';
import type { ConceptChapterNavigation, ConceptSearchResult } from '../../shared/types/search';
import { useStudyContext } from '../learning/useStudyContext';
import { getChapterById } from '../learning/learningNavigator';
import type { ConceptView } from '../../shared/types/conceptGraph';
import { GraphCanvas } from './GraphCanvas';
import { GraphInfoPanel } from './GraphInfoPanel';
import { GraphAtlas, type GraphAtlasProps } from './GraphAtlas';
import { GraphModeControls, type GraphStudyMode } from './GraphModeControls';
import { StudyTimeline } from './StudyTimeline';
import { WorkspacePanel } from './WorkspacePanel';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { buildChapterConceptLearningNodes } from '../starfield/starNavigation';
import { buildConceptLearningNav, type ConceptLearningNav } from './conceptLearning';
import { useGraphStore } from './graphStore';

interface GraphWorkspaceProps {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
  searchIndex: SearchFormula[];
  conceptIndex: ConceptSearchResult[];
  conceptChapters: ConceptChapterNavigation[];
  formulaLearningCopy: FormulaLearningCopyPayload['items'];
  takeawayCache: Record<string, string>;
  storylines: StorylineEntry[];
}

type WorkspacePanelState = 'open' | 'half' | 'collapsed';

function getInitialLeftPanelState(): WorkspacePanelState {
  if (typeof window === 'undefined') return 'open';
  return window.matchMedia('(orientation: landscape) and (max-height: 520px) and (max-width: 960px)').matches ? 'collapsed' : 'open';
}

export function GraphWorkspace({ chapterNavigator, themeRoutes, searchIndex, conceptIndex, conceptChapters, formulaLearningCopy, takeawayCache, storylines }: GraphWorkspaceProps) {
  const { chapterId: routeChapterId = '', focusFormulaId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph;
  const [leftState, setLeftState] = useState<WorkspacePanelState>(getInitialLeftPanelState);
  const [atlasHost, setAtlasHost] = useState<HTMLDivElement | null>(null);
  const [activeConceptView, setActiveConceptView] = useState<ConceptView | null>(null);
  const learnedConceptsByChapter = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.learnedConceptsByChapter);
  const studyContext = useStudyContext({ chapterNavigator, themeRoutes });
  const conceptLayer: ChapterLayer = params.get('layer') === 'full' ? 'full' : 'backbone';
  const mode = useMemo<GraphStudyMode>(() => {
    const requested = params.get('mode');
    if (routeChapterId) return requested === 'conceptMap' ? 'conceptMap' : 'explore';
    if (requested === 'formula') return 'formula';
    if (requested === 'explore') return 'explore';
    if (requested === 'conceptMap') return 'conceptMap';
    return 'concept';
  }, [params, routeChapterId]);
  const conceptLearningNav = useMemo<ConceptLearningNav | null>(() => {
    if (routeChapterId || mode !== 'concept') return null;
    const chapterId = params.get('chapterId') || searchIndex.find((item) => item.id === focusFormulaId)?.chapter_id || '';
    const chapter = chapterId ? getChapterById(chapterNavigator, chapterId) : null;
    if (!chapter) return null;
    const conceptChapter = conceptChapters.find((item) => item.chapter_id === chapterId);
    const nodes = buildChapterConceptLearningNodes({
      chapter,
      conceptIndex,
      conceptNavigation: conceptChapter?.concept_navigation,
      maxConcepts: Number.POSITIVE_INFINITY,
    });
    if (!nodes.length) return null;
    return buildConceptLearningNav({
      chapterId,
      nodes,
      routeConceptId: params.get('conceptId'),
      selectedFormulaId: params.get('selected') || focusFormulaId,
      currentView: activeConceptView,
      conceptNavigation: conceptChapter?.concept_navigation,
      learnedConceptIds: learnedConceptsByChapter[chapterId] || new Set<string>(),
      layer: conceptLayer,
    });
  }, [activeConceptView, chapterNavigator, conceptChapters, conceptIndex, conceptLayer, focusFormulaId, learnedConceptsByChapter, mode, params, routeChapterId, searchIndex]);
  useEffect(() => {
    if (routeChapterId || mode !== 'concept') {
      setActiveConceptView(null);
      return;
    }
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ conceptView?: ConceptView }>).detail;
      setActiveConceptView(detail?.conceptView || null);
    };
    window.addEventListener('litgraph:concept-details', listener);
    return () => window.removeEventListener('litgraph:concept-details', listener);
  }, [mode, routeChapterId]);

  useEffect(() => {
    if (params.get('mode') !== 'focus') return;
    const next = new URLSearchParams(params);
    next.delete('mode');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const setMode = (nextMode: GraphStudyMode) => {
    if (routeChapterId && nextMode === 'conceptMap') {
      const next = new URLSearchParams(params);
      next.set('mode', 'conceptMap');
      navigate(`/graph/chapter/${routeChapterId}?${next.toString()}`);
      return;
    }
    if (routeChapterId && nextMode === 'explore') {
      const next = new URLSearchParams(params);
      next.delete('mode');
      navigate(`/graph/chapter/${routeChapterId}?${next.toString()}`);
      return;
    }
    if (routeChapterId && nextMode !== 'explore' && nextMode !== 'conceptMap') {
      const selectedFormulaId = params.get('selected');
      const fallbackFormulaId = searchIndex.find((item) => item.chapter_id === routeChapterId)?.id;
      const targetFormulaId = selectedFormulaId || fallbackFormulaId;
      if (!targetFormulaId) return;
      const next = new URLSearchParams(params);
      next.set('chapterId', routeChapterId);
      next.delete('selected');
      if (nextMode === 'concept') next.delete('mode');
      else next.set('mode', nextMode);
      navigate(`/graph/${targetFormulaId}?${next.toString()}`);
      return;
    }
    if (!routeChapterId && (nextMode === 'explore' || nextMode === 'conceptMap')) {
      const chapterId = params.get('chapterId') || searchIndex.find((item) => item.id === focusFormulaId)?.chapter_id;
      if (chapterId) {
        const next = new URLSearchParams(params);
        if (nextMode === 'conceptMap') next.set('mode', 'conceptMap');
        else next.set('mode', 'explore');
        next.delete('chapterId');
        navigate(`/graph/chapter/${chapterId}?${next.toString()}`);
        return;
      }
    }
    if (!routeChapterId && nextMode === 'formula') {
      const selectedFormulaId = params.get('selected');
      if (selectedFormulaId && selectedFormulaId !== focusFormulaId) {
        const next = new URLSearchParams(params);
        next.set('mode', 'formula');
        next.delete('conceptId');
        navigate(`/graph/${selectedFormulaId}?${next.toString()}`);
        return;
      }
    }
    const next = new URLSearchParams(params);
    if (nextMode === 'formula' || nextMode === 'conceptMap') next.delete('conceptId');
    if (nextMode === 'concept') next.delete('mode');
    else next.set('mode', nextMode);
    setParams(next, { replace: true });
  };
  const setConceptLayer = (layer: ChapterLayer) => {
    const next = new URLSearchParams(params);
    if (layer === 'full') next.set('layer', 'full');
    else next.delete('layer');
    setParams(next, { replace: true });
  };
  const workspaceClassName = ['graph-workspace', 'graph-workspace--two-column', leftState === 'collapsed' ? 'graph-workspace--left-collapsed' : ''].filter(Boolean).join(' ');

  return (
    <div className={workspaceClassName}>
      <WorkspacePanel side="left" label={copy.panelLabel} state={leftState} onStateChange={setLeftState}>
        <GraphInfoPanel
          searchIndex={searchIndex}
          studyContext={studyContext}
          formulaLearningCopy={formulaLearningCopy}
          takeawayCache={takeawayCache}
          storylines={storylines}
        />
        <div className="workspace-panel__atlas-host" ref={setAtlasHost} />
      </WorkspacePanel>
      <section className="graph-workspace__main">
        <div className="graph-space-decor" aria-hidden="true">
          <span className="graph-space-decor__meteor graph-space-decor__meteor--one" />
          <span className="graph-space-decor__meteor graph-space-decor__meteor--two" />
          <span className="graph-space-decor__meteor graph-space-decor__meteor--three" />
        </div>
        <GraphCanvas
          searchIndex={searchIndex}
          mode={mode}
          studyContext={studyContext}
          storylines={storylines}
          conceptLearningNav={conceptLearningNav}
          conceptLayer={conceptLayer}
          onConceptLayerChange={setConceptLayer}
          toolbar={<GraphModeControls mode={mode} onModeChange={setMode} />}
          renderAtlas={(atlasProps: GraphAtlasProps) => <GraphAtlas {...atlasProps} variant="embedded" />}
          atlasPortalTarget={atlasHost}
        />
        {mode !== 'concept' ? <StudyTimeline studyContext={studyContext} searchIndex={searchIndex} /> : null}
      </section>
    </div>
  );
}
