import { useState } from 'react';
import type { SearchFormula } from '../../shared/types/formula';
import type { ChapterNavigatorPayload, ThemeRoute } from '../../shared/types/learning';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { ChapterGroup } from './ChapterGroup';
import { ThemeRouteCard } from './ThemeRouteCard';

type NavigatorMode = 'chapter' | 'theme';

interface LearningNavigatorProps {
  chapterNavigator: ChapterNavigatorPayload;
  themeRoutes: ThemeRoute[];
  searchIndex: SearchFormula[];
}

export function LearningNavigator({ chapterNavigator, themeRoutes, searchIndex }: LearningNavigatorProps) {
  const [mode, setMode] = useState<NavigatorMode>('chapter');
  const copy = getUiCopy(DEFAULT_LANGUAGE).navigator;

  return (
    <aside className="learning-navigator">
      <div className="learning-navigator__header">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="learning-navigator__tabs">
          <button type="button" className={mode === 'chapter' ? 'active' : ''} onClick={() => setMode('chapter')}>{copy.byChapter}</button>
          <button type="button" className={mode === 'theme' ? 'active' : ''} onClick={() => setMode('theme')}>{copy.byTheme}</button>
        </div>
      </div>
      <div className="learning-navigator__body">
        {mode === 'chapter'
          ? chapterNavigator.groups.map((group) => <ChapterGroup key={group.id} group={group} searchIndex={searchIndex} />)
          : themeRoutes.map((route) => <ThemeRouteCard key={route.id} route={route} />)}
      </div>
    </aside>
  );
}
