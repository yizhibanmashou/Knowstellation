import React, { useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import katex from 'katex';
import type { FormulaNodeData } from '../../types/graph';
import { chapterColor, rawFormulaNumber } from '../../utils/constants';

export const FormulaNode = React.memo(
  ({ id, data, selected }: NodeProps) => {
    const nodeData = data as unknown as FormulaNodeData;
    const formula = nodeData.formula;
    const html = useMemo(() => katex.renderToString(formula.latex, { throwOnError: false, displayMode: false }), [formula.latex]);
    const chapter = Number(rawFormulaNumber(formula.id).split('.')[0]);

    return (
      <button
        type="button"
        onClick={() => nodeData.onExpand(id)}
        className={`formula-node ${nodeData.focused ? 'formula-node--focused' : ''} ${selected ? 'formula-node--selected' : ''}`}
        style={{ borderLeftColor: chapterColor(chapter) }}
      >
        <Handle type="target" position={Position.Left} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-slate-900">{formula.label}</span>
          {nodeData.loading ? <span className="loading-dot" /> : <span className="text-[11px] text-slate-500">Ch {chapter}</span>}
        </div>
        <div className="katex-container mt-3 min-h-12 rounded-md bg-[#F8FAFC] px-2 py-2 text-center" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="mt-3 line-clamp-2 text-left text-[11px] leading-4 text-slate-500">{formula.section || formula.subsection}</div>
        <Handle type="source" position={Position.Right} />
      </button>
    );
  },
  (prev, next) => {
    const prevData = prev.data as unknown as FormulaNodeData;
    const nextData = next.data as unknown as FormulaNodeData;
    return (
      prev.id === next.id &&
      prev.selected === next.selected &&
      prevData.formula.latex === nextData.formula.latex &&
      prevData.focused === nextData.focused &&
      prevData.loading === nextData.loading
    );
  },
);
