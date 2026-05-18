import { useCallback, useRef, useState } from 'react';
import type { ChapterDependencies, ChapterFormula, FormulaDependency } from '../types/formula';
import { formulaChapter } from '../utils/constants';
import { loadJSON } from '../utils/loadJSON';

interface ChapterCache {
  chapters: Map<string, ChapterDependencies>;
  pending: Map<string, Promise<ChapterDependencies | null>>;
}

export interface DependencyGraphApi {
  getFormula: (formulaId: string) => Promise<ChapterFormula | null>;
  getDependency: (formulaId: string) => Promise<FormulaDependency | null>;
  loadChapter: (chapterId: string) => Promise<ChapterDependencies | null>;
  error: string | null;
}

export function useDependencyGraph(): DependencyGraphApi {
  const cacheRef = useRef<ChapterCache>({ chapters: new Map(), pending: new Map() });
  const [error, setError] = useState<string | null>(null);

  const loadChapter = useCallback(async (chapterId: string) => {
    const cache = cacheRef.current;
    if (cache.chapters.has(chapterId)) return cache.chapters.get(chapterId)!;
    if (cache.pending.has(chapterId)) return cache.pending.get(chapterId)!;

    const promise = loadJSON<ChapterDependencies>(`/data/dependency/${chapterId}_dependencies.json`)
      .then((data) => {
        cache.chapters.set(chapterId, data);
        setError(null);
        return data;
      })
      .catch((err: Error) => {
        setError(err.message);
        return null;
      })
      .finally(() => {
        cache.pending.delete(chapterId);
      });
    cache.pending.set(chapterId, promise);
    return promise;
  }, []);

  const getFormula = useCallback(
    async (formulaId: string) => {
      const chapter = await loadChapter(formulaChapter(formulaId));
      return chapter?.formulas.find((formula) => formula.id === formulaId) || null;
    },
    [loadChapter],
  );

  const getDependency = useCallback(
    async (formulaId: string) => {
      const chapter = await loadChapter(formulaChapter(formulaId));
      return chapter?.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
    },
    [loadChapter],
  );

  return { getFormula, getDependency, loadChapter, error };
}
