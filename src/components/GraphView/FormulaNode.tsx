import React, { KeyboardEvent, MouseEvent, useMemo } from 'react';
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
    const active = nodeData.focused || selected;

    const expand = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation();
      nodeData.onExpand(id);
    };

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={expand}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            expand(event);
          }
        }}
        className={`formula-node ${nodeData.focused ? 'formula-node--focused' : ''} ${selected ? 'formula-node--selected' : ''}`}
        style={{ borderLeftColor: chapterColor(chapter) }}
      >
        <Handle type="target" position={Position.Left} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-normal text-slate-950">{formula.label}</div>
            <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Formula Entity</div>
          </div>
          {nodeData.loading ? (
            <span className="loading-dot mt-0.5 shrink-0" aria-label="Loading dependencies" />
          ) : (
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors duration-300 ${
                active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              Ch {chapter}
            </span>
          )}
        </div>
        <div
          className="katex-container mt-3 min-h-14 rounded-md border border-slate-100 bg-slate-50/80 px-3 py-3 text-center text-slate-950 transition-colors duration-300"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
          <div className="line-clamp-2 text-left text-[11px] leading-4 text-slate-500">{formula.section || formula.subsection}</div>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
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
