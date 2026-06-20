import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  addEdge,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { ConceptMapNodeData, DependencyEdgeData } from '../../shared/types/graph';
import type { ChapterLayer } from '../../shared/types/learning';
import { formatChapterLabel, type getUiCopy } from '../../shared/utils/uiCopy';
import type { ConceptLearningNav } from './conceptLearning';
import { standaloneGraphCopy } from './formulaInfo';
import { ConceptNode } from './ConceptNode';
import { ConceptMapNode } from './ConceptMapNode';
import { DependencyEdge } from './DependencyEdge';
import { FormulaNode } from './FormulaNode';
import { GraphAtlas, type GraphAtlasProps } from './GraphAtlas';
import { GraphToolbar } from './GraphToolbar';
import { chapterGraphBounds } from './graphLayout';
import type { GraphStudyMode } from './GraphModeControls';
import { VariableDefNode } from './VariableDefNode';

const nodeTypes = {
  concept: ConceptNode,
  conceptMap: ConceptMapNode,
  formula: FormulaNode,
  variableDefinition: VariableDefNode,
};

const edgeTypes = {
  dependency: DependencyEdge,
};

interface GraphCanvasViewProps {
  copy: ReturnType<typeof getUiCopy>['graph'];
  mode: GraphStudyMode;
  toolbar?: ReactNode;
  storylineId: string | null;
  storylineTitle?: string | null;
  isChapterGraph: boolean;
  showHint: boolean;
  error?: string | null;
  graphNotice: string | null;
  standaloneFocusId: string | null;
  focusFormulaId: string;
  focusChapterId: string;
  selectedFormulaId: string | null;
  selectedConceptId: string | null;
  nodes: Node[];
  edges: Edge[];
  chapterGraphModeClass: string;
  conceptBackLabel?: string | null;
  conceptLearningNav?: ConceptLearningNav | null;
  formulaLearningNav?: {
    previous: { formulaId: string; label: string } | null;
    next: { formulaId: string; label: string } | null;
  } | null;
  conceptLayer?: ChapterLayer;
  onConceptLayerChange?: (layer: ChapterLayer) => void;
  onBackToConcept?: () => void;
  onBackToStoryline: () => void;
  onHome: () => void;
  onOpenNextConcept?: () => void;
  onOpenFormulaStep?: (formulaId: string) => void;
  onOpenConceptStep?: (conceptId: string) => void;
  onExpand: () => void;
  onDismissHint: () => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onSetEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onSelectFormula: (formulaId: string) => void;
  onSelectConcept?: (conceptId: string) => void;
  renderAtlas?: (props: GraphAtlasProps) => ReactNode;
  atlasPortalTarget?: HTMLElement | null;
}

function decorateVisibleEdges(edges: Edge[], selectedFormulaId: string | null, selectedConceptId: string | null): Edge[] {
  return edges.map((edge) => {
    const data = edge.data as unknown as DependencyEdgeData | undefined;
    const conceptEdge = data?.kind === 'concept' || data?.kind === 'introduced';
    const selectedNodeId = conceptEdge ? selectedConceptId : selectedFormulaId;
    const related = Boolean(selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId));
    const active = Boolean(data?.active || related);
    return {
      ...edge,
      animated: false,
      data: {
        ...(data || {}),
        via: data?.via || '',
        crossChapter: Boolean(data?.crossChapter),
        confidence: data?.confidence ?? 0,
        active,
        dimmed: Boolean(selectedNodeId && !related),
        labelVisible: conceptEdge ? Boolean(data?.labelVisible) : Boolean(data?.labelVisible || related),
      } satisfies DependencyEdgeData,
    };
  });
}

