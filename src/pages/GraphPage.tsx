import type { SearchFormula } from '../types/formula';
import type { LearningPath } from '../types/path';
import { GraphCanvas } from '../components/GraphView/GraphCanvas';

interface GraphPageProps {
  paths: LearningPath[];
  searchIndex: SearchFormula[];
}

export function GraphPage({ paths, searchIndex }: GraphPageProps) {
  return (
    <section className="min-h-screen bg-[#f0f4f8] pt-20 text-slate-900">
      <GraphCanvas paths={paths} searchIndex={searchIndex} />
    </section>
  );
}
