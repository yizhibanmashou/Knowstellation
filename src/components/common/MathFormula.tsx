import { useEffect, useMemo, useRef } from 'react';
import { annotateRenderedMath } from './mathAnnotations';
import { renderMathToHtml } from './mathFormulaRenderer';

export { renderMathToHtml };

export interface MathAnnotation {
  symbol: string;
  note: string;
  text?: string;
  kind?: 'symbol' | 'compound' | 'formula';
  target?: string;
  status?: 'loading' | 'ready' | 'error';
}

interface MathFormulaProps {
  latex?: string;
  className?: string;
  inline?: boolean;
  annotations?: MathAnnotation[];
  onAnnotationChange?: (annotation: MathAnnotation | null, anchorRect?: DOMRect) => void;
}

export function MathFormula({ latex = '', className = '', inline = false, annotations = [], onAnnotationChange }: MathFormulaProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rendered = useMemo(() => renderMathToHtml(latex, inline), [inline, latex]);
  const annotationKey = useMemo(
    () => annotations.map((item) => `${item.kind || 'symbol'}:${item.symbol}:${item.target || ''}:${item.note}:${item.text || ''}:${item.status || ''}`).join('|'),
    [annotations],
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    annotateRenderedMath(root, annotations);
  }, [annotationKey, annotations, rendered.html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !annotations.length || !onAnnotationChange) return;

    const readAnnotation = (target: Element | null, point?: { x: number; y: number }) => {
      const stack = point ? document.elementsFromPoint(point.x, point.y) : [];
      const nearbySymbol = point
        ? Array.from(root.querySelectorAll<HTMLElement>('.math-symbol-hotspot[data-kind="symbol"]'))
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return (
                point.x >= rect.left - 3 &&
                point.x <= rect.right + 3 &&
                point.y >= rect.top - 3 &&
                point.y <= rect.bottom + 3
              );
            })
            .sort((a, b) => {
              const rectA = a.getBoundingClientRect();
              const rectB = b.getBoundingClientRect();
              return rectA.width * rectA.height - rectB.width * rectB.height;
            })[0] || null
        : null;
      const fractionLine = stack.find((element) => element.classList.contains('frac-line'));
      const lineFraction = fractionLine?.closest<HTMLElement>('.mfrac.math-symbol-hotspot') || null;
      const hotspots = Array.from(new Set(
        stack
          .flatMap((element) => [
            element.classList.contains('math-symbol-hotspot') ? element as HTMLElement : null,
            element.closest<HTMLElement>('.math-symbol-hotspot'),
          ])
          .filter((element): element is HTMLElement => Boolean(element)),
      ));
      const source = !stack.length && target instanceof Element ? target.closest<HTMLElement>('.math-symbol-hotspot') : null;
      const symbolHotspots = hotspots
        .filter((element) => element.dataset.kind === 'symbol')
        .sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) - (b.getBoundingClientRect().width * b.getBoundingClientRect().height));
      const fractionPart = hotspots.find((element) => element.dataset.compoundShape?.startsWith('fraction-')) || null;
      const hotspot = nearbySymbol
        && !fractionPart
        ? nearbySymbol
        : fractionPart
        || symbolHotspots[0]
        || lineFraction
        || hotspots.find((element) => element.dataset.kind === 'compound')
        || source;
      if (!hotspot) return null;
      const symbol = hotspot.dataset.symbol || '';
      const note = hotspot.dataset.note || '';
      const text = hotspot.dataset.text || '';
      const kind = hotspot.dataset.kind as MathAnnotation['kind'] | undefined;
      const status = hotspot.dataset.status as MathAnnotation['status'] | undefined;
      return symbol && note ? { annotation: { symbol, note, text, kind, status }, anchorRect: hotspot.getBoundingClientRect() } : null;
    };

    const handleMove = (event: globalThis.MouseEvent | globalThis.PointerEvent) => {
      const active = readAnnotation(event.target instanceof Element ? event.target : null, {
        x: event.clientX,
        y: event.clientY,
      });
      onAnnotationChange(active?.annotation ?? null, active?.anchorRect);
    };
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const active = readAnnotation(event.target instanceof Element ? event.target : null, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!active) return;
      event.stopPropagation();
      onAnnotationChange(active.annotation, active.anchorRect);
    };
    const handleFocus = (event: FocusEvent) => {
      const active = readAnnotation(event.target instanceof Element ? event.target : null);
      onAnnotationChange(active?.annotation ?? null, active?.anchorRect);
    };
    const handleLeave = () => {
      onAnnotationChange(null);
    };

    root.addEventListener('pointermove', handleMove, true);
    root.addEventListener('pointerdown', handlePointerDown, true);
    root.addEventListener('mousemove', handleMove, true);
    root.addEventListener('focusin', handleFocus, true);
    root.addEventListener('mouseleave', handleLeave);
    return () => {
      root.removeEventListener('pointermove', handleMove, true);
      root.removeEventListener('pointerdown', handlePointerDown, true);
      root.removeEventListener('mousemove', handleMove, true);
      root.removeEventListener('focusin', handleFocus, true);
      root.removeEventListener('mouseleave', handleLeave);
    };
  }, [annotationKey, annotations.length, onAnnotationChange]);

  return (
    <div
      ref={rootRef}
      className={`katex-container math-formula ${inline ? 'math-formula--inline' : 'math-formula--display'} ${
        rendered.failed ? 'math-formula--failed' : ''
      } ${annotations.length ? 'math-formula--annotated' : ''} ${className}`}
      data-display-mode={rendered.displayMode}
    >
      <div className="math-formula__viewport">
        <div ref={contentRef} className="math-formula__content" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
    </div>
  );
}
