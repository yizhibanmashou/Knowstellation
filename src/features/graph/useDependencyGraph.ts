import { useCallback, useState } from 'react';
import type { ChapterDependencies, ChapterFormula, FormulaDependency } from '../../shared/types/formula';
import { formulaChapter } from '../../shared/utils/constants';
import { loadJSON } from '../../shared/utils/loadJSON';

interface ChapterCache {
  chapters: Map<string, ChapterDependencies>;
  pending: Map<string, Promise<ChapterDependencies>>;
}

const chapterCache: ChapterCache = { chapters: new Map(), pending: new Map() };

export interface DependencyGraphApi {
  getFormula: (formulaId: string) => Promise<ChapterFormula | null>;
  getDependency: (formulaId: string) => Promise<FormulaDependency | null>;
  getDependents: (formulaId: string) => Promise<FormulaDependency[]>;
  loadChapter: (chapterId: string) => Promise<ChapterDependencies | null>;
  resolveFormulaChapter: (formulaId: string) => string;
  error: string | null;
}

export function useDependencyGraph(): DependencyGraphApi {
  const [error, setError] = useState<string | null>(null);

  const resolveFormulaChapter = useCallback((formulaId: string) => formulaChapter(formulaId), []);

  const loadChapter = useCallback(async (chapterId: string) => {
    if (chapterCache.chapters.has(chapterId)) {
      setError(null);
      return chapterCache.chapters.get(chapterId)!;
    }

    let promise = chapterCache.pending.get(chapterId);
    if (!promise) {
      promise = loadJSON<ChapterDependencies>(`/data/dependency/${chapterId}_dependencies.json`)
        .then((data) => {
          chapterCache.chapters.set(chapterId, data);
          return data;
        })
        .finally(() => {
          chapterCache.pending.delete(chapterId);
        });
      chapterCache.pending.set(chapterId, promise);
    }

    try {
      const chapter = await promise;
      setError(null);
      return chapter;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const getFormula = useCallback(
    async (formulaId: string) => {
      const chapter = await loadChapter(resolveFormulaChapter(formulaId));
      return chapter?.formulas.find((formula) => formula.id === formulaId) || null;
    },
    [loadChapter, resolveFormulaChapter],
  );

  const getDependency = useCallback(
    async (formulaId: string) => {
      const chapter = await loadChapter(resolveFormulaChapter(formulaId));
      return chapter?.dependencies.find((dep) => dep.dependent_id === formulaId) || null;
    },
    [loadChapter, resolveFormulaChapter],
  );

  const getDependents = useCallback(
    async (formulaId: string) => {
      const chapter = await loadChapter(resolveFormulaChapter(formulaId));
      if (!chapter) return [];
      return chapter.dependencies.filter((dep) =>
        dep.prerequisites.some((prereq) => prereq.type === 'formula' && (prereq.edge_status ?? 'accepted') === 'accepted' && prereq.target_id === formulaId && !prereq.cross_chapter),
      );
    },
    [loadChapter, resolveFormulaChapter],
  );

  return { getFormula, getDependency, getDependents, loadChapter, resolveFormulaChapter, error };
}
