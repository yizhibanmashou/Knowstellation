import React, { MouseEvent, useCallback, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { FormulaNodeData } from '../../shared/types/graph';
import type { FormulaPrerequisite } from '../../shared/types/formula';
import { chapterColor, chapterRank, rawFormulaNumber } from '../../shared/utils/constants';
import { buildFormulaSymbolPrerequisites } from './formulaInfo';
import { selectKeyConcepts } from './keyConceptAnnotations';
import { isFocusAnnotationLabel, resolveSymbolMeaning, resolveSymbolShortLabel } from '../../shared/utils/symbolAnnotation';
import { DEFAULT_LANGUAGE, formatChapterLabel, formatSectionLabel, getUiCopy } from '../../shared/utils/uiCopy';
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
    const active = nodeData.focused || selected;
    const role = nodeData.role || (nodeData.focused ? 'focus' : 'prerequisite');
    const canAnnotateFormula = nodeData.mode === 'guided' && !nodeData.chapterGraph;
    const [activeCallout, setActiveCallout] = useState<ActiveCallout | null>(null);
    const [activeKeySymbol, setActiveKeySymbol] = useState<string | null>(null);
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
    const keyConcepts = useMemo(
      () => selectKeyConcepts(annotations),
      [annotations],
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
        {canAnnotateFormula && keyConcepts.length ? (
          <div className="formula-node__key-symbols" aria-label="重点符号">
            {keyConcepts.map((item) => {
              const detailText = item.text?.trim() || '';
              const showDetail = detailText.replace(/\s+/g, ' ') !== item.note.replace(/\s+/g, ' ');
              const key = `${item.kind || 'symbol'}:${item.symbol}:${item.note}`;
              return (
                <span
                  className={`formula-node__key-symbol nodrag nopan ${activeKeySymbol === key ? 'formula-node__key-symbol--active' : ''}`}
                  key={key}
                  role="note"
                  tabIndex={0}
                  aria-label={`${item.symbol}: ${item.note}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveKeySymbol(key);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onFocus={() => setActiveKeySymbol(key)}
                  onBlur={() => setActiveKeySymbol((current) => (current === key ? null : current))}
                  onMouseEnter={() => setActiveKeySymbol(key)}
                  onMouseLeave={(event) => {
                    if (document.activeElement === event.currentTarget) return;
                    setActiveKeySymbol((current) => (current === key ? null : current));
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      setActiveKeySymbol(null);
                      event.currentTarget.blur();
                    }
                  }}
                >
                  <span
                    className="formula-node__key-symbol-math"
                    dangerouslySetInnerHTML={{ __html: renderMathToHtml(item.symbol, true).html }}
                  />
                  <span className="formula-node__key-symbol-badge">重点</span>
                  <span className="formula-node__key-symbol-popover" role="tooltip">
                    <strong><RichMathText text={item.note} /></strong>
                    {showDetail ? <small><RichMathText text={detailText} /></small> : null}
                  </span>
                </span>
              );
            })}
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
