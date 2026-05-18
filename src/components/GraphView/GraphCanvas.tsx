import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import type { SearchFormula } from '../../types/formula';
import type { DependencyEdgeData, FormulaNodeData, VariableNodeData } from '../../types/graph';
import type { LearningPath } from '../../types/path';
import { useDependencyGraph } from '../../hooks/useDependencyGraph';
import { useLearningPath } from '../../hooks/useLearningPath';
import { useGraphStore } from '../../stores/graphStore';
import { formulaChapter, rawFormulaNumber } from '../../utils/constants';
import { FormulaNode } from './FormulaNode';
import { VariableDefNode } from './VariableDefNode';
import { DependencyEdge } from './DependencyEdge';
import { layoutPrerequisites } from './graphLayout';
import { PathProgressBar } from '../PathPanel/PathProgressBar';
import './GraphView.css';

interface GraphCanvasProps {
  paths: LearningPath[];
  searchIndex: SearchFormula[];
}

const nodeTypes = {
  formula: FormulaNode,
  variableDefinition: VariableDefNode,
};

const edgeTypes = {
  dependency: DependencyEdge,
};

function GraphCanvasInner({ paths, searchIndex }: GraphCanvasProps) {
  const { focusFormulaId = '' } = useParams();
  const navigate = useNavigate();
  const graph = useDependencyGraph();
  const reactFlow = useReactFlow();
  const path = useLearningPath(paths);
  const markExpanded = useGraphStore((state) => state.markExpanded);
  const resetGraph = useGraphStore((state) => state.resetGraph);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const expandFormulaRef = useRef<(formulaId: string) => void>(() => undefined);
  const searchLookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  const setNodeLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refreshNodeData = useCallback(
    (items: Node[]) =>
      items.map((node) => {
        if (node.type !== 'formula') return node;
        const data = node.data as unknown as FormulaNodeData;
        return {
          ...node,
          data: {
            ...data,
            focused: node.id === focusFormulaId,
            loading: loadingIds.has(node.id),
            onExpand: (id: string) => expandFormulaRef.current(id),
          } satisfies FormulaNodeData,
        };
      }),
    [focusFormulaId, loadingIds],
  );

  const addFormulaNode = useCallback(
    async (formulaId: string, position = { x: 420, y: 260 }, focused = false): Promise<Node | null> => {
      const formula = await graph.getFormula(formulaId);
      if (!formula) return null;
      return {
        id: formula.id,
        type: 'formula',
        position,
        data: {
          formula,
          focused,
          loading: loadingIds.has(formula.id),
          onExpand: (id: string) => expandFormulaRef.current(id),
        } satisfies FormulaNodeData,
      };
    },
    [graph, loadingIds],
  );

  const expandFormula = useCallback(
    async (formulaId: string) => {
      const parent = nodes.find((node) => node.id === formulaId);
      if (!parent) return;
      setNodeLoading(formulaId, true);
      const dependency = await graph.getDependency(formulaId);
      if (!dependency) {
        setNodeLoading(formulaId, false);
        return;
      }

      const newPrereqs = dependency.prerequisites.filter((prereq) => {
        if (prereq.type === 'formula') return Boolean(prereq.target_id);
        return Boolean(prereq.symbol);
      });
      const positions = layoutPrerequisites(parent, newPrereqs.length, nodes);
      const nextNodes = [...nodes];
      const nextEdges = [...edges];

      for (let index = 0; index < newPrereqs.length; index += 1) {
        const prereq = newPrereqs[index];
        let sourceId = '';
        if (prereq.type === 'formula' && prereq.target_id) {
          sourceId = prereq.target_id;
          if (!nextNodes.some((node) => node.id === sourceId)) {
            const chapterId = formulaChapter(sourceId);
            await graph.loadChapter(chapterId);
            const formula = await graph.getFormula(sourceId);
            if (!formula) continue;
            nextNodes.push({
              id: sourceId,
              type: 'formula',
              position: positions[index],
              data: {
                formula,
                focused: sourceId === focusFormulaId,
                loading: false,
                onExpand: (id: string) => expandFormulaRef.current(id),
              } satisfies FormulaNodeData,
            });
          }
        } else if (prereq.type === 'variable_definition') {
          sourceId = `${formulaId}::var::${prereq.symbol}`;
          if (!nextNodes.some((node) => node.id === sourceId)) {
            nextNodes.push({
              id: sourceId,
              type: 'variableDefinition',
              position: positions[index],
              data: { prerequisite: prereq } satisfies VariableNodeData,
              draggable: false,
              selectable: false,
            });
          }
        }
        if (sourceId && !nextEdges.some((edge) => edge.id === `${sourceId}->${formulaId}`)) {
          nextEdges.push({
            id: `${sourceId}->${formulaId}`,
            source: sourceId,
            target: formulaId,
            type: 'dependency',
            markerEnd: prereq.type === 'formula' ? { type: MarkerType.ArrowClosed, color: prereq.cross_chapter ? '#6366f1' : '#94a3b8' } : undefined,
            data: {
              via: prereq.via_symbol || prereq.symbol || 'via',
              crossChapter: Boolean(prereq.cross_chapter),
              confidence: prereq.confidence,
            } satisfies DependencyEdgeData,
          });
        }
      }

      markExpanded(formulaId);
      setNodes(refreshNodeData(nextNodes));
      setEdges(nextEdges);
      setNodeLoading(formulaId, false);
      window.setTimeout(() => reactFlow.fitView({ padding: 0.24, duration: 650 }), 50);
    },
    [edges, focusFormulaId, graph, markExpanded, nodes, reactFlow, refreshNodeData, setNodeLoading],
  );

  useEffect(() => {
    expandFormulaRef.current = expandFormula;
  }, [expandFormula]);

  useEffect(() => {
    let cancelled = false;
    resetGraph();
    setNodes([]);
    setEdges([]);
    if (!focusFormulaId) return;
    addFormulaNode(focusFormulaId, { x: 520, y: 280 }, true).then((node) => {
      if (cancelled || !node) return;
      setNodes([node]);
      window.setTimeout(() => reactFlow.fitView({ padding: 0.35, duration: 500 }), 60);
    });
    return () => {
      cancelled = true;
    };
  }, [addFormulaNode, focusFormulaId, reactFlow, resetGraph]);

  useEffect(() => {
    setNodes((current) => refreshNodeData(current));
  }, [refreshNodeData]);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);

  return (
    <div className="relative h-[calc(100vh-80px)] w-full">
      <div className="absolute left-6 top-4 z-20 flex gap-2">
        <button type="button" onClick={() => navigate('/')} className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow">
          <ArrowLeft size={16} />
          Home
        </button>
        <button type="button" onClick={() => expandFormula(focusFormulaId)} className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow">
          <RefreshCcw size={16} />
          Expand
        </button>
      </div>
      {graph.error ? <div className="absolute right-6 top-4 z-20 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 shadow">{graph.error}</div> : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(connection) => setEdges((current) => addEdge(connection, current))}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-[#f0f4f8]"
      >
        <Background color="#cbd5e1" gap={28} />
        <MiniMap zoomable pannable nodeColor={(node) => (node.type === 'formula' ? '#3b82f6' : '#cbd5e1')} />
        <Controls />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-6 right-6 z-10 rounded-md bg-white/85 px-3 py-2 text-xs text-slate-500 shadow">
        {searchLookup.get(focusFormulaId)?.label || rawFormulaNumber(focusFormulaId)}
      </div>
      <PathProgressBar path={path} />
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
