import katex from 'katex';
import { useMemo } from 'react';
import type { FeaturedFormula, SearchFormula } from '../../types/formula';
import { rawFormulaNumber } from '../../utils/constants';

interface FormulaTooltipProps {
  formula: FeaturedFormula;
  searchFormula?: SearchFormula;
  x: number;
  y: number;
}

export function FormulaTooltip({ formula, searchFormula, x, y }: FormulaTooltipProps) {
  const latex = searchFormula?.latex_preview || formula.latex_preview || '';
  const html = useMemo(() => katex.renderToString(latex, { throwOnError: false, displayMode: false }), [latex]);

  return (
    <div
      className="pointer-events-none fixed z-20 max-w-sm rounded-md border border-white/20 bg-slate-950/90 p-3 text-white shadow-2xl backdrop-blur"
      style={{ left: x + 18, top: y + 18 }}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-sm font-semibold">{searchFormula?.label || formula.label}</span>
        <span className="text-xs text-slate-400">{rawFormulaNumber(formula.id)}</span>
      </div>
      <div className="katex-container rounded bg-slate-50 px-2 py-2 text-center text-slate-950" dangerouslySetInnerHTML={{ __html: html }} />
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-300">{searchFormula?.context}</p>
    </div>
  );
}
