import type { FormulaDataState } from '../hooks/useFormulaData';
import { PathPanel } from '../components/PathPanel/PathPanel';

interface HomePageProps {
  data: FormulaDataState;
}

export function HomePage({ data }: HomePageProps) {
  return (
    <section className="grid min-h-screen grid-cols-1 items-center gap-8 px-6 pb-10 pt-28 md:grid-cols-[minmax(0,1fr)_360px] md:px-10">
      <div className="max-w-xl">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.22em] text-emerald-200/90">Walsh & Lynch formula map</p>
        <h1 className="text-balance text-5xl font-semibold leading-tight text-white md:text-7xl">LitGraph-RAG</h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-slate-200">
          Explore evolutionary biology formulas as prerequisite paths. Search a formula, enter a route, or pick a glowing point on the rotating atlas.
        </p>
        <div className="mt-8 flex gap-4 text-sm text-slate-300">
          <span>{data.searchIndex.length || '...'} formulas</span>
          <span>{data.featured.length || '...'} featured nodes</span>
          <span>{data.paths.length || '...'} routes</span>
        </div>
        {data.error ? <p className="mt-4 text-sm text-red-200">{data.error}</p> : null}
      </div>
      <PathPanel paths={data.paths} searchIndex={data.searchIndex} />
    </section>
  );
}
