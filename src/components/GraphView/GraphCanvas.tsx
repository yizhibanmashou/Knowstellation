import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ReactFlowProvider,
  MarkerType,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { ConceptReference, ConceptView } from '../../types/conceptGraph';
import type { SearchFormula, StorylineEntry } from '../../types/formula';
import type { ConceptNodeData, ConceptRevealGroup, DependencyEdgeData, FormulaExpansionIntent } from '../../types/graph';
import type { StudyContext } from '../../types/learning';
import { useConceptGraph } from '../../hooks/useConceptGraph';
import { useDependencyGraph } from '../../hooks/useDependencyGraph';
import { useGraphStore } from '../../stores/graphStore';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../utils/uiCopy';
import { conceptTeachingMoveFromContext } from '../../utils/conceptTeachingMove';
import { GraphCanvasView } from './GraphCanvasView';
import {
  chapterIdForFormula,
  markSelectedFormulaNode,
} from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';
import { useGraphExpansion, type GuidedExpansionStage } from './useGraphExpansion';
import { useGraphInitialLoad } from './useGraphInitialLoad';
import { useGuidedSymbolExplanations } from './useGuidedSymbolExplanations';
import { useGraphNodeFactory } from './useGraphNodeFactory';
import './GraphView.css';

interface GraphCanvasProps {
  searchIndex: SearchFormula[];
  mode?: GraphStudyMode;
  studyContext: StudyContext;
  storylines: StorylineEntry[];
  toolbar?: ReactNode;
}

function isCompactLandscapeViewport(): boolean {
  return window.matchMedia('(orientation: landscape) and (max-height: 520px) and (max-width: 960px)').matches;
}

function focusCenterTarget(parent?: Node | null): { x: number; y: number; zoom: number } {
  if (!isCompactLandscapeViewport()) {
    return parent
      ? { x: parent.position.x + 310, y: parent.position.y + 220, zoom: 0.86 }
      : { x: 570, y: 500, zoom: 0.86 };
  }
  return parent
    ? { x: parent.position.x + 260, y: parent.position.y + 124, zoom: 0.9 }
    : { x: 520, y: 404, zoom: 0.9 };
}

const CONCEPT_FOCUS_POSITION = { x: 360, y: 80 };
const CONCEPT_PREREQ_X = -140;
const CONCEPT_INTRO_X = 900;
const CONCEPT_PREREQ_SPACING = 176;
const CONCEPT_INTRO_SPACING = 260;
const CONCEPT_FOCUS_SIZE = { width: 368, height: 374 };

function conceptReferenceKey(reference: ConceptReference, index: number): string {
  return `${reference.concept_id || reference.symbol || reference.name || 'concept'}:${reference.defined_by_formula_id || reference.from_formula_id || index}`;
}