export function GraphCanvasView({
  copy,
  mode,
  toolbar,
  storylineId,
  storylineTitle,
  isChapterGraph,
  showHint,
  error,
  graphNotice,
  standaloneFocusId,
  focusFormulaId,
  focusChapterId,
  selectedFormulaId,
  selectedConceptId,
  nodes,
  edges,
  chapterGraphModeClass,
  conceptBackLabel,
  conceptLearningNav,
  formulaLearningNav,
  conceptLayer = conceptLearningNav?.layer || 'backbone',
  onConceptLayerChange,
  onBackToConcept,
  onBackToStoryline,
  onHome,
  onOpenNextConcept,
  onOpenFormulaStep,
  onOpenConceptStep,
  onExpand,
  onDismissHint,
  onNodesChange,
  onNodeDragStart,
  onNodeDragStop,
  onEdgesChange,
  onNodeClick,
  onSetEdges,
  onSelectFormula,
  onSelectConcept,
  renderAtlas,
  atlasPortalTarget,
}: GraphCanvasViewProps) {
  const visibleEdges = decorateVisibleEdges(edges, selectedFormulaId, selectedConceptId);
  const currentConcept = conceptLearningNav?.current;
  const [conceptNavExpanded, setConceptNavExpanded] = useState(false);
  const atlasProps: GraphAtlasProps = {
    nodes,
    edges: visibleEdges,
    selectedFormulaId,
    selectedConceptId,
    focusFormulaId,
    isChapterGraph,
    title: isChapterGraph ? copy.fullChapter : formatChapterLabel(focusChapterId),
    copy,
    onSelectFormula,
    onSelectConcept,
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      <GraphToolbar
        copy={copy}
        mode={mode}
        toolbar={toolbar}
        conceptBackLabel={conceptBackLabel}
        conceptLearningNav={conceptLearningNav}
        formulaLearningNav={formulaLearningNav}
        storylineId={storylineId}
        storylineTitle={storylineTitle}
        isChapterGraph={isChapterGraph}
        showHint={showHint}
        onBackToConcept={onBackToConcept}
        onBackToStoryline={onBackToStoryline}
        onHome={onHome}
        onOpenNextConcept={onOpenNextConcept}
        onOpenFormulaStep={onOpenFormulaStep}
        onExpand={onExpand}
        standaloneNotice={standaloneFocusId === focusFormulaId ? standaloneGraphCopy() : null}
        onDismissHint={onDismissHint}
      />
      {error ? <div className="graph-error-card absolute right-6 top-16 z-20 max-w-sm rounded-md px-3 py-2 text-sm font-medium">{error}</div> : null}
      {graphNotice ? <div className="graph-empty-card graph-empty-card--top-notice absolute z-20 text-sm font-semibold">{graphNotice}</div> : null}
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onConnect={(connection) => onSetEdges((current) => addEdge(connection, current))}
        fitView
        nodesDraggable
        elementsSelectable
        panOnDrag
        zoomOnDoubleClick={mode !== 'concept'}
        nodesConnectable={false}
        minZoom={isChapterGraph ? chapterGraphBounds(nodes.length).minZoom : 0.2}
        maxZoom={isChapterGraph ? 1.25 : 1.6}
        translateExtent={isChapterGraph ? [[-420, -420], [4200, 17000]] : undefined}
        nodeExtent={isChapterGraph ? [[-160, -160], [3900, 16000]] : undefined}
        proOptions={{ hideAttribution: true }}
        className={`bg-transparent ${chapterGraphModeClass}`}
      >
        {renderAtlas
          ? atlasPortalTarget
            ? createPortal(renderAtlas(atlasProps), atlasPortalTarget)
            : null
          : <GraphAtlas {...atlasProps} />}
      </ReactFlow>
      {isChapterGraph && mode !== 'conceptMap' ? (
        <div className="graph-pan-hint pointer-events-none absolute left-6 top-[74px] z-10 rounded-md px-3 py-2 text-xs font-semibold">
          拖拽浏览全章，滚轮缩放；双击公式进入引导学习。
        </div>
      ) : null}
      {mode === 'concept' && conceptLearningNav ? (
        <div
          className={`graph-concept-learning-bar ${conceptNavExpanded ? 'graph-concept-learning-bar--expanded' : 'graph-concept-learning-bar--collapsed'}`}
          aria-label="概念导航"
        >
          <div className="graph-concept-learning-bar__header">
            <div className="graph-concept-learning-bar__title">
              <span>概念导航</span>
              <strong>{conceptLearningNav.steps.length} 个概念</strong>
            </div>
            <div className="graph-concept-learning-bar__layers" aria-label="概念导航序列">
              <button
                type="button"
                className={conceptLayer === 'backbone' ? 'active' : ''}
                onClick={() => onConceptLayerChange?.('backbone')}
              >
                {copy.timeline.backbone}
              </button>
              <button
                type="button"
                className={conceptLayer === 'full' ? 'active' : ''}
                onClick={() => onConceptLayerChange?.('full')}
              >
                {copy.timeline.full}
              </button>
            </div>
            <button
              type="button"
              className="graph-concept-learning-bar__toggle"
              onClick={() => setConceptNavExpanded((current) => !current)}
            >
              {conceptNavExpanded ? '收起' : '展开'}
            </button>
          </div>
          {conceptNavExpanded ? <div className="graph-concept-learning-bar__track">
            {conceptLearningNav.steps.map((step) => {
              const active = Boolean(
                (selectedConceptId && step.relatedConceptIds.includes(selectedConceptId)) ||
                step.conceptId === selectedConceptId ||
                step.conceptId === currentConcept?.conceptId,
              );
              const className = [
                'graph-concept-learning-bar__step',
                active ? 'graph-concept-learning-bar__step--active' : '',
                step.locked ? 'graph-concept-learning-bar__step--locked' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={step.conceptId || step.node.id}
                  type="button"
                  className={className}
                  disabled={step.locked}
                  onClick={() => !step.locked && step.conceptId && onOpenConceptStep?.(step.conceptId)}
                  title={step.locked ? step.lockedReason : `${step.title}${step.formulaLabel ? ` · ${step.formulaLabel}` : ''}`}
                >
                  <span>{step.index + 1}</span>
                  <strong>{step.title}</strong>
                </button>
              );
            })}
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}
