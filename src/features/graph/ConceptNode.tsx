import React from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { ArrowRight, ChevronDown, ChevronUp, FunctionSquare } from 'lucide-react';
import type { ConceptNodeData } from '../../shared/types/graph';
import { DEFAULT_LANGUAGE, formatConceptTitle } from '../../shared/utils/uiCopy';
import { RichMathText } from '../../shared/components/RichMathText';
import { MathFormula } from '../../shared/components/MathFormula';

function conceptSymbol(view: ConceptNodeData['view'], reference?: ConceptNodeData['reference']) {
  return (roleSymbol(reference?.symbol) || roleSymbol(reference?.via_symbol) || roleSymbol(view.defined_symbol)).trim();
}

function roleSymbol(value?: string) {
  return String(value || '').trim();
}

export const ConceptNode = React.memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as ConceptNodeData;
  const view = nodeData.view;
  const reference = nodeData.reference;
  const role = nodeData.role;
  const rawTitle = role === 'focus' ? view.name : reference?.name || view.name;
  const title = formatConceptTitle(rawTitle, '', DEFAULT_LANGUAGE);
  const clickable = (role === 'prerequisite' || role === 'successor') && nodeData.clickable && Boolean(reference?.concept_id);
  const canExpandPrerequisites = role === 'prerequisite' && Boolean(nodeData.canExpandPrerequisites && reference);
  const focusDefinition = view.definition_zh?.trim() || view.definition || '这个概念是当前图谱的阅读中心。';
  const referenceDefinition = reference?.definition_zh?.trim() || reference?.definition?.trim();
  const compactDefinition = referenceDefinition
    || (role === 'successor'
      ? '它沿着当前概念继续展开，是后续学习路径中的相关概念。'
      : '它提供当前概念需要先掌握的定义或条件。');
  const symbol = conceptSymbol(view, reference);

  const openConcept = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    if (!clickable || !reference?.concept_id) return;
    nodeData.onOpenConcept(reference.view_id || reference.concept_id);
  };

  const togglePrerequisites = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!reference) return;
    nodeData.onExpandPrerequisites?.(reference);
  };

  const revealPrerequisites = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    nodeData.onRevealGroup?.('prerequisites');
  };

  const toggleEvidence = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    nodeData.onToggleEvidence?.();
  };

  const openFormula = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!view.defined_by_formula_id) return;
    nodeData.onOpenFormula(view.defined_by_formula_id);
  };

  const prerequisiteCount = nodeData.conceptCounts?.prerequisites || 0;
  const prerequisitesRevealed = Boolean(nodeData.revealedGroups?.prerequisites);
  const evidenceOpen = Boolean(nodeData.evidenceOpen);
  const hasFormulaEvidence = role === 'focus' && Boolean(view.supporting_formula_latex);

  return (
    <div
      className={[
        'concept-node',
        `concept-node--${role}`,
        nodeData.depth ? `concept-node--depth-${nodeData.depth}` : '',
        clickable ? 'concept-node--clickable' : '',
        nodeData.active ? 'concept-node--active' : '',
        nodeData.prerequisitesExpanded ? 'concept-node--expanded' : '',
      ].filter(Boolean).join(' ')}
      data-testid="concept-node"
      data-concept-role={role}
      data-concept-id={role === 'focus' ? view.concept_id : reference?.concept_id}
    >
      <Handle type="target" position={Position.Left} />
      <div className="concept-node__header">
        <h3><RichMathText text={title} /></h3>
        {symbol ? (
          <span className="concept-node__symbol" aria-label="概念符号">
            <MathFormula latex={symbol} inline />
          </span>
        ) : null}
      </div>
      {role === 'focus' ? (
        <p className="concept-node__definition">
          <RichMathText text={focusDefinition} />
        </p>
      ) : (
        <p className="concept-node__definition concept-node__definition--compact">
          <RichMathText text={compactDefinition} />
        </p>
      )}
      {clickable || canExpandPrerequisites ? (
        <div className="concept-node__actions">
          {canExpandPrerequisites ? (
            <button
              type="button"
              className={nodeData.prerequisitesExpanded ? 'concept-node__expand-button concept-node__expand-button--active nodrag nopan' : 'concept-node__expand-button nodrag nopan'}
              onClick={togglePrerequisites}
              aria-label={`${nodeData.prerequisitesExpanded ? '收起' : '展开'} ${title} 的前置概念`}
            >
              <span>{nodeData.prerequisitesExpanded ? '收起' : '展开'}</span>
              {nodeData.prerequisitesExpanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            </button>
          ) : null}
          {clickable ? (
            <button
              type="button"
              className="concept-node__open-button nodrag nopan"
              onClick={openConcept}
              aria-label={`进入概念 ${title}`}
            >
              <span>进入</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {role === 'focus' ? (
        <div className="concept-node__focus-actions" aria-label="概念节点操作">
          <button
            type="button"
            disabled={!hasFormulaEvidence}
            className={evidenceOpen ? 'concept-node__focus-action concept-node__focus-action--active nodrag nopan' : 'concept-node__focus-action nodrag nopan'}
            onClick={toggleEvidence}
            aria-expanded={evidenceOpen}
          >
            <FunctionSquare size={13} aria-hidden="true" />
            <span>公式证据</span>
          </button>
          <button
            type="button"
            disabled={!prerequisiteCount}
            className={prerequisitesRevealed ? 'concept-node__focus-action concept-node__focus-action--active nodrag nopan' : 'concept-node__focus-action nodrag nopan'}
            onClick={revealPrerequisites}
          >
            <ChevronDown size={13} aria-hidden="true" />
            <span>{prerequisitesRevealed ? '收起前置' : prerequisiteCount ? '前置概念' : '无前置'}</span>
            <strong>{prerequisiteCount}</strong>
          </button>
        </div>
      ) : null}
      {hasFormulaEvidence ? (
        <div className={evidenceOpen ? 'concept-node__formula concept-node__formula--open' : 'concept-node__formula'} aria-hidden={!evidenceOpen}>
          <div className="concept-node__formula-head">
            <span>公式证据</span>
            <button type="button" className="nodrag nopan" onClick={openFormula}>查看公式</button>
          </div>
          <MathFormula latex={view.supporting_formula_latex} />
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
