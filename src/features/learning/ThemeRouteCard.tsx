import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThemeRoute } from '../../shared/types/learning';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';

interface ThemeRouteCardProps {
  route: ThemeRoute;
}

export function ThemeRouteCard({ route }: ThemeRouteCardProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE).navigator;
  const first = route.formula_ids[0];

  return (
    <article className={`learning-card ${open ? 'learning-card--open' : ''}`}>
      <button type="button" className="learning-card__summary" onClick={() => setOpen((value) => !value)}>
        <span className="learning-card__eyebrow">{copy.themeRoute}</span>
        <strong>{route.title_zh || route.title_en}</strong>
        <span>{route.formula_ids.length} {copy.formulas} · {route.difficulty}</span>
      </button>
      {open ? (
        <div className="learning-card__preview">
          <p>{route.description_zh || route.description_en}</p>
          <div className="learning-card__sequence">
            {route.formula_ids.slice(0, 5).map((id) => (
              <span key={id}>{rawFormulaNumber(id)}</span>
            ))}
          </div>
          <button type="button" disabled={!first} onClick={() => navigate(`/graph/${first}?study=theme&route=${route.id}`)}>
            {copy.startRoute}
          </button>
        </div>
      ) : null}
    </article>
  );
}