function visibleConceptReferences(items: ConceptReference[], limit: number): ConceptReference[] {
  const seen = new Set<string>();
  const result: ConceptReference[] = [];
  for (const item of items) {
    const key = `${item.name}:${item.defined_by_formula_id || item.from_formula_id || ''}:${item.symbol || item.via_symbol || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function enrichConceptTeachingMove(view: ConceptView, searchLookup: Map<string, SearchFormula>): ConceptView {
  const currentContext = searchLookup.get(view.defined_by_formula_id)?.context || '';
  const currentMove = conceptTeachingMoveFromContext(currentContext);
  const enrichReference = (reference: ConceptReference): ConceptReference => {
    const formulaId = reference.defined_by_formula_id || reference.from_formula_id || '';
    const move = conceptTeachingMoveFromContext(searchLookup.get(formulaId)?.context || '');
    return move
      ? {
          ...reference,
          teaching_move: reference.teaching_move || move.teaching_move,
          teaching_move_zh: reference.teaching_move_zh || move.teaching_move_zh,
          source_sentence: reference.source_sentence || move.source_sentence,
        }
      : reference;
  };
  return {
    ...view,
    teaching_move: view.teaching_move || currentMove?.teaching_move,
    teaching_move_zh: view.teaching_move_zh || currentMove?.teaching_move_zh,
    source_sentence: view.source_sentence || currentMove?.source_sentence,
    prerequisite_concepts: view.prerequisite_concepts.map(enrichReference),
    introduced_concepts: view.introduced_concepts.map(enrichReference),
  };
}

function buildConceptScene(
  view: ConceptView,
  revealedGroups: Partial<Record<ConceptRevealGroup, boolean>>,
  onOpenConcept: (conceptId: string) => void,
  onOpenFormula: (formulaId: string) => void,
  onRevealGroup: (group: ConceptRevealGroup) => void,
): { nodes: Node[]; edges: Edge[] } {
  const prerequisites = visibleConceptReferences(view.prerequisite_concepts, 8);
  const introduced = visibleConceptReferences(view.introduced_concepts, 6);
  const showPrerequisites = Boolean(revealedGroups.prerequisites);
  const showIntroduced = Boolean(revealedGroups.introduced);
  const prereqColumns = prerequisites.length > 5 ? 2 : 1;
  const prereqRows = Math.ceil(prerequisites.length / prereqColumns);
  const nodes: Node[] = [
    {
      id: view.concept_id,
      type: 'concept',
      position: CONCEPT_FOCUS_POSITION,
      data: {
        view,
        role: 'focus',
        clickable: false,
        active: true,
        conceptCounts: {
          prerequisites: prerequisites.length,
          introduced: introduced.length,
        },
        revealedGroups,
        onRevealGroup,
        onOpenConcept,
        onOpenFormula,
      } satisfies ConceptNodeData,
    },
  ];
  const edges: Edge[] = [];

  if (showPrerequisites) prerequisites.forEach((reference, index) => {
    const id = `prereq:${conceptReferenceKey(reference, index)}`;
    const column = prerequisites.length > 5 ? index % 2 : 0;
    const row = prerequisites.length > 5 ? Math.floor(index / 2) : index;
    const y = CONCEPT_FOCUS_POSITION.y - Math.max(0, prereqRows - 1) * (CONCEPT_PREREQ_SPACING / 2) + row * CONCEPT_PREREQ_SPACING;
    nodes.push({
      id,
      type: 'concept',
      position: { x: CONCEPT_PREREQ_X + column * 274, y },
      data: {
        view,
        role: 'prerequisite',
        reference,
        clickable: true,
        onOpenConcept,
        onOpenFormula,
      } satisfies ConceptNodeData,
    });
    edges.push({
      id: `${id}->${view.concept_id}`,
      source: id,
      target: view.concept_id,
      type: 'dependency',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#5eead4' },
      data: {
        via: reference.via_symbol || reference.symbol || 'depends',
        crossChapter: false,
        confidence: reference.confidence,
        kind: 'concept',
        relation: reference.relation || 'prerequisite_for',
        explanation: `由公式依赖继承：${reference.formula_label} 是当前概念的前置概念。`,
        active: true,
        labelVisible: prerequisites.length <= 4 && index < 2,
      } satisfies DependencyEdgeData,
    });
  });

  if (showIntroduced) introduced.forEach((reference, index) => {
    const id = `introduced:${conceptReferenceKey(reference, index)}`;
    const y = CONCEPT_FOCUS_POSITION.y - Math.max(0, introduced.length - 1) * (CONCEPT_INTRO_SPACING / 2) + index * CONCEPT_INTRO_SPACING;
    nodes.push({
      id,
      type: 'concept',
      position: { x: CONCEPT_INTRO_X, y },
      data: {
        view,
        role: 'introduced',
        reference,
        clickable: false,
        onOpenConcept,
        onOpenFormula,
      } satisfies ConceptNodeData,
      draggable: false,
    });
    edges.push({
      id: `${id}->${view.concept_id}`,
      source: id,
      target: view.concept_id,
      type: 'dependency',
      data: {
        via: reference.symbol || 'introduced',
        crossChapter: false,
        confidence: reference.confidence,
        kind: 'introduced',
        relation: 'introduced_for',
        explanation: `首次引入概念：${reference.name}`,
      } satisfies DependencyEdgeData,
    });
  });

  return { nodes, edges };
}

function GraphCanvasInner({ searchIndex, mode = 'concept', storylines, toolbar }: GraphCanvasProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph;
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const paramsKey = params.toString();
  const navigate = useNavigate();
  const { loadChapter, resolveFormulaChapter, error } = useDependencyGraph();
  const { getConceptView, error: conceptError } = useConceptGraph();
  const reactFlow = useReactFlow();
  const markExpanded = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markExpanded);
  const markLearned = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markLearned);
  const learnedByChapter = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.learnedByChapter);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [showHint, setShowHint] = useState(true);
  const [standaloneFocusId, setStandaloneFocusId] = useState<string | null>(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState<string | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [graphNotice, setGraphNotice] = useState<string | null>(null);
  const [guidedStages, setGuidedStages] = useState<Record<string, GuidedExpansionStage>>({});
  const [conceptReveals, setConceptReveals] = useState<Record<string, Partial<Record<ConceptRevealGroup, boolean>>>>({});
  const nodesRef = useRef<Node[]>([]);
  const expandFormulaRef = useRef<(formulaId: string, intent?: FormulaExpansionIntent) => void>(() => undefined);
  const loadConceptSceneRef = useRef<(conceptOrFormulaId: string) => void>(() => undefined);
  const autoExpandedFocusRef = useRef<string | null>(null);
  const conceptSceneRequestRef = useRef(0);
  const activeConceptViewRef = useRef<ConceptView | null>(null);
  const searchLookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);
  const isChapterGraph = Boolean(routeChapterId);
  const isConceptMode = !isChapterGraph && mode === 'concept';
  const focusChapterId = routeChapterId || params.get('chapterId') || chapterIdForFormula(focusFormulaId, searchLookup) || resolveFormulaChapter(focusFormulaId);
  const routeConceptId = params.get('conceptId');
  const routeSelectedFormulaId = isChapterGraph ? params.get('selected') : null;
  const guidedUnlock = params.get('entry') === 'chapter' && params.get('study') === 'chapter';
  const shouldShowLockedReason = !isChapterGraph && mode === 'guided' && guidedUnlock;
  const storylineId = params.get('storyline');
  const storylineTitle = useMemo(() => {
    const storyline = storylines.find((item) => item.id === storylineId);
    return storyline?.title_zh || storyline?.title_en || storylineId;
  }, [storylineId, storylines]);
  const chapterGraphModeClass = isChapterGraph ? `graph-canvas--chapter graph-canvas--chapter-${mode}` : isConceptMode ? 'graph-canvas--concept' : '';

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (!isChapterGraph || !routeSelectedFormulaId) return;
    const targetNode = nodesRef.current.find((node) => node.id === routeSelectedFormulaId && node.type === 'formula');
    if (!targetNode) return;
    setSelectedFormulaId(routeSelectedFormulaId);
    setNodes((current) => markSelectedFormulaNode(current, routeSelectedFormulaId));
    window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId: routeSelectedFormulaId } }));
  }, [isChapterGraph, routeSelectedFormulaId]);

  const setNodeLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openFormulaEvidence = useCallback(
    (formulaId: string) => {
      if (!formulaId) return;
      const next = new URLSearchParams(paramsKey);
      next.set('mode', 'guided');
      next.set('chapterId', focusChapterId);
      navigate(`/graph/${formulaId}?${next.toString()}`);
    },
    [focusChapterId, navigate, paramsKey],
  );

  const centerConceptFocus = useCallback(
    (duration = 420) => {
      window.setTimeout(() => {
        reactFlow.setCenter(
          CONCEPT_FOCUS_POSITION.x + CONCEPT_FOCUS_SIZE.width / 2,
          CONCEPT_FOCUS_POSITION.y + CONCEPT_FOCUS_SIZE.height / 2,
          { zoom: 0.9, duration },
        );
      }, 120);
      window.setTimeout(() => {
        reactFlow.setCenter(
          CONCEPT_FOCUS_POSITION.x + CONCEPT_FOCUS_SIZE.width / 2,
          CONCEPT_FOCUS_POSITION.y + CONCEPT_FOCUS_SIZE.height / 2,
          { zoom: 0.9, duration: 220 },
        );
      }, 420);
    },
    [reactFlow],
  );

  const renderConceptScene = useCallback(
    (rawView: ConceptView, revealedGroups: Partial<Record<ConceptRevealGroup, boolean>>) => {
      const view = enrichConceptTeachingMove(rawView, searchLookup);
      const scene = buildConceptScene(
        view,
        revealedGroups,
        (conceptId) => loadConceptSceneRef.current(conceptId),
        openFormulaEvidence,
        (group) => {
          setConceptReveals((current) => ({
            ...current,
            [view.concept_id]: {
              ...(current[view.concept_id] || {}),
              [group]: !current[view.concept_id]?.[group],
            },
          }));
        },
      );
      setNodes(scene.nodes);
      setEdges(scene.edges);
      setSelectedConceptId(view.concept_id);
      setSelectedFormulaId(view.defined_by_formula_id);
      setStandaloneFocusId(null);
      setShowHint(true);
    },
    [openFormulaEvidence, searchLookup],
  );

  const loadConceptScene = useCallback(
    async (conceptOrFormulaId: string, options: { syncUrl?: boolean } = {}) => {
      if (!focusChapterId || !conceptOrFormulaId) return;
      const requestId = conceptSceneRequestRef.current + 1;
      conceptSceneRequestRef.current = requestId;
      setGraphNotice(null);
      const view = await getConceptView(focusChapterId, conceptOrFormulaId);
      if (requestId !== conceptSceneRequestRef.current) return;
      if (!view) {
        activeConceptViewRef.current = null;
        setNodes([]);
        setEdges([]);
        setSelectedConceptId(null);
        setSelectedFormulaId(focusFormulaId || null);
        setGraphNotice(`${copy.missingFormula} ${conceptOrFormulaId}`);
        return;
      }
      const enrichedView = enrichConceptTeachingMove(view, searchLookup);
      activeConceptViewRef.current = enrichedView;
      renderConceptScene(enrichedView, {});
      if (options.syncUrl) {
        const next = new URLSearchParams(paramsKey);
        next.set('conceptId', view.concept_id);
        next.set('chapterId', focusChapterId);
        setParams(next, { replace: true });
      }
      window.dispatchEvent(new CustomEvent('litgraph:concept-details', { detail: { conceptView: enrichedView } }));
      window.setTimeout(() => {
      reactFlow.fitView({ padding: 0.3, duration: 620, maxZoom: 1.02 });
      }, 80);
      centerConceptFocus(520);
    },
    [centerConceptFocus, copy.missingFormula, focusChapterId, focusFormulaId, getConceptView, paramsKey, reactFlow, renderConceptScene, searchLookup, setParams],
  );

  useEffect(() => {
    const view = activeConceptViewRef.current;
    if (!isConceptMode || !view) return;
    renderConceptScene(view, conceptReveals[view.concept_id] || {});
    window.setTimeout(() => {
      reactFlow.fitView({ padding: 0.3, duration: 420, maxZoom: 1.02 });
    }, 40);
  }, [conceptReveals, isConceptMode, reactFlow, renderConceptScene]);

  useEffect(() => {
    loadConceptSceneRef.current = (conceptOrFormulaId: string) => {
      void loadConceptScene(conceptOrFormulaId, { syncUrl: true });
    };
  }, [loadConceptScene]);

  const canUseFormula = useCallback(
    (formulaId: string) => {
      if (!guidedUnlock) return true;
      if (formulaId === focusFormulaId) return true;
      if (Boolean(learnedByChapter[focusChapterId]?.has(formulaId))) return true;

      const hasLearnedPrereq = edges.some(
        (edge) => edge.target === formulaId && Boolean(learnedByChapter[focusChapterId]?.has(edge.source))
      );
      return hasLearnedPrereq;
    },
    [focusChapterId, focusFormulaId, guidedUnlock, learnedByChapter, edges],
  );

  const focusFormula = useCallback(
    (formulaId: string, intent: FormulaExpansionIntent = 'auto') => {
      if (!canUseFormula(formulaId)) return;
      setSelectedFormulaId(formulaId);
      window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId } }));
      expandFormulaRef.current(formulaId, intent);
    },
    [canUseFormula],
  );

  const handleLockedTarget = useCallback(
    (formulaId: string) => {
      if (!formulaId) return;
      const next = new URLSearchParams(params);
      next.set('study', 'chapter');
      next.set('chapterId', focusChapterId);
      next.set('layer', 'backbone');
      next.set('entry', 'chapter');
      next.delete('mode');
      navigate(`/graph/${formulaId}?${next.toString()}`);
    },
    [focusChapterId, navigate, params],
  );

  const { makeFormulaNode, makeStaticFormulaNode, refreshNodeData } = useGraphNodeFactory({
    canUseFormula,
    expandFormulaRef,
    focusChapterId,
    focusFormula,
    focusFormulaId,
    handleLockedTarget,
    isChapterGraph,
    learnedByChapter,
    loadingIds,
    lockedReasonCopy: copy.node.lockedReason,
    mode,
    shouldShowLockedReason,
  });

  const centerOnGuidedFormula = useCallback(
    (formulaId: string) => {
      window.setTimeout(() => {
        const parent = nodesRef.current.find((node) => node.id === formulaId);
        if (parent) {
          const target = focusCenterTarget(parent);
          reactFlow.setCenter(target.x, target.y, { zoom: target.zoom, duration: 420 });
        }
      }, 20);
    },
    [reactFlow],
  );

  const loadGuidedSymbolExplanations = useGuidedSymbolExplanations({
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
    centerOnFormula: centerOnGuidedFormula,
  });

  const expandFormula = useGraphExpansion({
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
    fitAfterExpand: () => window.setTimeout(() => reactFlow.fitView({ padding: 0.28, duration: 650, maxZoom: 1.08 }), 50),
  });

  useEffect(() => {
    expandFormulaRef.current = expandFormula;
  }, [expandFormula]);

  useGraphInitialLoad({
    autoExpandedFocusRef,
    copy,
    disabled: isConceptMode,
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
  });

  useEffect(() => {
    if (!isConceptMode) return;
    setNodes([]);
    setEdges([]);
    setGraphNotice(null);
    setGuidedStages({});
    setLoadingIds(new Set());
    setConceptReveals({});
    activeConceptViewRef.current = null;
    autoExpandedFocusRef.current = null;
    const target = routeConceptId || focusFormulaId;
    if (!target) return;
    void loadConceptScene(target);
  }, [focusFormulaId, isConceptMode, loadConceptScene, routeConceptId, setEdges, setNodes]);

  useEffect(() => {
    if (isChapterGraph || isConceptMode) return;
    const autoExpandKey = `${mode}:${focusFormulaId}`;
    if (!focusFormulaId || autoExpandedFocusRef.current === autoExpandKey) return;
    if (mode === 'guided') {
      if (!nodes.some((node) => node.id === focusFormulaId)) return;
      autoExpandedFocusRef.current = autoExpandKey;
      window.setTimeout(() => loadGuidedSymbolExplanations(focusFormulaId, { center: false }), 0);
      return;
    }
    if (!nodes.some((node) => node.id === focusFormulaId)) return;
    autoExpandedFocusRef.current = autoExpandKey;
    window.setTimeout(() => {
      expandFormulaRef.current(focusFormulaId);
    }, 0);
  }, [focusFormulaId, isChapterGraph, isConceptMode, loadGuidedSymbolExplanations, mode, nodes]);

  useEffect(() => {
    setNodes((current) => refreshNodeData(current));
  }, [refreshNodeData]);

  const selectFormulaFromGraph = useCallback(
    (formulaId: string, options: { center?: boolean } = {}) => {
      if (!canUseFormula(formulaId)) return;
      const targetNode = nodesRef.current.find((node) => node.id === formulaId && node.type === 'formula');
      if (!targetNode) return;

      setSelectedFormulaId(formulaId);
      setNodes((current) => markSelectedFormulaNode(current, formulaId));
      window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId } }));

      if (isChapterGraph) {
        const next = new URLSearchParams(params);
        next.set('selected', formulaId);
        setParams(next, { replace: true });
        if (options.center !== false) {
          window.setTimeout(() => {
            const latestNode = nodesRef.current.find((node) => node.id === formulaId) || targetNode;
            reactFlow.setCenter(latestNode.position.x + 134, latestNode.position.y + 128, { zoom: 0.82, duration: 420 });
          }, 20);
        }
        return;
      }

      if (mode === 'guided' || mode === 'explore') {
        expandFormulaRef.current(formulaId, 'auto');
      }

      if (options.center !== false) {
        window.setTimeout(() => {
          const latestNode = nodesRef.current.find((node) => node.id === formulaId) || targetNode;
          const target = focusCenterTarget(latestNode);
          reactFlow.setCenter(target.x, target.y, { zoom: target.zoom, duration: 420 });
        }, 760);
      }
    },
    [canUseFormula, isChapterGraph, mode, params, reactFlow, setParams],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'formula') selectFormulaFromGraph(node.id, { center: false });
      if (node.type === 'concept') {
        const data = node.data as unknown as ConceptNodeData;
        if (data.role === 'focus') {
          setSelectedConceptId(data.view.concept_id);
          setSelectedFormulaId(data.view.defined_by_formula_id);
          window.dispatchEvent(new CustomEvent('litgraph:concept-details', { detail: { conceptView: data.view } }));
        }
      }
    },
    [selectFormulaFromGraph],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  return (
    <GraphCanvasView
      copy={copy}
      mode={mode}
      toolbar={toolbar}
      storylineId={storylineId}
      storylineTitle={storylineTitle}
      isChapterGraph={isChapterGraph}
      showHint={showHint}
      error={conceptError || error}
      graphNotice={graphNotice}
      standaloneFocusId={standaloneFocusId}
      focusFormulaId={focusFormulaId}
      focusChapterId={focusChapterId}
      selectedFormulaId={selectedFormulaId}
      selectedConceptId={selectedConceptId}
      nodes={nodes}
      edges={edges}
      chapterGraphModeClass={chapterGraphModeClass}
      onBackToStoryline={() => navigate(`/storyline/${storylineId}`)}
      onHome={() => navigate('/')}
      onExpand={() => expandFormula(selectedFormulaId || focusFormulaId)}
      onDismissHint={() => setShowHint(false)}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onSetEdges={setEdges}
      onSelectFormula={selectFormulaFromGraph}
    />
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
