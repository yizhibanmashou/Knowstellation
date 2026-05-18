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
  type XYPosition,
} from '@xyflow/react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import type { ChapterFormula, SearchFormula } from '../../types/formula';
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
  const { getFormula, getDependency, loadChapter, error } = useDependencyGraph();
  const reactFlow = useReactFlow();
  const path = useLearningPath(paths);
  const markExpanded = useGraphStore((state) => state.markExpanded);
  const resetGraph = useGraphStore((state) => state.resetGraph);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const nodesRef = useRef<Node[]>([]);
  const expandFormulaRef = useRef<(formulaId: string) => void>(() => undefined);
  const searchLookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const setNodeLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const makeFormulaNode = useCallback(
    (formula: ChapterFormula, position: XYPosition, focused = false): Node => ({
      id: formula.id,
      type: 'formula',
      position,
      data: {
        formula,
        focused,
        loading: false,
        onExpand: (id: string) => expandFormulaRef.current(id),
      } satisfies FormulaNodeData,
    }),
    [],
  );

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

  const expandFormula = useCallback(
    async (formulaId: string) => {
      const initialParent = nodesRef.current.find((node) => node.id === formulaId);
      if (!initialParent) return;

      setNodeLoading(formulaId, true);
      try {
        const dependency = await getDependency(formulaId);
        if (!dependency) return;

        const prerequisites = dependency.prerequisites.filter((prereq) => {
          if (prereq.type === 'formula') return Boolean(prereq.target_id);
          return Boolean(prereq.symbol);
        });

        const formulaPrereqs = new Map<string, ChapterFormula>();
        for (const prereq of prerequisites) {
          if (prereq.type !== 'formula' || !prereq.target_id) continue;
          await loadChapter(formulaChapter(prereq.target_id));
          const formula = await getFormula(prereq.target_id);
          if (formula) formulaPrereqs.set(prereq.target_id, formula);
        }

        setNodes((currentNodes) => {
          const parent = currentNodes.find((node) => node.id === formulaId);
          if (!parent) return currentNodes;
          const nextNodes = [...currentNodes];
          const positions = layoutPrerequisites(parent, prerequisites.length, currentNodes);

          prerequisites.forEach((prereq, index) => {
            if (prereq.type === 'formula' && prereq.target_id) {
              if (nextNodes.some((node) => node.id === prereq.target_id)) return;
              const formula = formulaPrereqs.get(prereq.target_id);
              if (!formula) return;
              nextNodes.push(makeFormulaNode(formula, positions[index], prereq.target_id === focusFormulaId));
              return;
            }

            if (prereq.type === 'variable_definition') {
              const variableNodeId = `${formulaId}::var::${prereq.symbol}`;
              if (nextNodes.some((node) => node.id === variableNodeId)) return;
              nextNodes.push({
                id: variableNodeId,
                type: 'variableDefinition',
                position: positions[index],
                data: { prerequisite: prereq } satisfies VariableNodeData,
                draggable: false,
                selectable: false,
              });
            }
          });

          return refreshNodeData(nextNodes);
        });

        setEdges((currentEdges) => {
          const nextEdges = [...currentEdges];
          prerequisites.forEach((prereq) => {
            const sourceId = prereq.type === 'formula' ? prereq.target_id : `${formulaId}::var::${prereq.symbol}`;
            if (!sourceId) return;
            const edgeId = `${sourceId}->${formulaId}`;
            if (nextEdges.some((edge) => edge.id === edgeId)) return;
            nextEdges.push({
              id: edgeId,
              source: sourceId,
              target: formulaId,
              type: 'dependency',
              markerEnd:
                prereq.type === 'formula'
                  ? { type: MarkerType.ArrowClosed, color: prereq.cross_chapter ? '#6366f1' : '#94a3b8' }
                  : undefined,
              data: {
                via: prereq.via_symbol || prereq.symbol || 'via',
                crossChapter: Boolean(prereq.cross_chapter),
                confidence: prereq.confidence,
              } satisfies DependencyEdgeData,
            });
          });
          return nextEdges;
        });

        markExpanded(formulaId);
        window.setTimeout(() => reactFlow.fitView({ padding: 0.24, duration: 650 }), 50);
      } finally {
        setNodeLoading(formulaId, false);
      }
    },
    [focusFormulaId, getDependency, getFormula, loadChapter, makeFormulaNode, markExpanded, reactFlow, refreshNodeData, setNodeLoading],
  );

  useEffect(() => {
    expandFormulaRef.current = expandFormula;
  }, [expandFormula]);

  useEffect(() => {
    let cancelled = false;
    resetGraph();
    setNodes([]);
    setEdges([]);
    setLoadingIds(new Set());
    if (!focusFormulaId) return;

    getFormula(focusFormulaId).then((formula) => {
      if (cancelled || !formula) return;
      setNodes([makeFormulaNode(formula, { x: 520, y: 280 }, true)]);
      window.setTimeout(() => reactFlow.fitView({ padding: 0.35, duration: 500 }), 60);
    });

    return () => {
      cancelled = true;
    };
  }, [focusFormulaId, getFormula, makeFormulaNode, reactFlow, resetGraph]);

  useEffect(() => {
    setNodes((current) => refreshNodeData(current));
  }, [refreshNodeData]);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);

  return (
    <div className="relative h-[calc(100vh-80px)] w-full overflow-hidden bg-slate-50">
      <div className="absolute left-6 top-4 z-20 flex gap-2">
        <button type="button" onClick={() => navigate('/')} className="graph-toolbar-button inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700">
          <ArrowLeft size={16} />
          Home
        </button>
        <button type="button" onClick={() => expandFormula(focusFormulaId)} className="graph-toolbar-button inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700">
          <RefreshCcw size={16} />
          Expand
        </button>
      </div>
      {error ? <div className="graph-error-card absolute right-6 top-4 z-20 max-w-sm rounded-md px-3 py-2 text-sm font-medium text-red-700">{error}</div> : null}
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
        <Background color="#cbd5e1" gap={30} size={1.2} />
        <MiniMap
          zoomable
          pannable
          maskColor="rgba(241, 245, 249, 0.68)"
          nodeBorderRadius={8}
          nodeStrokeWidth={3}
          nodeColor={(node) => (node.type === 'formula' ? '#3b82f6' : '#cbd5e1')}
        />
        <Controls />
      </ReactFlow>
      <div className="graph-context-chip pointer-events-none absolute bottom-6 right-6 z-10 rounded-md px-3 py-2 text-xs font-medium text-slate-500">
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
