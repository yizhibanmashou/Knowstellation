import Fuse from 'fuse.js';
import type { SearchFormula } from '../../shared/types/formula';
import type { FormulaSearchResult } from '../../shared/types/search';
import {
  buildFormulaSearchDocument,
  buildSearchQueryPlan,
  rankSearchResults,
  scoreFormulaSearch,
  toFormulaSearchResult,
  type FormulaSearchDocument,
} from './searchMatching';

let fuse: Fuse<FormulaSearchDocument> | null = null;
let records: FormulaSearchDocument[] = [];

self.onmessage = (event: MessageEvent<{ type: string; payload?: unknown; query?: string; requestId?: number }>) => {
  if (event.data.type === 'init') {
    records = (event.data.payload as SearchFormula[]).map(buildFormulaSearchDocument);
    fuse = new Fuse(records, {
      keys: [
        { name: 'number', weight: 0.34 },
        { name: 'label', weight: 0.22 },
        { name: 'keywords', weight: 0.18 },
        { name: 'section', weight: 0.12 },
        { name: 'searchAliases', weight: 0.1 },
        { name: 'context', weight: 0.04 },
      ],
      threshold: 0.32,
      ignoreLocation: true,
      minMatchCharLength: 2,
      includeScore: true,
    });
    self.postMessage({ type: 'ready' });
    return;
  }

  if (event.data.type === 'search') {
    const plan = buildSearchQueryPlan(event.data.query || '');
    const requestId = event.data.requestId;
    if (!plan.normalized) {
      self.postMessage({ type: 'results', requestId, results: [] });
      return;
    }

    const direct = records
      .map((item) => {
        const match = scoreFormulaSearch(item, plan);
        return match ? toFormulaSearchResult(item, match) : null;
      })
      .filter((item): item is FormulaSearchResult => Boolean(item));

    const fuzzy = plan.variants
      .flatMap((variant) => fuse?.search(variant, { limit: 16 }) || [])
      .map((result) => {
        const searchScore = Math.max(0, Math.round(420 - (result.score || 0) * 420));
        return toFormulaSearchResult(result.item, {
          score: searchScore,
          reason: plan.hasCjkAlias ? '中文主题映射' : '模糊匹配',
        });
      });

    const merged = new Map<string, FormulaSearchResult>();
    [...direct, ...fuzzy].forEach((item) => {
      const existing = merged.get(item.id);
      if (!existing || (item.searchScore || 0) > (existing.searchScore || 0)) {
        merged.set(item.id, item);
      }
    });

    self.postMessage({ type: 'results', requestId, results: rankSearchResults([...merged.values()]).slice(0, 12) });
  }
};
