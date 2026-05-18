import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import type { SearchFormula } from '../../types/formula';
import { useSearchStore } from '../../stores/searchStore';
import { SearchResults } from './SearchResults';

interface SearchBarProps {
  searchIndex: SearchFormula[];
}

export function SearchBar({ searchIndex }: SearchBarProps) {
  const navigate = useNavigate();
  const workerRef = useRef<Worker | null>(null);
  const query = useSearchStore((state) => state.query);
  const results = useSearchStore((state) => state.results);
  const selectedIndex = useSearchStore((state) => state.selectedIndex);
  const setQuery = useSearchStore((state) => state.setQuery);
  const setResults = useSearchStore((state) => state.setResults);
  const setSelectedIndex = useSearchStore((state) => state.setSelectedIndex);

  const lookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  useEffect(() => {
    if (!searchIndex.length) return;
    const worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; results?: SearchFormula[] }>) => {
      if (event.data.type === 'results') setResults(event.data.results || []);
    };
    worker.postMessage({ type: 'init', payload: searchIndex });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [searchIndex, setResults]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      workerRef.current?.postMessage({ type: 'search', query });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const openFormula = (formulaId: string) => {
    const formula = lookup.get(formulaId);
    if (!formula) return;
    navigate(`/graph/${formula.id}`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const selected = results[selectedIndex] || results[0];
    if (selected) openFormula(selected.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
    }
  };

  return (
    <form onSubmit={submit} className="relative w-[min(520px,48vw)] min-w-[280px]">
      <Search className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-slate-300" size={17} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search formula, keyword, or number"
        className="h-12 w-full rounded-md border border-slate-400/30 bg-slate-950/80 pl-11 pr-11 text-sm text-white shadow-lg outline-none backdrop-blur placeholder:text-slate-400 focus:border-blue-300"
      />
      {query ? (
        <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded p-1 text-slate-300 hover:bg-white/10">
          <X size={16} />
        </button>
      ) : null}
      <SearchResults results={results} selectedIndex={selectedIndex} onSelect={openFormula} />
    </form>
  );
}
