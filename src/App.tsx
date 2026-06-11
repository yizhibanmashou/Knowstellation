import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Search } from 'lucide-react';
import { SearchBar } from './features/search/SearchBar';
import { AppErrorBoundary } from './shared/components/AppErrorBoundary';
import { useFormulaData } from './features/learning/useFormulaData';
import { useStarFieldStore } from './features/starfield/starFieldStore';
import { DEFAULT_LANGUAGE, getUiCopy } from './shared/utils/uiCopy';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const GraphPage = lazy(() => import('./pages/GraphPage').then((module) => ({ default: module.GraphPage })));
const ChapterPage = lazy(() => import('./pages/ChapterPage').then((module) => ({ default: module.ChapterPage })));
const StorylinePage = lazy(() => import('./pages/StorylinePage').then((module) => ({ default: module.StorylinePage })));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#02040a] text-sm font-semibold tracking-[0.18em] text-cyan-100/70">
      正在打开学习视图...
    </div>
  );
}

function AppShell() {
  const data = useFormulaData();
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const location = useLocation();
  const setAsleep = useStarFieldStore((state) => state.setAsleep);
  const isHome = location.pathname === '/' || location.pathname.startsWith('/chapter/') || location.pathname.startsWith('/storyline/');
  const isGraph = location.pathname.startsWith('/graph/');

  useEffect(() => {
    setAsleep(!isHome);
  }, [isHome, setAsleep]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className={`app-header ${isGraph ? 'app-header--graph' : ''} fixed left-0 right-0 top-0 z-30 h-20 items-center justify-between px-6 shadow-[0_18px_48px_rgba(2,6,23,0.32)] backdrop-blur-2xl md:px-10 ${isGraph ? 'border-b border-white/[0.07] bg-[#050917]/92 text-slate-100' : 'border-b border-white/[0.06] bg-[#050917]/88 text-slate-100'} ${isHome ? 'hidden' : 'flex'}`}>
        <a href="/" className="app-brand flex items-center gap-3 text-slate-100">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-[0_0_22px_rgba(59,130,246,0.12)] ${isGraph ? 'border-blue-300/18 bg-blue-500/10 text-blue-200' : 'border-blue-300/18 bg-blue-500/10 text-blue-300'}`}>
            <Search size={18} />
          </span>
          <span className="app-brand__copy">
            <span className="block text-sm font-semibold tracking-wide">Knowstellation</span>
            <span className={`app-brand__subtitle block text-xs ${isGraph ? 'text-slate-300' : 'text-slate-500'}`}>{copy.app.subtitle}</span>
          </span>
        </a>
        {isHome ? null : <SearchBar searchIndex={data.searchIndex} conceptIndex={data.conceptIndex} chapterNavigator={data.chapterNavigator} size="compact" tone="nav" />}
      </header>
      <main className={`relative z-10 min-h-screen ${isGraph ? 'app-main--graph' : ''}`}>
        <AppErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage data={data} />} />
              <Route path="/chapter/:chapterId" element={<ChapterPage data={data} />} />
              <Route path="/storyline/:storylineId" element={<StorylinePage data={data} />} />
              <Route
                path="/graph/chapter/:chapterId"
                element={<GraphPage chapterNavigator={data.chapterNavigator} themeRoutes={data.themeRoutes} searchIndex={data.searchIndex} formulaLearningCopy={data.formulaLearningCopy} storylines={data.storylines} />}
              />
              <Route
                path="/graph/:focusFormulaId"
                element={<GraphPage chapterNavigator={data.chapterNavigator} themeRoutes={data.themeRoutes} searchIndex={data.searchIndex} formulaLearningCopy={data.formulaLearningCopy} storylines={data.storylines} />}
              />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true }}>
      <AppShell />
    </BrowserRouter>
  );
}
