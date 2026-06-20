import { useMemo } from 'react';
import { Panel, type Edge, type Node } from '@xyflow/react';
import type { ConceptMapNodeData, ConceptNodeData, FormulaNodeData } from '../../shared/types/graph';
import { rawFormulaNumber } from '../../shared/utils/constants';
import type { getUiCopy } from '../../shared/utils/uiCopy';

export interface GraphAtlasProps {
  nodes: Node[];
  edges: Edge[];
  selectedFormulaId: string | null;
  selectedConceptId?: string | null;
  focusFormulaId: string;
  isChapterGraph: boolean;
  title: string;
  copy: ReturnType<typeof getUiCopy>['graph'];
  onSelectFormula: (formulaId: string) => void;
  onSelectConcept?: (conceptId: string) => void;
  variant?: 'panel' | 'embedded';
}

function minimapColorForNode(
  node: Node,
  selectedFormulaId: string | null,
  selectedConceptId: string | null | undefined,
  focusFormulaId: string,
  isChapterGraph: boolean,
): string {
  if (node.type === 'concept') {
    if (node.id === selectedConceptId) return '#5eead4';
    if (node.id.startsWith('introduced:')) return '#fbbf24';
    return '#2dd4bf';
  }
  if (node.id === selectedFormulaId) return '#22d3ee';
  if (!isChapterGraph && node.id === focusFormulaId) return '#60a5fa';
  if (node.type !== 'formula') return '#14b8a6';
  const nodeData = node.data as unknown as FormulaNodeData | undefined;
  const depth = Number(nodeData?.formula?.depth || 0);
  if (depth <= 0) return '#60a5fa';
  if (depth <= 2) return '#38bdf8';
  return '#1d4ed8';
}

