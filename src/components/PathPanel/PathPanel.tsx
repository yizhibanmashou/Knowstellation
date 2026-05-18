import type { SearchFormula } from '../../types/formula';
import type { LearningPath } from '../../types/path';
import { PathCard } from './PathCard';

interface PathPanelProps {
  paths: LearningPath[];
  searchIndex: SearchFormula[];
}

export function PathPanel({ paths, searchIndex }: PathPanelProps) {
  const lookup = new Map(searchIndex.map((item) => [item.id, item]));
  return (
    <aside className="w-full rounded-md border border-white/15 bg-slate-950/60 p-4 shadow-2xl backdrop-blur">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Learning Routes</h2>
        <p className="mt-1 text-sm text-slate-300">Curated paths through formula families.</p>
      </div>
      <div className="space-y-3">
        {paths.map((path) => (
          <PathCard key={path.id} path={path} lookup={lookup} />
        ))}
      </div>
    </aside>
  );
}
