import { memo } from 'react';
import { BookOpen, SquareFunction } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ConceptMapNodeData } from '../../shared/types/graph';
import { formatConceptTitle, formatFormulaReferenceLabel } from '../../shared/utils/uiCopy';

export const ConceptMapNode = memo(function ConceptMapNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ConceptMapNodeData;
  const title = formatConceptTitle(nodeData.view.name, nodeData.view.defined_symbol);
  const className = [
    'concept-map-node',
    nodeData.active || selected ? 'concept-map-node--active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        className="concept-map-node__main nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          nodeData.onOpenConcept(nodeData.view.concept_id);
        }}
      >
        <span className="concept-map-node__eyebrow">Concept</span>
        <strong>{title}</strong>
        <span className="concept-map-node__meta">
          {nodeData.prerequisiteCount} pre · {nodeData.successorCount} next
        </span>
      </button>
      {nodeData.view.defined_by_formula_id ? (
        <button
          type="button"
          className="concept-map-node__formula nodrag nopan"
          title={formatFormulaReferenceLabel(nodeData.formulaLabel || nodeData.view.supporting_formula_label)}
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onOpenFormula(nodeData.view.defined_by_formula_id);
          }}
        >
          <SquareFunction size={13} />
          <span>{formatFormulaReferenceLabel(nodeData.formulaLabel || nodeData.view.supporting_formula_label)}</span>
        </button>
      ) : (
        <span className="concept-map-node__formula concept-map-node__formula--muted">
          <BookOpen size={13} />
          <span>No formula</span>
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
