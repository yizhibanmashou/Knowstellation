import { Fragment, useMemo } from 'react';
import { splitRichMathText } from '../utils/richMathText';
import { renderMathToHtml } from './MathFormula';

interface RichMathTextProps {
  text?: string | null;
  className?: string;
}

export function RichMathText({ text = '', className = '' }: RichMathTextProps) {
  const safeText = text || '';
  const parts = useMemo(() => splitRichMathText(safeText), [safeText]);

  return (
    <span className={`rich-math-text ${className}`}>
      {parts.map((part, index) => {
        if (part.type === 'text') return <Fragment key={`${index}-text`}>{part.value}</Fragment>;
        const rendered = renderMathToHtml(part.value, true);
        return (
          <span
            key={`${index}-math`}
            className={`rich-math-text__formula ${rendered.failed ? 'rich-math-text__formula--failed' : ''}`}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        );
      })}
    </span>
  );
}
