import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SearchFormula } from '../../shared/types/formula';
import type { ChapterLayer, StudyContext } from '../../shared/types/learning';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { getStudyFormulaIds } from '../learning/learningNavigator';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';

interface StudyTimelineProps {
  studyContext: StudyContext;
  searchIndex: SearchFormula[];
}

export function StudyTimeline({ studyContext, searchIndex }: StudyTimelineProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph.timeline;
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params] = useSearchParams();
  const lookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);
  const formulaIds = getStudyFormulaIds(studyContext);
  const title = studyContext.type === 'chapter' ? studyContext.chapter.title_zh || studyContext.chapter.title_en : studyContext.type === 'theme' ? studyContext.route.title_zh || studyContext.route.title_en : '';

  if (!formulaIds.length) return null;

  const setLayer = (layer: ChapterLayer) => {
    if (studyContext.type !== 'chapter') return;
    const next = new URLSearchParams(params);
    next.set('layer', layer);
    if (routeChapterId && !focusFormulaId) navigate(`/graph/chapter/${routeChapterId}?${next.toString()}`);
    else navigate(`/graph/${focusFormulaId}?${next.toString()}`);
  };

  return (
    <div className={`study-timeline ${expanded ? 'study-timeline--expanded' : 'study-timeline--collapsed'}`}>
      <div className="study-timeline__header">
        <div className="study-timeline__title">
          <span className="study-timeline__eyebrow">{studyContext.type === 'chapter' ? copy.chapter : copy.theme}</span>
          <strong>{title}</strong>
        </div>
        {studyContext.type === 'chapter' ? (
          <div className="study-timeline__layers">
            <button type="button" className={studyContext.layer === 'backbone' ? 'active' : ''} onClick={() => setLayer('backbone')}>
              {copy.backbone}
            </button>
            <button type="button" className={studyContext.layer === 'full' ? 'active' : ''} onClick={() => setLayer('full')}>
              {copy.full}
            </button>
          </div>
        ) : null}
        <button type="button" className="study-timeline__toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? copy.collapse : copy.expand}
        </button>
      </div>
      {expanded ? <div className="study-timeline__track">
        {formulaIds.map((formulaId, index) => {
          const active = formulaId === focusFormulaId;
          const label = lookup.get(formulaId)?.label || rawFormulaNumber(formulaId);
          const nextParams = new URLSearchParams(params);
          if (!routeChapterId) {
            nextParams.set('selected', formulaId);
            nextParams.delete('conceptId');
          }
          const href = `/graph/${formulaId}?${nextParams.toString()}`;
          return (
            <button
              key={formulaId}
              type="button"
              className={`study-timeline__step ${active ? 'study-timeline__step--active' : ''}`}
              onClick={() => navigate(href)}
              aria-label={`第 ${index + 1} 步：${label}`}
              title={label}
            >
              <span className="study-timeline__step-index" aria-hidden="true">{index + 1}</span>
              <strong className="study-timeline__step-formula">{rawFormulaNumber(formulaId)}</strong>
            </button>
          );
        })}
      </div> : null}
    </div>
  );
}
