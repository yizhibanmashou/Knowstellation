import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { FormulaDataState } from '../hooks/useFormulaData';
import { SearchBar } from '../components/SearchBar/SearchBar';
import { StarField } from '../components/StarField/StarField';
import { MathFormula } from '../components/common/MathFormula';
import { buildChapterStarNodes, type StarNode } from '../utils/starNavigation';
import { rawFormulaNumber } from '../utils/constants';
import { DEFAULT_LANGUAGE, getUiCopy } from '../utils/uiCopy';

interface HomePageProps {
  data: FormulaDataState;
}

export function HomePage({ data }: HomePageProps) {
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const chapterNodes = useMemo(() => buildChapterStarNodes(data.chapterNavigator), [data.chapterNavigator]);

  const enterNode = (node: StarNode) => {
    if (node.chapterId) navigate(`/chapter/${node.chapterId}`);
  };

  return (
    <section className="home-shell flex min-h-screen w-full flex-col overflow-y-auto overflow-x-hidden bg-[#02040a] text-white font-['Space_Grotesk'] lg:h-screen lg:flex-row lg:overflow-hidden">
      <div className="relative min-h-[760px] min-w-0 flex-1 overflow-hidden sm:min-h-screen lg:min-h-0">
        <StarField nodes={chapterNodes} visible onEnterNode={enterNode} rightReserveClassName="home-starry-sky" />

        {/* HUD Elements */}
        <div className="pointer-events-none absolute inset-0 z-20 border-[24px] border-white/[0.02]" />
        <div className="pointer-events-none absolute left-10 top-10 z-20 h-4 w-4 border-l-2 border-t-2 border-cyan-500/30" />
        <div className="pointer-events-none absolute right-10 top-10 z-20 h-4 w-4 border-r-2 border-t-2 border-cyan-500/30" />
        <div className="pointer-events-none absolute bottom-10 left-10 z-20 h-4 w-4 border-b-2 border-l-2 border-cyan-500/30" />
        <div className="pointer-events-none absolute bottom-10 right-10 z-20 h-4 w-4 border-b-2 border-r-2 border-cyan-500/30" />

        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(2,4,10,0.54)_0%,rgba(2,4,10,0.18)_34%,transparent_58%,rgba(2,4,10,0.14)_100%),linear-gradient(180deg,rgba(2,4,10,0.02)_0%,transparent_48%,rgba(2,4,10,0.48)_100%)]" />

        <div className="home-search-panel absolute left-6 right-6 top-8 z-30 animate-[fadeSlideUp_0.8s_ease_both] sm:left-10 sm:right-auto sm:w-[min(420px,calc(100%-80px))]">
          <SearchBar searchIndex={data.searchIndex} chapterNavigator={data.chapterNavigator} size="compact" />
        </div>

        <div className="home-hero-copy pointer-events-none absolute bottom-10 left-6 right-6 z-20 max-w-2xl pt-28 sm:left-10 sm:right-auto sm:pr-6 md:left-14 md:bottom-14">
          <div className="home-hero-eyebrow flex items-center gap-3 mb-5 animate-[fadeSlideUp_0.7s_ease_0.1s_both]">
            <span className="h-[1px] w-8 bg-cyan-500/50" />
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-400/80">{copy.home.eyebrow}</p>
          </div>
          <h1 className="home-hero-title text-balance text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl md:text-8xl animate-[fadeSlideUp_0.7s_ease_0.25s_both] bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(255,255,255,0.15)]">
            Formula <span className="text-cyan-400/90 font-light">Atlas</span>
          </h1>
          <p className="home-hero-intro mt-6 max-w-lg text-base leading-relaxed text-slate-300 sm:mt-8 sm:text-lg animate-[fadeSlideUp_0.7s_ease_0.45s_both]">
            {copy.home.intro}
          </p>
          <div className="home-hero-stats mt-10 flex flex-wrap gap-4 text-xs font-bold tracking-widest uppercase text-slate-500 animate-[fadeSlideUp_0.7s_ease_0.65s_both]">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.03] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
              <span>{chapterNodes.length || '...'} {copy.home.sectors}</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.03] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
              <span>{data.searchIndex.length || '...'} {copy.home.nodes}</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/5 bg-white/[0.03] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
              <span>{data.storylines.length || '...'} {copy.home.paths}</span>
            </div>
          </div>
          {data.error ? <p className="mt-6 max-w-lg rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-sm text-red-400 backdrop-blur-xl">{data.error}</p> : null}
        </div>
      </div>

      <aside className="home-story-panel relative z-20 w-full shrink-0 overflow-y-auto border-t border-white/[0.06] bg-[#02040a]/92 px-5 py-8 shadow-[-30px_0_70px_rgba(0,0,0,0.5)] backdrop-blur-3xl sm:px-7 lg:h-full lg:w-[400px] lg:border-l lg:border-t-0">
        <div className="mb-8 animate-[fadeSlideUp_0.8s_ease_both]">
          <p className="text-[11px] font-black uppercase tracking-[0.25em] text-cyan-500/70">{copy.home.pathways}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">叙事线索</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-400">{copy.home.pathwayIntro}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          {data.storylines.map((storyline, idx) => {
            return (
              <article key={storyline.id} className="storyline-card" style={{ animationDelay: `${0.1 + idx * 0.1}s` } as any}>
                <MathFormula latex={storyline.symbol} inline className="storyline-card__symbol" />
                <h3>{storyline.title_zh || storyline.title_en}</h3>
                <p className="line-clamp-2">{storyline.intro_zh || storyline.intro_en}</p>
                <div className="storyline-card__steps">
                  {storyline.steps.slice(0, 4).map((step) => (
                    <span key={step.formula_id}>{rawFormulaNumber(step.formula_id)}</span>
                  ))}
                  {storyline.steps.length > 4 ? <span className="opacity-50">+ {storyline.steps.length - 4}</span> : null}
                </div>
                <button
                  type="button"
                  disabled={!storyline.steps.length}
                  onClick={() => navigate(`/storyline/${storyline.id}`)}
                >
                  {copy.home.enterStoryline}
                  <ArrowRight size={14} />
                </button>
              </article>
            );
          })}
        </div>
      </aside>
    </section>
  );
}