export function GraphAtlas({
  nodes,
  edges,
  selectedFormulaId,
  selectedConceptId,
  focusFormulaId,
  isChapterGraph,
  title,
  copy,
  onSelectFormula,
  onSelectConcept,
  variant = 'panel',
}: GraphAtlasProps) {
  const previewNodes = useMemo(() => {
    if (!nodes.length) return [];
    const measured = nodes.map((node) => {
      const width = typeof node.measured?.width === 'number' && node.measured.width > 0 ? node.measured.width : node.type === 'formula' ? 276 : node.type === 'conceptMap' ? 168 : 230;
      const height = typeof node.measured?.height === 'number' && node.measured.height > 0 ? node.measured.height : node.type === 'formula' ? 160 : node.type === 'conceptMap' ? 96 : 92;
      return { node, x: node.position.x, y: node.position.y, width, height };
    });
    const minX = Math.min(...measured.map((item) => item.x));
    const minY = Math.min(...measured.map((item) => item.y));
    const maxX = Math.max(...measured.map((item) => item.x + item.width));
    const maxY = Math.max(...measured.map((item) => item.y + item.height));
    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const viewWidth = 188;
    const viewHeight = 92;
    const padding = 9;
    const scale = Math.min((viewWidth - padding * 2) / graphWidth, (viewHeight - padding * 2) / graphHeight);
    return measured.map((item) => {
      const conceptData = item.node.type === 'concept' ? item.node.data as unknown as ConceptNodeData | undefined : undefined;
      const conceptId = item.node.type === 'concept'
        ? (conceptData?.role === 'focus' ? conceptData?.view?.concept_id : conceptData?.reference?.concept_id || conceptData?.view?.concept_id)
        : item.node.type === 'conceptMap'
          ? (item.node.data as unknown as ConceptMapNodeData | undefined)?.view?.concept_id
          : undefined;
      const selectable = item.node.type === 'formula' || Boolean(conceptId && onSelectConcept);
      const w = Math.max(item.node.type === 'formula' ? 10 : 7, item.width * scale);
      const h = Math.max(item.node.type === 'formula' ? 7 : 5, item.height * scale);
      const hitWidth = item.node.type === 'formula' ? Math.max(4, Math.min(w, w * 0.86)) : Math.max(4, Math.min(w, w * 0.72));
      const hitHeight = item.node.type === 'formula' ? Math.max(2.4, Math.min(h, h * 0.42)) : Math.max(3, Math.min(h, h * 0.68));
      const x = padding + (item.x - minX) * scale;
      const y = padding + (item.y - minY) * scale;
      return {
        id: item.node.id,
        type: item.node.type,
        conceptId,
        x,
        y,
        width: w,
        height: h,
        hitX: x + (w - hitWidth) / 2,
        hitY: y + (h - hitHeight) / 2,
        hitWidth,
        hitHeight,
        color: minimapColorForNode(item.node, selectedFormulaId, selectedConceptId, focusFormulaId, isChapterGraph),
        active: item.node.id === selectedFormulaId || item.node.id === selectedConceptId || conceptId === selectedConceptId || (!isChapterGraph && item.node.type !== 'concept' && item.node.id === focusFormulaId),
        selectable,
        label: item.node.type === 'formula' ? rawFormulaNumber(item.node.id) : conceptId || item.node.id,
      };
    });
  }, [focusFormulaId, isChapterGraph, nodes, onSelectConcept, selectedConceptId, selectedFormulaId]);
  const previewLookup = useMemo(() => new Map(previewNodes.map((node) => [node.id, node])), [previewNodes]);
  const previewEdges = useMemo(
    () =>
      edges
        .map((edge) => {
          const source = previewLookup.get(edge.source);
          const target = previewLookup.get(edge.target);
          if (!source || !target) return null;
          return {
            id: edge.id,
            x1: source.x + source.width / 2,
            y1: source.y + source.height / 2,
            x2: target.x + target.width / 2,
            y2: target.y + target.height / 2,
            active: Boolean(
              (selectedFormulaId && (edge.source === selectedFormulaId || edge.target === selectedFormulaId))
                || (selectedConceptId && (edge.source === selectedConceptId || edge.target === selectedConceptId)),
            ),
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge)),
    [edges, previewLookup, selectedConceptId, selectedFormulaId],
  );

  const content = (
    <>
      <div className="graph-atlas-panel__header">
        <span>{copy.atlas}</span>
        <small>{title}</small>
      </div>
      <svg className="graph-atlas-map" viewBox="0 0 188 92" role="group" aria-label="Graph minimap overview" onPointerDown={(event) => event.stopPropagation()}>
        <defs>
          <linearGradient id="graph-atlas-focus-gradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <rect className="graph-atlas-map__plate" x="0" y="0" width="188" height="92" rx="12" />
        {previewEdges.map((edge) => (
          <line key={edge.id} className={edge.active ? 'graph-atlas-map__edge graph-atlas-map__edge--active' : 'graph-atlas-map__edge'} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
        ))}
        {previewNodes.map((node) => {
          const selectNode = () => {
            if (node.type === 'formula') onSelectFormula(node.id);
            else if (node.conceptId) onSelectConcept?.(node.conceptId);
          };
          return (
            <g key={node.id} className="graph-atlas-map__node-group">
              <rect
                className={[
                  'graph-atlas-map__node',
                  node.active ? 'graph-atlas-map__node--active' : '',
                  node.selectable ? 'graph-atlas-map__node--interactive' : '',
                ].filter(Boolean).join(' ')}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={node.type === 'formula' || node.type === 'conceptMap' ? 4 : 999}
                fill={node.active ? 'url(#graph-atlas-focus-gradient)' : node.color}
                aria-hidden="true"
              />
              {node.selectable ? (
                <rect
                  className={[
                    'graph-atlas-map__hit-zone',
                    node.active ? 'graph-atlas-map__node--active' : '',
                  ].filter(Boolean).join(' ')}
                  x={node.hitX}
                  y={node.hitY}
                  width={node.hitWidth}
                  height={node.hitHeight}
                  rx={node.type === 'formula' || node.type === 'conceptMap' ? 3 : 999}
                  role="button"
                  tabIndex={0}
                  aria-label={`Locate ${node.type === 'formula' ? 'formula' : 'concept'} ${node.label}`}
                  data-testid="graph-atlas-node"
                  data-formula-id={node.type === 'formula' ? node.id : undefined}
                  data-concept-id={node.type === 'formula' ? undefined : node.conceptId}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectNode();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    selectNode();
                  }}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="graph-atlas-panel__legend" aria-label="Graph minimap legend">
        <span><i className="graph-atlas-panel__legend-dot graph-atlas-panel__legend-dot--focus" />{copy.focus}</span>
        <span>{nodes.length} {copy.nodes}</span>
        <span>{edges.length} {copy.links}</span>
      </div>
    </>
  );

  if (variant === 'embedded') {
    return <div className="graph-atlas-panel graph-atlas-panel--embedded">{content}</div>;
  }

  return (
    <Panel position="bottom-right" className="graph-atlas-panel">
      {content}
    </Panel>
  );
}
