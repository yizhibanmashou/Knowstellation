import React, { MouseEvent, useCallback, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { FormulaNodeData } from '../../shared/types/graph';
import type { FormulaPrerequisite } from '../../shared/types/formula';
import { chapterColor, chapterRank, rawFormulaNumber } from '../../shared/utils/constants';
import { buildFormulaSymbolPrerequisites } from './formulaInfo';
import { isFocusAnnotationLabel, resolveSymbolMeaning, resolveSymbolShortLabel } from '../../shared/utils/symbolAnnotation';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { MathFormula, renderMathToHtml, type MathAnnotation } from '../../shared/components/MathFormula';
import { RichMathText } from '../../shared/components/RichMathText';

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
      item.kind === other.kind &&
      item.target === other.target &&
      item.meaning === other.meaning &&
      item.definition === other.definition
    );
  });
}

type SymbolNote = FormulaPrerequisite & {
  shortLabel?: string;
  llmText?: string;
  llmStatus?: 'loading' | 'ready' | 'error';
  kind?: 'symbol' | 'compound' | 'formula';
};

function normalizeAnnotationKey(value = ''): string {
  return value
    .replace(/\s+/g, '')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function symbolNoteKey(note: SymbolNote): string {
  const symbol = note.target || note.symbol || note.via_symbol || note.meaning || '';
  return `${note.kind || 'symbol'}:${normalizeAnnotationKey(symbol)}`;
}

function mergeSymbolNotes(formula: FormulaNodeData['formula'], provided: SymbolNote[] = []): SymbolNote[] {
  const merged: SymbolNote[] = [];
  const seen = new Set<string>();
  const add = (note: SymbolNote) => {
    const key = symbolNoteKey(note);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(note);
  };

  provided.forEach(add);
  buildFormulaSymbolPrerequisites(formula).forEach((note) => add({ ...note, kind: 'symbol' }));
  return merged;
}

interface ActiveCallout {
  annotation: MathAnnotation;
  anchor: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
  lineStart: { x: number; y: number };
}

interface LocalRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
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

function rectToLocal(rect: DOMRect, origin: DOMRect, scale: number): LocalRect {
  const left = (rect.left - origin.left) / scale;
  const top = (rect.top - origin.top) / scale;
  const width = rect.width / scale;
  const height = rect.height / scale;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

function expandRect(rect: LocalRect, amount: number): LocalRect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function rectFromBox(box: ActiveCallout['box']): LocalRect {
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    width: box.width,
    height: box.height,
  };
}

function rectsOverlap(a: LocalRect, b: LocalRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function viewportBoundsForNode(nodeRect: DOMRect, scale: number): LocalRect {
  const margin = 14;
  const left = (margin - nodeRect.left) / scale;
  const top = (margin - nodeRect.top) / scale;
  const right = (window.innerWidth - margin - nodeRect.left) / scale;
  const bottom = (window.innerHeight - margin - nodeRect.top) / scale;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function clampWithin(value: number, min: number, max: number): number {
  if (max < min) return min;
  return clamp(value, min, max);
}

function viewportOverflowScore(box: ActiveCallout['box'], bounds: LocalRect): number {
  const rect = rectFromBox(box);
  return Math.max(0, bounds.left - rect.left)
    + Math.max(0, rect.right - bounds.right)
    + Math.max(0, bounds.top - rect.top)
    + Math.max(0, rect.bottom - bounds.bottom);
}

function lineStartForBox(box: ActiveCallout['box'], anchor: ActiveCallout['anchor']): ActiveCallout['lineStart'] {
  const rect = rectFromBox(box);
  return {
    x: clampWithin(anchor.x, rect.left, rect.right),
    y: clampWithin(anchor.y, rect.top, rect.bottom),
  };
}

function placeCalloutAwayFromFormula(input: {
  anchor: ActiveCallout['anchor'];
  formulaRect: LocalRect;
  nodeRect: DOMRect;
  scale: number;
  width: number;
  height: number;
}): ActiveCallout['box'] {
  const { anchor, nodeRect, scale, width, height } = input;
  const avoid = expandRect(input.formulaRect, 18);
  const viewport = viewportBoundsForNode(nodeRect, scale);
  const gap = 18;
  const sideGap = 24;
  const centeredX = anchor.x - width / 2;
  const centeredY = anchor.y - height / 2;
  const xMin = viewport.left;
  const xMax = viewport.right - width;
  const yMin = viewport.top;
  const yMax = viewport.bottom - height;
  const candidates: ActiveCallout['box'][] = [
    {
      x: clampWithin(centeredX, xMin, xMax),
      y: avoid.top - height - gap,
      width,
      height,
    },
    {
      x: clampWithin(centeredX, xMin, xMax),
      y: avoid.bottom + gap,
      width,
      height,
    },
    {
      x: avoid.right + sideGap,
      y: clampWithin(centeredY, yMin, yMax),
      width,
      height,
    },
    {
      x: avoid.left - width - sideGap,
      y: clampWithin(centeredY, yMin, yMax),
      width,
      height,
    },
  ];

  return candidates
    .filter((candidate) => !rectsOverlap(rectFromBox(candidate), avoid))
    .sort((a, b) => viewportOverflowScore(a, viewport) - viewportOverflowScore(b, viewport))[0]
    || candidates.sort((a, b) => viewportOverflowScore(a, viewport) - viewportOverflowScore(b, viewport))[0];
}

function normalizeDisplayText(value = ''): string {
  return value
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMathEcho(text = '', symbol = ''): string {
  let next = normalizeDisplayText(text);
  if (!next || !symbol) return next;

  for (const variant of symbolTextVariants(symbol)) {
    if (!variant) continue;
    const escaped = regexEscape(variant);
    next = next
      .replace(new RegExp(`^${escaped}\\s+${escaped}\\b`, 'iu'), variant)
      .replace(new RegExp(`^${escaped}(?:\\s+|[，,：:：;；]+)`, 'iu'), '')
      .trim();
  }
  return next;
}

function symbolTextVariants(symbol = ''): string[] {
  const compact = normalizeDisplayText(symbol);
  const plain = compact
    .replace(/\\/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '');
  const underscored = plain
    .replace(/_([^_^]+)/g, '_$1')
    .replace(/\^([^_^]+)/g, '^$1');
  const readable = plain
    .replace(/([A-Za-zΑ-Ωα-ω])_\{?([^{}]+)\}?/gu, '$1 $2')
    .replace(/([A-Za-zΑ-Ωα-ω])\^\{?([^{}]+)\}?/gu, '$1 $2');
  const compactReadable = readable.replace(/\s+/g, '');
  return [...new Set([compact, plain, underscored, readable, compactReadable].filter(Boolean))]
    .sort((a, b) => b.length - a.length);
}

function heuristicSymbolLabel(symbol = ''): string {
  const compact = symbol.replace(/\s+/g, '');
  if (/^\\Delta\s*p$|^\\Deltap$/.test(compact)) return '频率变化量';
  if (/^\\Delta/.test(compact)) return '变化量';
  if (/\\sigma/.test(compact) && /\^\{?2\}?/.test(compact)) {
    if (/\\widehat\{?p/.test(compact)) return '频率估计方差';
    if (/\\widehat\{?\\delta/.test(compact)) return '频率变化方差';
    if (/_[{]?B[}]?/i.test(compact)) return '群体间方差项';
    if (/_[{]?a[}]?/i.test(compact)) return '加性方差项';
    return '方差项';
  }
  if (/^[A-Za-z]_\{?[0-9A-Za-z]+\}?\^\{\([^)]+\)\}$/.test(compact)) return '索引效应项';
  if (/^\\(?:overline|bar)\{\\delta\}/.test(compact)) return '平均变化量';
  if (/^\\delta/.test(compact)) return '变化量';
  if (/^\\mu(?:_|$|\^)/.test(compact)) return '均值参数';
  if (/^\\alpha/.test(compact)) return '平均效应';
  if (/^\\beta/.test(compact)) return '回归系数';
  if (/^b(?:_|$)/.test(compact)) return '效应系数';
  if (compact === 'c') return '二次项系数';
  if (/^e(?:_|$)/.test(compact)) return '残差项';
  if (/^x(?:_|$)/.test(compact)) return '预测变量';
  if (compact === 'a') return '加性项';
  if (compact === 'd') return '变化量';
  if (compact === 'g') return '遗传值';
  if (compact === 'k') return '项数';
  if (compact === 's') return '选择系数';
  if (compact === 'w') return '相对适合度';
  if (compact === 'W') return '适合度';
  if (compact === 'B') return '尺度参数';
  if (compact === 'n') return '数量参数';
  return '';
}

function cleanCalloutNote(symbol: string, note = ''): string {
  let next = normalizeDisplayText(note);
  for (const variant of symbolTextVariants(symbol)) {
    const escaped = regexEscape(variant);
    next = next.replace(new RegExp(`^${escaped}\\s*(?:表示|是)\\s*`, 'i'), '').trim();
  }

  if (
    !next
    || /^[A-Za-z0-9_\\^{}()[\].,\-\s]+$/.test(next)
    || /\.\.\./.test(next)
    || /^if\s/i.test(next)
  ) {
    return heuristicSymbolLabel(symbol) || next;
  }
  return next;
}

function stripRepeatedLead(text = '', lead = ''): string {
  let next = normalizeDisplayText(text);
  const normalizedLead = normalizeDisplayText(lead);
  if (!next || !normalizedLead) return next;

  const escapedLead = regexEscape(normalizedLead);
  const leadPattern = new RegExp(`^${escapedLead}(?:[，,：:；;\\s]+|$)`, 'iu');
  for (let index = 0; index < 3; index += 1) {
    const stripped = next.replace(leadPattern, '').trim();
    if (stripped === next) break;
    next = stripped;
  }
  return next === normalizedLead ? '' : next;
}

function stripSymbolLead(text: string, note: string, symbol = ''): string {
  let next = normalizeDisplayText(text);
  const variants = symbolTextVariants(symbol);
  const notes = [note, ...variants.map((variant) => `${variant} 表示 ${note}`)].filter(Boolean);

  for (const variant of variants) {
    const escapedSymbol = regexEscape(variant);
    const escapedNote = regexEscape(note);
    next = next
      .replace(new RegExp(`^${escapedSymbol}\\s*(?:表示|是)\\s*${escapedNote}(?:[，,：:；;\\s]+|$)`, 'iu'), '')
      .trim();
  }

  if (note) {
    const escapedNote = regexEscape(note);
    next = next
      .replace(new RegExp(`^(?:表示|是)\\s*${escapedNote}`, 'iu'), '')
      .trim();
  }

  for (const lead of notes) {
    next = stripRepeatedLead(next, lead);
  }
  return next;
}

function isGenericCalloutTail(text: string): boolean {
  return /^(?:先用这个短标签定位它在本式中的角色|先结合附近文字读它的定义|可以先按这段话定位它的含义|是这个公式直接使用的符号)[。；;.,，\s]*$/u.test(text);
}

function cleanCalloutText(note: string, text = '', symbol = ''): string {
  const withoutSymbolEcho = stripMathEcho(text, symbol);
  const cleaned = stripSymbolLead(withoutSymbolEcho, note, symbol)
    .replace(/^.*?是这个公式直接使用的符号。先结合附近文字读它的定义：/u, '')
    .replace(/^.*?出现在当前公式附近的教材语境中，可以先按这段话定位它的含义：/u, '')
    .replace(/^.*?；先用这个短标签定位它在本式中的角色。?$/u, '')
    .replace(/^[，,：:；;\s]+/u, '')
    .trim();
  const latinLetters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const cjkLetters = (cleaned.match(/[\u4e00-\u9fff]/g) || []).length;
  if (latinLetters > cjkLetters * 2 && cleaned.length > 56) return '';
  if (isGenericCalloutTail(cleaned)) return '';
  if (!cleaned || normalizeDisplayText(cleaned) === normalizeDisplayText(note)) return '';
  return cleaned;
}

export const FormulaNode = React.memo(
  ({ id, data, selected }: NodeProps) => {
    const nodeRef = React.useRef<HTMLDivElement | null>(null);
    const nodeData = data as unknown as FormulaNodeData;
    const formula = nodeData.formula;
    const copy = getUiCopy(DEFAULT_LANGUAGE).graph.node;
    const symbolNotes: SymbolNote[] = useMemo(
      () => mergeSymbolNotes(formula, nodeData.symbolExplanations),
      [formula, nodeData.symbolExplanations],
    );
    const chapter = chapterRank(formula.chapter_id, Number(rawFormulaNumber(formula.id).split('.')[0]));
    const role = nodeData.role || (nodeData.focused ? 'focus' : 'prerequisite');
    const canAnnotateFormula = nodeData.mode === 'formula' && !nodeData.chapterGraph;
    const [activeCallout, setActiveCallout] = useState<ActiveCallout | null>(null);
    const [formulaContentWidth, setFormulaContentWidth] = useState<number | null>(null);
    const annotations = useMemo(
      () =>
        canAnnotateFormula
          ? symbolNotes
              .map((prereq) => {
                const symbol = prereq.symbol || prereq.via_symbol || prereq.target || '';
                const rawNote = prereq.kind === 'formula'
                  ? '整式结构导读'
                  : resolveSymbolShortLabel(prereq, {
                      shortLabel: prereq.shortLabel,
                      llmText: prereq.llmText,
                    });
                const note = cleanCalloutNote(symbol, rawNote);
                const text = resolveSymbolMeaning(prereq, {
                  llmText: prereq.llmText,
                });
                return {
                  symbol,
                  note,
                  text: cleanCalloutText(note, text, symbol),
                  kind: prereq.kind || 'symbol',
                  target: prereq.target,
                  status: prereq.llmStatus,
                };
              })
              .filter((item) => item.symbol && isFocusAnnotationLabel(item.note))
          : [],
      [canAnnotateFormula, symbolNotes],
    );
    React.useLayoutEffect(() => {
      if (nodeData.chapterGraph) return undefined;
      const root = nodeRef.current;
      const content = root?.querySelector<HTMLElement>('.formula-node__math .math-formula__content');
      if (!root || !content) return undefined;

      let frame = 0;
      const measure = () => {
        const renderedFormula = content.querySelector<HTMLElement>('.katex');
        const nextWidth = Math.ceil(
          renderedFormula?.scrollWidth
            || renderedFormula?.getBoundingClientRect().width
            || content.scrollWidth
            || content.getBoundingClientRect().width,
        );
        setFormulaContentWidth((current) => {
          if (current !== null && Math.abs(current - nextWidth) <= 1) return current;
          return nextWidth;
        });
      };

      measure();
      if (typeof ResizeObserver === 'undefined') return undefined;

      const observer = new ResizeObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(measure);
      });
      observer.observe(content);
      const renderedFormula = content.querySelector<HTMLElement>('.katex');
      if (renderedFormula) observer.observe(renderedFormula);
      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }, [annotations.length, formula.latex, nodeData.chapterGraph]);

    const measuredWidth = formulaContentWidth
      ? clamp(formulaContentWidth + (nodeData.focused ? 72 : 64), nodeData.focused ? 360 : 292, nodeData.focused ? 560 : 492)
      : undefined;
    const nodeStyle = {
      '--chapter-color': chapterColor(chapter),
      ...(measuredWidth ? { '--formula-node-width': `${measuredWidth}px` } : {}),
    } as React.CSSProperties;
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

    const relationInfoReady = typeof nodeData.hasGraphPrerequisites === 'boolean' && typeof nodeData.hasGraphSuccessors === 'boolean';
    const prerequisiteDisabled = relationInfoReady && !nodeData.hasGraphPrerequisites;
    const successorDisabled = relationInfoReady && !nodeData.hasGraphSuccessors;
    const prerequisiteLabel = prerequisiteDisabled ? '暂无前置公式' : copy.prerequisiteTrigger;
    const successorLabel = successorDisabled ? '暂无后续公式' : copy.successorTrigger;

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
      const { width: boxWidth, height: boxHeight } = estimateCalloutBox(annotation.note, annotation.symbol, width);
      const renderedFormula = nodeRef.current.querySelector<HTMLElement>('.formula-node__math .katex');
      const formulaRect = rectToLocal(renderedFormula?.getBoundingClientRect() || anchorRect, nodeRect, scale);
      const box = placeCalloutAwayFromFormula({
        anchor,
        formulaRect,
        nodeRect,
        scale,
        width: boxWidth,
        height: boxHeight,
      });
      const lineStart = lineStartForBox(box, anchor);

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
        style={nodeStyle}
      >
        <Handle type="target" position={Position.Left} />
        <div className="formula-node__header">
          <h3 className="formula-node__label">{formula.label}</h3>
          {nodeData.loading ? (
            <span className="loading-dot mt-0.5 shrink-0" aria-label="正在加载依赖关系" />
          ) : null}
        </div>
        <MathFormula
          latex={formula.latex}
          className="formula-node__math mt-3"
          annotations={annotations}
          onAnnotationChange={canAnnotateFormula ? handleAnnotationChange : undefined}
        />
        {!nodeData.locked ? (
          <div className="formula-node__actions" aria-label={copy.actions}>
            <button type="button" className="formula-node__side-trigger formula-node__side-trigger--left nodrag nopan" onClick={(e) => handleTriggerClick(e, 'prerequisites')} aria-label={prerequisiteLabel} title={prerequisiteLabel} disabled={prerequisiteDisabled}>
              <span>{copy.prerequisiteTrigger}</span>
            </button>
            <button type="button" className="formula-node__side-trigger formula-node__side-trigger--right nodrag nopan" onClick={(e) => handleTriggerClick(e, 'successors')} aria-label={successorLabel} title={successorLabel} disabled={successorDisabled}>
              <span>{copy.successorTrigger}</span>
            </button>
          </div>
        ) : null}
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
        {nodeData.locked && nodeData.lockedReason ? (
          <div className="formula-node__footer">
            <div className="formula-node__locked-reason">
              {nodeData.lockedTargetFormulaId ? (
                <button type="button" onClick={handleLockedTargetClick} title={nodeData.lockedTargetLabel || nodeData.lockedTargetFormulaId}>
                  {nodeData.lockedReason}
                </button>
              ) : (
                nodeData.lockedReason
              )}
            </div>
          </div>
        ) : null}
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
      prevData.hasGraphPrerequisites === nextData.hasGraphPrerequisites &&
      prevData.hasGraphSuccessors === nextData.hasGraphSuccessors &&
      prevData.studyNextFormulaId === nextData.studyNextFormulaId &&
      prevData.studyNextFormulaLabel === nextData.studyNextFormulaLabel &&
      prevData.studyNextFormulaLocked === nextData.studyNextFormulaLocked &&
      compareSymbolExplanations(prevData.symbolExplanations, nextData.symbolExplanations)
    );
  },
);
