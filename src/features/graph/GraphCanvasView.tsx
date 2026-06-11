import type { ReactNode } from 'react';
import {
  ReactFlow,
  addEdge,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { DependencyEdgeData } from '../../shared/types/graph';
import { formatChapterLabel, type getUiCopy } from '../../shared/utils/uiCopy';
import { standaloneGraphCopy } from './formulaInfo';
import { ConceptNode } from './ConceptNode';
import { DependencyEdge } from './DependencyEdge';
import { FormulaNode } from './FormulaNode';
import { GraphAtlas } from './GraphAtlas';
import { GraphToolbar } from './GraphToolbar';
import { chapterGraphBounds } from './graphLayout';
import type { GraphStudyMode } from './GraphModeControls';
import { VariableDefNode } from './VariableDefNode';

const nodeTypes = {
  concept: ConceptNode,
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
  onBackToConcept?: () => void;
  onBackToStoryline: () => void;
  onHome: () => void;
  onExpand: () => void;
  onDismissHint: () => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onSetEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onSelectFormula: (formulaId: string) => void;
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
  onBackToConcept,
  onBackToStoryline,
  onHome,
  onExpand,
  onDismissHint,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onSetEdges,
  onSelectFormula,
}: GraphCanvasViewProps) {
  const visibleEdges = decorateVisibleEdges(edges, selectedFormulaId, selectedConceptId);

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      <GraphToolbar
        copy={copy}
        mode={mode}
        toolbar={toolbar}
        conceptBackLabel={conceptBackLabel}
        storylineId={storylineId}
        storylineTitle={storylineTitle}
        isChapterGraph={isChapterGraph}
        showHint={showHint}
        onBackToConcept={onBackToConcept}
        onBackToStoryline={onBackToStoryline}
        onHome={onHome}
        onExpand={onExpand}
        onDismissHint={onDismissHint}
      />
      {error ? <div className="graph-error-card absolute right-6 top-16 z-20 max-w-sm rounded-md px-3 py-2 text-sm font-medium">{error}</div> : null}
      {graphNotice ? <div className="graph-empty-card graph-empty-card--top-notice absolute z-20 text-sm font-semibold">{graphNotice}</div> : null}
      {standaloneFocusId === focusFormulaId ? (
        <div className="graph-standalone-note absolute left-1/2 top-[128px] z-20 -translate-x-1/2" role="status">
          {standaloneGraphCopy()}
        </div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
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
        <GraphAtlas
          nodes={nodes}
          edges={visibleEdges}
          selectedFormulaId={selectedFormulaId}
          selectedConceptId={selectedConceptId}
          focusFormulaId={focusFormulaId}
          isChapterGraph={isChapterGraph}
          title={isChapterGraph ? copy.fullChapter : formatChapterLabel(focusChapterId)}
          copy={copy}
          onSelectFormula={onSelectFormula}
        />
      </ReactFlow>
      {isChapterGraph ? (
        <div className="graph-pan-hint pointer-events-none absolute left-6 top-[74px] z-10 rounded-md px-3 py-2 text-xs font-semibold">
          拖拽浏览全章，滚轮缩放；双击公式进入引导学习。
        </div>
      ) : null}
    </div>
  );
}
