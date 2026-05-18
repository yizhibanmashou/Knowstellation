import Fuse from 'fuse.js';
import type { SearchFormula } from '../../types/formula';

let fuse: Fuse<SearchFormula> | null = null;
let records: SearchFormula[] = [];

self.onmessage = (event: MessageEvent<{ type: string; payload?: unknown; query?: string }>) => {
  if (event.data.type === 'init') {
    records = event.data.payload as SearchFormula[];
    fuse = new Fuse(records, {
      keys: [
        { name: 'number', weight: 0.4 },
        { name: 'label', weight: 0.25 },
        { name: 'keywords', weight: 0.2 },
        { name: 'context', weight: 0.1 },
        { name: 'section', weight: 0.05 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });
    self.postMessage({ type: 'ready' });
    return;
  }

  if (event.data.type === 'search') {
    const query = (event.data.query || '').trim();
    if (!query) {
      self.postMessage({ type: 'results', results: [] });
      return;
    }
    const exact = records.filter((item) => item.number.toLowerCase().startsWith(query.toLowerCase())).slice(0, 8);
    const fuzzy = (fuse?.search(query, { limit: 12 }) || []).map((result) => result.item);
    const merged = [...exact, ...fuzzy].filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index);
    self.postMessage({ type: 'results', results: merged.slice(0, 10) });
  }
};
