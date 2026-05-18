import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Search } from 'lucide-react';
import { StarField } from './components/StarField/StarField';
import { SearchBar } from './components/SearchBar/SearchBar';
import { HomePage } from './pages/HomePage';
import { GraphPage } from './pages/GraphPage';
import { useFormulaData } from './hooks/useFormulaData';
import { useStarFieldStore } from './stores/starFieldStore';

function AppShell() {
  const data = useFormulaData();
  const location = useLocation();
  const setAsleep = useStarFieldStore((state) => state.setAsleep);
  const isHome = location.pathname === '/';

  useEffect(() => {
    setAsleep(!isHome);
  }, [isHome, setAsleep]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <StarField featured={data.featured} searchIndex={data.searchIndex} visible={isHome} />
      <header className="fixed left-0 right-0 top-0 z-30 flex h-20 items-center justify-between px-6 md:px-10">
        <a href="/" className="flex items-center gap-3 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-white/10">
            <Search size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-wide">LitGraph-RAG</span>
            <span className="block text-xs text-slate-300">Formula prerequisite atlas</span>
          </span>
        </a>
        <SearchBar searchIndex={data.searchIndex} />
      </header>
      <main className="relative z-10 min-h-screen">
        <Routes>
          <Route path="/" element={<HomePage data={data} />} />
          <Route path="/graph/:focusFormulaId" element={<GraphPage paths={data.paths} searchIndex={data.searchIndex} />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
