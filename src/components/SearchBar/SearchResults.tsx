import type { SearchFormula } from '../../types/formula';

interface SearchResultsProps {
  results: SearchFormula[];
  selectedIndex: number;
  onSelect: (id: string) => void;
}

export function SearchResults({ results, selectedIndex, onSelect }: SearchResultsProps) {
  if (!results.length) return null;

  return (
    <div className="absolute left-0 right-0 top-14 max-h-[60vh] overflow-auto rounded-md border border-slate-500/30 bg-slate-950/95 p-2 shadow-2xl backdrop-blur">
      {results.map((result, index) => (
        <button
          key={result.id}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(result.id)}
          className={`block w-full rounded px-3 py-3 text-left transition ${index === selectedIndex ? 'bg-blue-500/20' : 'hover:bg-white/10'}`}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white">{result.label}</span>
            <span className="text-xs text-slate-400">Ch {result.chapter}</span>
          </span>
          <span className="mt-1 block truncate font-serif text-sm text-slate-200">{result.latex_preview}</span>
          <span className="mt-1 block truncate text-xs text-slate-400">{result.context}</span>
        </button>
      ))}
    </div>
  );
}
