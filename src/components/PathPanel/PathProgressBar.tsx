import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { LearningPath } from '../../types/path';
import { rawFormulaNumber } from '../../utils/constants';

interface PathProgressBarProps {
  path: LearningPath | null;
}

export function PathProgressBar({ path }: PathProgressBarProps) {
  const navigate = useNavigate();
  const { focusFormulaId } = useParams();
  const [params] = useSearchParams();
  if (!path) return null;

  return (
    <div className="path-progress">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{path.title}</span>
        <span className="text-xs text-slate-500">{path.formula_ids.length} steps</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {path.formula_ids.map((formulaId, index) => {
          const active = formulaId === focusFormulaId;
          const visited = index <= Math.max(0, path.formula_ids.indexOf(focusFormulaId || ''));
          return (
            <button
              key={formulaId}
              type="button"
              onClick={() => navigate(`/graph/${formulaId}?path=${params.get('path') || path.id}`)}
              className={`path-step ${active ? 'path-step--active' : visited ? 'path-step--visited' : ''}`}
            >
              <span className="path-step-dot" />
              <span>{rawFormulaNumber(formulaId)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
