import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ChapterLayer, ChapterNavigatorPayload, StudyContext, ThemeRoute } from '../../shared/types/learning';
import { getChapterById, getChapterByNumber } from './learningNavigator';

interface UseStudyContextInput {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
}

export function useStudyContext({ chapterNavigator, themeRoutes }: UseStudyContextInput): StudyContext {
  const [params] = useSearchParams();
  const { chapterId: routeChapterId = '' } = useParams();

  return useMemo(() => {
    const study = params.get('study');
    if (study === 'chapter' || routeChapterId) {
      const chapterNumber = Number(params.get('chapter'));
      const chapterId = routeChapterId || params.get('chapterId');
      const chapter = chapterId ? getChapterById(chapterNavigator, chapterId) : getChapterByNumber(chapterNavigator, chapterNumber);
      const layer = params.get('layer') === 'full' ? 'full' : 'backbone';
      if (chapter) return { type: 'chapter', chapter, layer: layer as ChapterLayer };
    }
    if (study === 'theme') {
      const routeId = params.get('route');
      const route = themeRoutes.find((item) => item.id === routeId);
      if (route) return { type: 'theme', route };
    }
    return { type: 'free' };
  }, [chapterNavigator, params, routeChapterId, themeRoutes]);
}
