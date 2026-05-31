import { X } from 'lucide-react';
import type { FeaturedFormula, SearchFormula } from '../../types/formula';
import { rawFormulaNumber } from '../../utils/constants';
import { buildFormulaBrief, buildReadableFormulaCopy } from '../../utils/formulaInfo';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../utils/uiCopy';
import { FormulaBriefCard } from './FormulaBriefCard';
import { MathFormula } from './MathFormula';
import { RichMathText } from './RichMathText';

interface FormulaTooltipProps {
  formula: FeaturedFormula;
  searchFormula?: SearchFormula;
  x: number;
  y: number;
  pinned?: boolean;
  onClose?: () => void;
}

export function FormulaTooltip({ formula, searchFormula, x, y, pinned = false, onClose }: FormulaTooltipProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).formulaCard;
  const latex = searchFormula?.latex_preview || formula.latex_preview || '';
  const brief = buildFormulaBrief({ id: formula.id, featured: formula, search: searchFormula });
  const learningCopy = buildReadableFormulaCopy({
    language: DEFAULT_LANGUAGE,
    context: searchFormula?.context,
    latex,
    chapterTitle: searchFormula?.chapter ? copy.chapter.replace('{chapter}', String(searchFormula.chapter)) : formula.chapter,
    formulaLabel: searchFormula?.label || formula.display_name || formula.label,
    formulaNumber: rawFormulaNumber(formula.id),
    section: searchFormula?.section,
  });
  const tooltipW = pinned ? 420 : 360;
  const tooltipH = pinned ? 430 : 280;
  const gap = 24;

  const spaceRight = window.innerWidth - x - gap;
  const spaceBelow = window.innerHeight - y - gap;
  const spaceAbove = y - gap;

  const showRight = spaceRight >= tooltipW;
  const showLeft = x - gap - tooltipW >= 0;
  const showBelow = spaceBelow >= tooltipH;
  const showAbove = spaceAbove >= tooltipH;

  const left = showRight
    ? x + gap
    : showLeft
      ? x - tooltipW - gap
      : Math.max(18, window.innerWidth - tooltipW - 18);
  const top = showBelow
    ? y + gap
    : showAbove
      ? y - tooltipH - gap
      : Math.max(72, window.innerHeight - tooltipH - 16);

  return (
    <div
      className={`formula-tooltip fixed z-[60] rounded-lg border border-cyan-200/20 bg-slate-950/72 p-4 text-white shadow-[0_0_45px_rgba(45,212,191,0.22),0_22px_70px_rgba(0,0,0,0.48)] backdrop-blur-2xl ${pinned ? 'w-[min(420px,calc(100vw-32px))]' : 'w-[min(360px,calc(100vw-32px))]'}`}
      style={{ left, top }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-lg bg-[radial-gradient(circle_at_20%_0%,rgba(125,211,252,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_48%)]" />
      <div className="relative">
        {pinned ? (
          <>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="absolute right-0 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-slate-300 transition hover:bg-white/15 hover:text-white"
                aria-label={copy.close}
              >
                <X size={14} />
              </button>
            ) : null}
            <FormulaBriefCard brief={brief} compact />
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">{copy.tooltipEyebrow}</p>
                <h3 className="mt-1 truncate text-sm font-semibold text-white">{searchFormula?.label || formula.display_name || formula.label}</h3>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-medium text-slate-300">{rawFormulaNumber(formula.id)}</span>
            </div>

            <MathFormula latex={latex} className="formula-tooltip__math mt-3" />

            <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-300"><RichMathText text={learningCopy.plainMeaning} /></p>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <span className="text-[11px] text-slate-400">{copy.chapter.replace('{chapter}', String(searchFormula?.chapter || formula.chapter))}</span>
              <span className="text-[11px] text-cyan-100/70">{copy.tooltipHint}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
