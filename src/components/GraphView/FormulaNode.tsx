import React, { MouseEvent, useCallback, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { FormulaNodeData } from '../../types/graph';
import type { FormulaPrerequisite } from '../../types/formula';
import { chapterColor, chapterRank, rawFormulaNumber } from '../../utils/constants';
import { buildFormulaSymbolPrerequisites } from '../../utils/formulaInfo';
import { isFocusAnnotationLabel, resolveSymbolShortLabel } from '../../utils/symbolAnnotation';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy } from '../../utils/uiCopy';
import { MathFormula, renderMathToHtml, type MathAnnotation } from '../common/MathFormula';
import { RichMathText } from '../common/RichMathText';

function compareSymbolExplanations(a?: FormulaNodeData['symbolExplanations'], b?: FormulaNodeData['symbolExplanations']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      item.symbol === other.symbol &&
      item.type === other.type &&
      item.target_id === other.target_id &&
      item.confidence === other.confidence &&
      item.shortLabel === other.shortLabel &&
      item.llmText === other.llmText &&
      item.llmStatus === other.llmStatus &&
      item.kind === other.kind
    );
  });
}

type SymbolNote = FormulaPrerequisite & {
  shortLabel?: string;
  llmText?: string;
  llmStatus?: 'loading' | 'ready' | 'error';
  kind?: 'symbol' | 'compound' | 'formula';
};

