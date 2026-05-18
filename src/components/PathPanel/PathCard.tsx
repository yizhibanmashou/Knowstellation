import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { SearchFormula } from '../../types/formula';
import type { LearningPath } from '../../types/path';
import { rawFormulaNumber } from '../../utils/constants';

interface PathCardProps {
  path: LearningPath;
  lookup: Map<string, SearchFormula>;
}

export function PathCard({ path, lookup }: PathCardProps) {
  const navigate = useNavigate();
  const first = path.formula_ids[0];
  const preview = path.formula_ids.map(rawFormulaNumber).join(' -> ');

  return (
    <button
      type="button"
      onClick={() => navigate(`/graph/${first}?path=${path.id}`)}
      className="w-full rounded-md border border-white/10 bg-white/[0.06] p-4 text-left transition hover:border-emerald-300/40 hover:bg-white/[0.09]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-semibold text-white">{path.title}</span>
        <ArrowRight size={16} className="text-emerald-200" />
      </span>
      <span className="mt-2 block text-sm leading-6 text-slate-300">{path.description}</span>
      <span className="mt-3 block truncate text-xs text-emerald-100/90">{preview}</span>
      <span className="mt-2 block truncate text-xs text-slate-400">{lookup.get(first)?.label}</span>
    </button>
  );
}
