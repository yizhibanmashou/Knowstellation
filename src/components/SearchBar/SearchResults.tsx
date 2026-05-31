import type { SearchResult } from '../../types/search';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy } from '../../utils/uiCopy';
import { MathFormula } from '../common/MathFormula';

interface SearchResultsProps {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (id: string) => void;
  tone?: 'dark' | 'light' | 'nav';
}

function readableSearchContext(result: SearchResult): string {
  if (result.resultType === 'chapter') {
    return `${result.label} · ${result.formula_count} 个公式 · ${result.context}`;
  }
  const context = result.context.replace(/\s+/g, ' ').trim();
  if (!context) return formatSectionLabel(result.section) || '打开后可查看通俗解释、符号和前置关系。';
  const sentence = context
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .split(/(?<=[。.!?！？])\s*/)
    .find((item) => item.length > 18) || context;
  return sentence.length > 92 ? `${sentence.slice(0, 92).replace(/\s+\S*$/, '')}…` : sentence;
}

export function SearchResults({ results, selectedIndex, onSelect, tone = 'dark' }: SearchResultsProps) {
  if (!results.length) return null;

  const light = tone === 'light';
  const nav = tone === 'nav';
  const copy = getUiCopy(DEFAULT_LANGUAGE);

  return (
    <div
      className={
        light
          ? 'search-results-panel search-results-panel--light absolute left-0 right-0 top-14 max-h-[min(420px,54vh)] overflow-auto rounded-2xl border border-slate-200 bg-white/96 p-2 shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl'
          : nav
            ? 'search-results-panel search-results-panel--nav absolute left-0 right-0 top-14 max-h-[min(420px,54vh)] overflow-auto rounded-2xl border border-blue-300/14 bg-slate-950/94 p-2 shadow-[0_28px_70px_rgba(2,6,23,0.68)] backdrop-blur-2xl'
          : 'search-results-panel search-results-panel--dark absolute left-0 right-0 top-14 max-h-[min(360px,48vh)] overflow-auto rounded-2xl border border-cyan-100/14 bg-slate-950/94 p-2 shadow-[0_28px_70px_rgba(2,6,23,0.68)] backdrop-blur-2xl'
      }
    >
      {results.map((result, index) => (
        <button
          key={result.id}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(result.id)}
          className={
            light
              ? `block w-full rounded-xl px-3 py-3 text-left transition ${index === selectedIndex ? 'bg-blue-50 text-blue-900 shadow-inner' : 'text-slate-700 hover:bg-slate-50'}`
              : nav
                ? `block w-full rounded-xl px-3 py-3 text-left text-slate-200 transition ${index === selectedIndex ? 'bg-blue-400/12 shadow-[inset_0_0_0_1px_rgba(147,197,253,0.18)]' : 'hover:bg-white/7'}`
              : `block w-full rounded-xl px-3 py-3 text-left text-slate-200 transition ${index === selectedIndex ? 'bg-cyan-300/12 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.18)]' : 'hover:bg-white/7'}`
          }
        >
          <span className="flex items-center justify-between gap-3">
            <span className={light ? 'text-sm font-semibold text-slate-950' : 'text-sm font-semibold text-white'}>
              {result.resultType === 'chapter' ? result.title : result.label}
            </span>
            <span className={light ? 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500' : nav ? 'text-xs text-blue-200/65' : 'text-xs text-slate-400'}>
              {result.resultType === 'chapter' ? copy.search.chapterTag : formatChapterLabel(result.chapter_id, result.chapter)}
            </span>
          </span>
          {result.resultType !== 'chapter' && result.latex_preview ? (
            <MathFormula latex={result.latex_preview} inline className={light ? 'mt-1 text-slate-700 [&_.katex]:text-[0.85em]' : 'mt-1 text-slate-200 [&_.katex]:text-[0.85em]'} />
          ) : null}
          <span className={light ? 'mt-1 block truncate text-xs text-slate-500' : nav ? 'mt-1 block truncate text-xs text-slate-500' : 'mt-1 block truncate text-xs text-slate-400'}>
            {readableSearchContext(result)}
          </span>
        </button>
      ))}
    </div>
  );
}