interface ActiveCallout {
  annotation: MathAnnotation;
  anchor: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
  lineStart: { x: number; y: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateCalloutBox(note: string, symbol = '', containerWidth = 320): { width: number; height: number } {
  const length = note.trim().length;
  const maxWidth = clamp(containerWidth - 48, 190, 320);
  const width = clamp(Math.max(Math.round(length * 9 + 112), symbol.length * 8 + 96), 190, maxWidth);
  const height = length > 34 ? 126 : length > 18 ? 106 : 90;
  return { width, height };
}

export const FormulaNode = React.memo(
  ({ id, data, selected }: NodeProps) => {
    const nodeRef = React.useRef<HTMLDivElement | null>(null);
    const nodeData = data as unknown as FormulaNodeData;
    const formula = nodeData.formula;
    const copy = getUiCopy(DEFAULT_LANGUAGE).graph.node;
    const symbolNotes: SymbolNote[] = useMemo(
      () => (nodeData.symbolExplanations?.length ? nodeData.symbolExplanations : buildFormulaSymbolPrerequisites(formula)),
      [formula, nodeData.symbolExplanations],
    );
    const chapter = chapterRank(formula.chapter_id, Number(rawFormulaNumber(formula.id).split('.')[0]));
    const active = nodeData.focused || selected;
    const role = nodeData.role || (nodeData.focused ? 'focus' : 'prerequisite');
    const canAnnotateFormula = nodeData.mode === 'guided' && !nodeData.chapterGraph;
    const [activeCallout, setActiveCallout] = useState<ActiveCallout | null>(null);
    const annotations = useMemo(
      () =>
        canAnnotateFormula
          ? symbolNotes
              .map((prereq) => {
                const symbol = prereq.symbol || prereq.via_symbol || '';
                const note = resolveSymbolShortLabel(prereq, {
                  shortLabel: prereq.shortLabel,
                  llmText: prereq.llmText,
                });
                return {
                  symbol,
                  note,
                  text: prereq.llmText || prereq.meaning || prereq.definition,
                  kind: prereq.kind || 'symbol',
                  status: prereq.llmStatus,
                };
              })
              .filter((item) => item.symbol && isFocusAnnotationLabel(item.note))
          : [],
      [canAnnotateFormula, symbolNotes],
    );

    const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (nodeData.locked) return;
      nodeData.onExpand(id, 'auto');
    };

    const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>, intent: 'prerequisites' | 'successors') => {
      event.stopPropagation();
      if (nodeData.locked) return;
      nodeData.onExpand(id, intent);
    };

    const handleLockedTargetClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!nodeData.lockedTargetFormulaId) return;
      nodeData.onLockedTarget?.(nodeData.lockedTargetFormulaId);
    };

    const handleAnnotationChange = useCallback((annotation: MathAnnotation | null, anchorRect?: DOMRect) => {
      if (!annotation || !anchorRect || !nodeRef.current) {
        setActiveCallout(null);
        return;
      }
      const nodeRect = nodeRef.current.getBoundingClientRect();
      const scale = nodeRect.width / (nodeRef.current.offsetWidth || nodeRect.width || 1);
      const anchor = {
        x: (anchorRect.left + anchorRect.width / 2 - nodeRect.left) / scale,
        y: (anchorRect.top + anchorRect.height / 2 - nodeRect.top) / scale,
      };
      const width = nodeRef.current.offsetWidth;
      const height = nodeRef.current.offsetHeight;
      const { width: boxWidth, height: boxHeight } = estimateCalloutBox(annotation.note, annotation.symbol, width);
      const margin = 18;
      const placeRight = anchor.x < width * 0.55;
      const preferredY = anchor.y + 42;
      const fallbackY = anchor.y - boxHeight - 34;
      const maxY = Math.max(margin, height - boxHeight - margin);
      const boxY = preferredY + boxHeight <= height - margin ? preferredY : clamp(fallbackY, margin, maxY);
      const box = {
        x: placeRight ? clamp(anchor.x + 28, margin, Math.max(margin, width - boxWidth - margin)) : clamp(anchor.x - boxWidth - 28, margin, Math.max(margin, width - boxWidth - margin)),
        y: boxY,
        width: boxWidth,
        height: boxHeight,
      };
      const lineStart = {
        x: placeRight ? box.x : box.x + box.width,
        y: box.y + box.height / 2,
      };

      setActiveCallout({ annotation, anchor, box, lineStart });
    }, []);

    return (
      <div
        ref={nodeRef}
        role="button"
        tabIndex={0}
        aria-disabled={nodeData.locked}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(event) => {
          if (nodeData.locked) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            nodeData.onExpand(id, 'auto');
          }
        }}
        className={`formula-node formula-node--${role} ${annotations.length ? 'formula-node--annotated' : ''} ${activeCallout ? 'formula-node--has-callout' : ''} ${nodeData.chapterGraph ? 'formula-node--chapter-graph' : ''} ${nodeData.focused ? 'formula-node--focused' : ''} ${selected ? 'formula-node--selected' : ''} ${nodeData.locked ? 'formula-node--locked' : ''} ${nodeData.learned ? 'formula-node--learned' : ''}`}
        data-testid="formula-node"
        data-formula-id={id}
        style={{ '--chapter-color': chapterColor(chapter) } as React.CSSProperties}
      >
        <Handle type="target" position={Position.Left} />
        {!nodeData.locked ? (
          <div className="formula-node__actions" aria-label={copy.actions}>
            <button type="button" className="formula-node__side-trigger formula-node__side-trigger--left" onClick={(e) => handleTriggerClick(e, 'prerequisites')} aria-label={copy.prerequisiteTrigger} title={copy.prerequisiteTrigger}>
              <span>{copy.prerequisiteTrigger}</span>
            </button>
            <button type="button" className="formula-node__side-trigger formula-node__side-trigger--right" onClick={(e) => handleTriggerClick(e, 'successors')} aria-label={copy.successorTrigger} title={copy.successorTrigger}>
              <span>{copy.successorTrigger}</span>
            </button>
          </div>
        ) : null}
        <div className="formula-node__chapter-bar" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="formula-node__label truncate">{formula.label}</div>
            <div className="formula-node__chapter-label mt-1">{formatChapterLabel(formula.chapter_id, chapter)}</div>
          </div>
          {nodeData.loading ? (
          <span className="loading-dot mt-0.5 shrink-0" aria-label="正在加载依赖关系" />
          ) : (
            <span
              className={`formula-node__status ${active ? 'formula-node__status--active' : ''}`}
            >
              {nodeData.locked ? copy.locked : (formula.depth ?? 0) <= 0 ? copy.start : copy.layer(formula.depth ?? 0)}
            </span>
          )}
        </div>
        <MathFormula
          latex={formula.latex}
          className="formula-node__math mt-3"
          annotations={annotations}
          onAnnotationChange={canAnnotateFormula ? handleAnnotationChange : undefined}
        />
        {canAnnotateFormula && activeCallout ? (
          <>
            <svg className="formula-node__callout-lines" aria-hidden="true">
              <path
                d={`M ${activeCallout.lineStart.x} ${activeCallout.lineStart.y} L ${activeCallout.anchor.x} ${activeCallout.anchor.y}`}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={activeCallout.anchor.x} cy={activeCallout.anchor.y} r="3.5" />
            </svg>
            <div
              className="formula-node__callout"
              style={{
                left: activeCallout.box.x,
                top: activeCallout.box.y,
                width: activeCallout.box.width,
                minHeight: activeCallout.box.height,
              }}
              aria-live="polite"
            >
              <span
                className="formula-node__callout-symbol"
                dangerouslySetInnerHTML={{ __html: renderMathToHtml(activeCallout.annotation.symbol, true).html }}
              />
              <strong><RichMathText text={activeCallout.annotation.note} /></strong>
              {activeCallout.annotation.text ? <p><RichMathText text={activeCallout.annotation.text} /></p> : null}
              {activeCallout.annotation.status === 'loading' ? <small>{copy.symbolLoading}</small> : null}
              {activeCallout.annotation.status === 'error' ? <small>{copy.symbolFallback}</small> : null}
            </div>
          </>
        ) : null}
        <div className="formula-node__footer mt-3 flex items-center justify-between gap-3 pt-2.5">
          <div className="min-w-0 text-left">
            <div className="formula-node__section line-clamp-2">{formatSectionLabel(formula.section || formula.subsection)}</div>
            {nodeData.locked && nodeData.lockedReason ? (
              <div className="formula-node__locked-reason">
                {nodeData.lockedTargetFormulaId ? (
                  <button type="button" onClick={handleLockedTargetClick} title={nodeData.lockedTargetLabel || nodeData.lockedTargetFormulaId}>
                    {nodeData.lockedReason}
                  </button>
                ) : (
                  nodeData.lockedReason
                )}
              </div>
            ) : null}
          </div>
          <span className="formula-node__dot" />
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  },
  (prev, next) => {
    const prevData = prev.data as unknown as FormulaNodeData;
    const nextData = next.data as unknown as FormulaNodeData;
    return (
      prev.id === next.id &&
      prev.selected === next.selected &&
      prevData.formula.latex === nextData.formula.latex &&
      prevData.focused === nextData.focused &&
      prevData.loading === nextData.loading &&
      prevData.mode === nextData.mode &&
      prevData.locked === nextData.locked &&
      prevData.lockedReason === nextData.lockedReason &&
      prevData.lockedTargetFormulaId === nextData.lockedTargetFormulaId &&
      prevData.lockedTargetLabel === nextData.lockedTargetLabel &&
      prevData.learned === nextData.learned &&
      compareSymbolExplanations(prevData.symbolExplanations, nextData.symbolExplanations)
    );
  },
);
