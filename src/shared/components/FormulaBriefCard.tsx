import { MoveUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildReadableFormulaCopy, type FormulaBrief } from '../../features/graph/formulaInfo';
import { DEFAULT_LANGUAGE, getUiCopy } from '../utils/uiCopy';
import { MathFormula } from './MathFormula';
import { RichMathText } from './RichMathText';

interface FormulaBriefCardProps {
  brief: FormulaBrief;
  compact?: boolean;
}

export function FormulaBriefCard({ brief, compact = false }: FormulaBriefCardProps) {
  const navigate = useNavigate();
  const copy = getUiCopy(DEFAULT_LANGUAGE).formulaCard;
  const learningCopy = buildReadableFormulaCopy({
    language: DEFAULT_LANGUAGE,
    context: compact ? brief.shortContext : brief.longContext,
    chapterTitle: brief.chapter ? copy.chapter.replace('{chapter}', String(brief.chapter)) : undefined,
    formulaLabel: brief.title,
    formulaNumber: brief.number,
    latex: brief.latex,
    section: brief.section,
  });

  return (
    <article className="formula-brief-card">
      <div className="formula-brief-card__header">
        <div className="min-w-0">
          <p className="formula-brief-card__eyebrow">{copy.eyebrow} {brief.number}</p>
          <h3 className="formula-brief-card__title">{brief.title}</h3>
        </div>
        {brief.chapter ? <span className="formula-brief-card__chapter">{copy.chapter.replace('{chapter}', String(brief.chapter))}</span> : null}
      </div>

      <MathFormula latex={brief.latex} className="formula-brief-card__math" />

      <section className="formula-brief-card__section formula-brief-card__section--what-it-says">
        <h4>{copy.whatItSays}</h4>
        <div className="formula-brief-card__copy-block formula-brief-card__copy-block--takeaway">
          <span>一眼看懂</span>
          <p><RichMathText text={learningCopy.takeaway} /></p>
        </div>
        <div className="formula-brief-card__copy-block">
          <span>{copy.plain}</span>
          <p><RichMathText text={learningCopy.plainMeaning} /></p>
        </div>
        <div className="formula-brief-card__copy-block">
          <span>{copy.inChapter}</span>
          <p><RichMathText text={learningCopy.inThisChapter} /></p>
        </div>
        <div className="formula-brief-card__copy-block">
          <span>下一步</span>
          <p><RichMathText text={learningCopy.nextAction} /></p>
        </div>
      </section>

      <button type="button" onClick={() => navigate(`/graph/${brief.id}`)} className="formula-brief-card__action">
        {copy.openGraph}
        <MoveUpRight size={13} />
      </button>
    </article>
  );
}
