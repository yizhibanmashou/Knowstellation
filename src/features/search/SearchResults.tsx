import type { SearchResult } from '../../shared/types/search';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy } from '../../shared/utils/uiCopy';
import { MathFormula } from '../../shared/components/MathFormula';

interface SearchResultsProps {
  id: string;
  query: string;
  results: SearchResult[];
  selectedIndex: number;
  isOpen: boolean;
  isSearching?: boolean;
  suggestions?: string[];
  onSuggestionSelect?: (value: string) => void;
  onSelect: (id: string) => void;
  tone?: 'dark' | 'light' | 'nav';
}

function readableSearchContext(result: SearchResult): string {
  if (result.resultType === 'chapter') {
    return `${result.label} · ${result.formula_count} 个公式 · ${result.context}`;
  }
  if (result.resultType === 'concept') {
    const context = result.context.replace(/\s+/g, ' ').trim();
    const meta = [result.formula_label, formatSectionLabel(result.formula_section)].filter(Boolean).join(' · ');
    return context ? `${meta ? `${meta} · ` : ''}${context}` : meta || '打开概念图查看定义、前置概念和支撑公式。';
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

export function SearchResults({
  id,
  query,
  results,
  selectedIndex,
  isOpen,
  isSearching = false,
  suggestions = [],
  onSuggestionSelect,
  onSelect,
  tone = 'dark',
}: SearchResultsProps) {
  if (!isOpen) return null;

  const light = tone === 'light';
  const nav = tone === 'nav';
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const hasQuery = Boolean(query.trim());
  const panelClass = light
    ? 'search-results-panel search-results-panel--light absolute left-0 right-0 top-14 max-h-[min(420px,54vh)] overflow-auto rounded-2xl border border-slate-200 bg-white/96 p-2 shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl'
    : nav
      ? 'search-results-panel search-results-panel--nav absolute left-0 right-0 top-14 max-h-[min(420px,54vh)] overflow-auto rounded-2xl border border-blue-300/14 bg-slate-950/94 p-2 shadow-[0_28px_70px_rgba(2,6,23,0.68)] backdrop-blur-2xl'
      : 'search-results-panel search-results-panel--dark absolute left-0 right-0 top-14 max-h-[min(360px,48vh)] overflow-auto rounded-2xl border border-cyan-100/14 bg-slate-950/94 p-2 shadow-[0_28px_70px_rgba(2,6,23,0.68)] backdrop-blur-2xl';
  const mutedClass = light ? 'text-slate-500' : nav ? 'text-blue-100/55' : 'text-slate-400';
  const hintClass = light ? 'text-slate-600' : 'text-slate-300';
  const suggestionClass = light
    ? 'rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'
    : nav
      ? 'rounded-full border border-blue-200/12 bg-blue-300/8 px-2.5 py-1 text-xs font-semibold text-blue-100/70 transition hover:border-blue-200/30 hover:bg-blue-300/14 hover:text-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/50'
      : 'rounded-full border border-cyan-100/12 bg-cyan-300/8 px-2.5 py-1 text-xs font-semibold text-cyan-100/75 transition hover:border-cyan-100/32 hover:bg-cyan-300/14 hover:text-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50';

  return (
    <div
      id={id}
      className={panelClass}
      role="listbox"
      aria-label="搜索结果"
    >
      {!hasQuery ? (
        <div className="px-3 py-2.5">
          <p className={`text-xs font-semibold ${hintClass}`}>可以直接搜公式编号、英文主题或中文概念</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button key={suggestion} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSuggestionSelect?.(suggestion)} className={suggestionClass}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {hasQuery && isSearching && !results.length ? (
        <div className={`px-3 py-4 text-sm ${mutedClass}`} role="status">
          正在匹配公式编号、章节主题和教材上下文...
        </div>
      ) : null}
      {hasQuery && !isSearching && !results.length ? (
        <div className="px-3 py-4">
          <p className={`text-sm font-semibold ${hintClass}`}>没有找到足够相关的结果</p>
          <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>试试公式编号（如 2.1）、英文关键词，或“选择 / 杂合度 / 有效群体大小”等中文主题。</p>
        </div>
      ) : null}
      {results.map((result, index) => (
        <button
          key={result.id}
          id={`${id}-${result.id}`}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(result.id)}
          className={
            light
              ? `block w-full cursor-pointer rounded-xl px-3 py-3 text-left transition ${index === selectedIndex ? 'bg-blue-50 text-blue-900 shadow-inner' : 'text-slate-700 hover:bg-slate-50'}`
              : nav
                ? `block w-full cursor-pointer rounded-xl px-3 py-3 text-left text-slate-200 transition ${index === selectedIndex ? 'bg-blue-400/12 shadow-[inset_0_0_0_1px_rgba(147,197,253,0.18)]' : 'hover:bg-white/7'}`
              : `block w-full cursor-pointer rounded-xl px-3 py-3 text-left text-slate-200 transition ${index === selectedIndex ? 'bg-cyan-300/12 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.18)]' : 'hover:bg-white/7'}`
          }
        >
          <span className="flex items-center justify-between gap-3">
            <span className={light ? 'min-w-0 truncate text-sm font-semibold text-slate-950' : 'min-w-0 truncate text-sm font-semibold text-white'}>
              {result.resultType === 'chapter' || result.resultType === 'concept' ? result.title : result.label}
            </span>
            <span className={light ? 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500' : nav ? 'text-xs text-blue-200/65' : 'text-xs text-slate-400'}>
              {result.resultType === 'chapter'
                ? copy.search.chapterTag
                : result.resultType === 'concept'
                  ? '概念'
                  : formatChapterLabel(result.chapter_id, result.chapter)}
            </span>
          </span>
          {result.resultType === 'formula' && result.latex_preview ? (
            <MathFormula latex={result.latex_preview} inline className={light ? 'mt-1 text-slate-700 [&_.katex]:text-[0.85em]' : 'mt-1 text-slate-200 [&_.katex]:text-[0.85em]'} />
          ) : null}
          {result.resultType === 'concept' && result.symbol ? (
            <MathFormula latex={result.symbol} inline className={light ? 'mt-1 text-slate-700 [&_.katex]:text-[0.85em]' : 'mt-1 text-slate-200 [&_.katex]:text-[0.85em]'} />
          ) : null}
          <span className={light ? 'mt-1 block truncate text-xs text-slate-500' : nav ? 'mt-1 block truncate text-xs text-slate-500' : 'mt-1 block truncate text-xs text-slate-400'}>
            {readableSearchContext(result)}
          </span>
          {result.matchReason ? (
            <span className={light ? 'mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700' : nav ? 'mt-2 inline-flex rounded-full bg-blue-300/10 px-2 py-0.5 text-[11px] font-semibold text-blue-100/70' : 'mt-2 inline-flex rounded-full bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100/75'}>
              {result.matchReason}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
