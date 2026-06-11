import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import type { SearchFormula } from '../../shared/types/formula';
import type { ChapterNavigatorPayload } from '../../shared/types/learning';
import type { ChapterSearchResult, ConceptSearchResult, FormulaSearchResult, SearchResult } from '../../shared/types/search';
import { useSearchStore } from './searchStore';
import { flattenChapters } from '../starfield/starNavigation';
import { DEFAULT_LANGUAGE, formatChapterLabel, getUiCopy } from '../../shared/utils/uiCopy';
import {
  buildSearchQueryPlan,
  isChapterSearchQuery,
  rankSearchResults,
  scoreChapterSearch,
  scoreConceptSearch,
  scoreFormulaSearch,
  toConceptSearchResult,
  toFormulaSearchResult,
} from './searchMatching';
import { SearchResults } from './SearchResults';

interface SearchBarProps {
  searchIndex: SearchFormula[];
  conceptIndex?: ConceptSearchResult[];
  chapterNavigator?: ChapterNavigatorPayload;
  size?: 'default' | 'compact';
  tone?: 'dark' | 'light' | 'nav';
}

const SEARCH_SUGGESTIONS = ['2.1', '杂合度', '有效群体大小', 'selection', 'kappa'];

export function SearchBar({ searchIndex, conceptIndex = [], chapterNavigator, size = 'default', tone = 'dark' }: SearchBarProps) {
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const panelId = useId();
  const query = useSearchStore((state) => state.query);
  const results = useSearchStore((state) => state.results);
  const selectedIndex = useSearchStore((state) => state.selectedIndex);
  const setQuery = useSearchStore((state) => state.setQuery);
  const setResults = useSearchStore((state) => state.setResults);
  const setSelectedIndex = useSearchStore((state) => state.setSelectedIndex);
  const [isFocused, setIsFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const formulaLookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);
  const conceptLookup = useMemo(() => new Map(conceptIndex.map((item) => [item.id, item])), [conceptIndex]);
  const chapterResults = useMemo<ChapterSearchResult[]>(
    () =>
      chapterNavigator
        ? flattenChapters(chapterNavigator).map((chapter) => ({
            resultType: 'chapter',
            id: chapter.chapter_id,
            chapter_id: chapter.chapter_id,
            chapter: chapter.chapter,
            label: formatChapterLabel(chapter.chapter_id, chapter.chapter),
            title: chapter.title_zh || chapter.title_en.replace(' Formula Navigator', ''),
            context: chapter.description_zh || chapter.section_hint || chapter.description_en,
            formula_count: chapter.full_formula_ids.length,
          }))
        : [],
    [chapterNavigator],
  );

  const widthClass = size === 'compact' ? 'w-[min(360px,calc(100vw-48px))]' : 'w-[min(520px,48vw)]';
  const inputClass =
    tone === 'light'
      ? 'search-bar__input search-bar__input--light h-12 w-full rounded-xl border border-slate-200 bg-white/92 pl-11 pr-11 text-sm text-slate-950 shadow-[0_10px_28px_rgba(15,23,42,0.08)] outline-none backdrop-blur placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10'
      : tone === 'nav'
        ? 'search-bar__input search-bar__input--nav h-12 w-full rounded-2xl border border-blue-300/18 bg-[#071225]/88 pl-11 pr-11 text-sm text-slate-100 caret-blue-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035),0_14px_34px_rgba(2,6,23,0.36)] outline-none backdrop-blur-xl placeholder:text-slate-500 selection:bg-blue-300/18 focus:border-blue-300/48 focus:bg-[#08162b]/94 focus:ring-4 focus:ring-blue-500/10'
      : 'search-bar__input search-bar__input--dark h-12 w-full rounded-2xl border border-cyan-100/18 bg-slate-950/90 pl-11 pr-11 text-sm text-cyan-50 caret-cyan-200 shadow-[0_18px_44px_rgba(2,6,23,0.48)] outline-none backdrop-blur-xl placeholder:text-slate-500 selection:bg-cyan-300/20 focus:border-cyan-200/55 focus:bg-slate-950/95 focus:ring-4 focus:ring-cyan-300/10';
  const iconClass = tone === 'light' ? 'text-slate-400' : tone === 'nav' ? 'text-blue-200/70' : 'text-cyan-100/80';
  const clearClass = tone === 'light' ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700' : tone === 'nav' ? 'text-slate-400 hover:bg-white/8 hover:text-blue-100' : 'text-cyan-100/70 hover:bg-white/10 hover:text-white';

  const workerRef = useRef<Worker | null>(null);
  const searchRequestRef = useRef(0);

  useEffect(() => {
    if (!searchIndex.length) return;
    const worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.postMessage({ type: 'init', payload: searchIndex });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [searchIndex]);

  useEffect(() => {
    const queryPlan = buildSearchQueryPlan(query);
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (!queryPlan.normalized) {
      setIsSearching(false);
      setResults([]);
      return;
    }

    if (!searchIndex.length && !chapterResults.length && !conceptIndex.length) {
      setIsSearching(true);
      setResults([]);
      return;
    }

    const matchedChapters = rankSearchResults(
      chapterResults.flatMap((chapter): ChapterSearchResult[] => {
        const match = scoreChapterSearch(chapter, queryPlan);
        return match ? [{ ...chapter, searchScore: match.score, matchReason: match.reason }] : [];
      }),
    ).slice(0, 5);
    const matchedConcepts = rankSearchResults(
      conceptIndex.flatMap((concept): ConceptSearchResult[] => {
        const match = scoreConceptSearch(concept, queryPlan);
        return match ? [toConceptSearchResult(concept, match)] : [];
      }),
    ).slice(0, 6);
    const chapterOnly = isChapterSearchQuery(queryPlan);

    const commitResults = (formulaResults: FormulaSearchResult[]) => {
      if (searchRequestRef.current !== requestId) return;
      const merged = new Map<string, SearchResult>();
      [...matchedChapters, ...(chapterOnly ? [] : matchedConcepts), ...(chapterOnly ? [] : formulaResults)].forEach((item) => {
        const existing = merged.get(item.id);
        if (!existing || (item.searchScore || 0) > (existing.searchScore || 0)) {
          merged.set(item.id, item);
        }
      });
      setResults(rankSearchResults([...merged.values()]).slice(0, 10));
      setIsSearching(false);
    };

    setIsSearching(true);
    setResults(rankSearchResults([...matchedChapters, ...(chapterOnly ? [] : matchedConcepts)]).slice(0, 10));

    if (chapterOnly) {
      commitResults([]);
    } else if (workerRef.current) {
      workerRef.current.onmessage = (event) => {
        if (event.data.type === 'results' && event.data.requestId === requestId) {
          commitResults(event.data.results as FormulaSearchResult[]);
        }
      };
      workerRef.current.postMessage({ type: 'search', query, requestId });
    } else {
      const formulaResults = searchIndex
        .map((item) => {
          const match = scoreFormulaSearch(item, queryPlan);
          return match ? toFormulaSearchResult(item, match) : null;
        })
        .filter((item): item is FormulaSearchResult => Boolean(item));
      commitResults(formulaResults);
    }
  }, [chapterResults, conceptIndex, query, searchIndex, setResults]);

  const openResult = (resultId: string) => {
    const chapter = chapterResults.find((item) => item.id === resultId);
    if (chapter) {
      navigate(`/graph/chapter/${chapter.chapter_id}?study=chapter&chapterId=${chapter.chapter_id}&layer=full`);
      setQuery('');
      setResults([]);
      setIsFocused(false);
      return;
    }

    const concept = conceptLookup.get(resultId);
    if (concept) {
      navigate(`/graph/${concept.formula_id}?chapterId=${concept.chapter_id}&conceptId=${concept.concept_id}&selected=${concept.formula_id}`);
      setQuery('');
      setResults([]);
      setIsFocused(false);
      return;
    }

    const formula = formulaLookup.get(resultId);
    if (!formula) return;
    navigate(`/graph/${formula.id}?chapterId=${formula.chapter_id}`);
    setQuery('');
    setResults([]);
    setIsFocused(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const selected = results[selectedIndex] || results[0];
    if (selected) openResult(selected.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(Math.min(results.length - 1, selectedIndex + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (event.key === 'Escape') {
      setQuery('');
      setResults([]);
      setIsFocused(false);
    }
    if (event.key === 'Enter') {
      const selected = results[selectedIndex] || results[0];
      if (selected) {
        event.preventDefault();
        openResult(selected.id);
      }
    }
  };

  const chooseSuggestion = (value: string) => {
    setQuery(value);
    setIsFocused(true);
  };

  const panelOpen = isFocused;

  return (
    <form
      onSubmit={submit}
      onFocus={() => setIsFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocused(false);
      }}
      className={`search-bar relative ${widthClass} min-w-[260px]`}
      role="search"
    >
      <Search className={`pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 ${iconClass}`} size={17} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={copy.app.searchPlaceholder}
        className={inputClass}
        role="combobox"
        aria-controls={panelId}
        aria-expanded={panelOpen}
        aria-autocomplete="list"
        aria-activedescendant={results[selectedIndex] ? `${panelId}-${results[selectedIndex].id}` : undefined}
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setResults([]);
          }}
          className={`absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded p-1 ${clearClass}`}
          aria-label={copy.app.clearSearch}
        >
          <X size={16} />
        </button>
      ) : null}
      <SearchResults
        id={panelId}
        query={query}
        results={results}
        selectedIndex={selectedIndex}
        isOpen={isFocused}
        isSearching={isSearching}
        suggestions={SEARCH_SUGGESTIONS}
        onSuggestionSelect={chooseSuggestion}
        onSelect={openResult}
        tone={tone}
      />
    </form>
  );
}
