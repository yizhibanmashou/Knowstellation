import React from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { ConceptNodeData, ConceptRevealGroup } from '../../types/graph';
import { formatSectionLabel } from '../../utils/uiCopy';
import { MathFormula } from '../common/MathFormula';
import { RichMathText } from '../common/RichMathText';

function confidenceLabel(value: number): string {
  if (!Number.isFinite(value)) return '待审阅';
  return `${Math.round(value * 100)}%`;
}

export const ConceptNode = React.memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as ConceptNodeData;
  const [evidenceOpen, setEvidenceOpen] = React.useState(false);
  const view = nodeData.view;
  const reference = nodeData.reference;
  const role = nodeData.role;
  const title = role === 'focus' ? view.name : reference?.name || view.name;
  const symbol = role === 'focus' ? view.defined_symbol : reference?.symbol || reference?.via_symbol || '';
  const formulaLabel = role === 'focus' ? view.supporting_formula_label : reference?.formula_label || view.supporting_formula_label;
  const formulaId = role === 'focus' ? view.defined_by_formula_id : reference?.defined_by_formula_id || reference?.from_formula_id || '';
  const confidence = role === 'focus' ? view.confidence : reference?.confidence ?? view.confidence;
  const flags = role === 'focus' ? view.review_flags : reference?.review_flags || [];
  const clickable = role === 'prerequisite' && nodeData.clickable && Boolean(reference?.concept_id);
  const focusDefinition = view.definition_zh?.trim() || view.definition;
  const referenceDefinition = reference?.definition_zh?.trim() || reference?.definition?.trim();
  const teachingMove = role === 'focus'
    ? view.teaching_move_zh || view.teaching_move
    : reference?.teaching_move_zh || reference?.teaching_move;
  const sourceSentence = role === 'focus' ? view.source_sentence : reference?.source_sentence;
  const compactDefinition = role === 'prerequisite'
    ? `由 ${formulaLabel} 定义，并通过公式依赖支撑当前概念。`
    : referenceDefinition || `在 ${formulaLabel} 中首次作为背景概念出现，用来帮助理解当前公式。`;

  const openConcept = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    if (!clickable || !reference?.concept_id) return;
    nodeData.onOpenConcept(reference.concept_id);
  };

  const openFormula = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!formulaId) return;
    nodeData.onOpenFormula(formulaId);
  };

  const revealGroup = (event: React.MouseEvent<HTMLButtonElement>, group: ConceptRevealGroup) => {
    event.stopPropagation();
    nodeData.onRevealGroup?.(group);
  };

  const toggleEvidence = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setEvidenceOpen((current) => !current);
  };

  const prerequisiteCount = nodeData.conceptCounts?.prerequisites || 0;
  const introducedCount = nodeData.conceptCounts?.introduced || 0;
  const prerequisitesRevealed = Boolean(nodeData.revealedGroups?.prerequisites);
  const introducedRevealed = Boolean(nodeData.revealedGroups?.introduced);
  const revealedCount = Number(prerequisitesRevealed) + Number(introducedRevealed);

  return (
    <div
      className={[
        'concept-node',
        `concept-node--${role}`,
        clickable ? 'concept-node--clickable' : '',
        nodeData.active ? 'concept-node--active' : '',
      ].filter(Boolean).join(' ')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `打开前置概念 ${title}` : undefined}
      data-testid="concept-node"
      data-concept-role={role}
      data-concept-id={role === 'focus' ? view.concept_id : reference?.concept_id}
      onClick={clickable ? openConcept : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              openConcept(event);
            }
          : undefined
      }
    >
      <Handle type="target" position={Position.Left} />
      <div className="concept-node__header">
        <span className="concept-node__role">
          {role === 'focus' ? '当前概念' : role === 'prerequisite' ? '前置概念' : '首次引入'}
        </span>
        <span className="concept-node__confidence">{confidenceLabel(confidence)}</span>
      </div>
      <h3><RichMathText text={title} /></h3>
      {symbol ? (
        <div className="concept-node__symbol" aria-label="概念符号">
          <MathFormula latex={symbol} inline />
        </div>
      ) : null}
      {role === 'focus' ? (
        <p className="concept-node__definition">
          <RichMathText text={focusDefinition} />
        </p>
      ) : (
        <p className="concept-node__definition concept-node__definition--compact">
          <RichMathText text={compactDefinition} />
        </p>
      )}
      <div className="concept-node__meta">
        <span>{formulaLabel}</span>
        {role === 'focus' && view.formula_section ? <span>{formatSectionLabel(view.formula_section)}</span> : null}
      </div>
      {teachingMove ? (
        <div className="concept-node__teaching">
          <span>教材引入</span>
          <strong>{teachingMove}</strong>
        </div>
      ) : null}
      {role === 'focus' ? (
        <>
          <div className="concept-node__learning-path" aria-label="概念展开层级">
            <span className="concept-node__path-step concept-node__path-step--active">核心定义</span>
            <span className={prerequisitesRevealed ? 'concept-node__path-step concept-node__path-step--active' : 'concept-node__path-step'}>
              前置来源
            </span>
            <span className={introducedRevealed ? 'concept-node__path-step concept-node__path-step--active' : 'concept-node__path-step'}>
              本式符号
            </span>
          </div>
          <div className="concept-node__reveal">
            <button
              type="button"
              disabled={!prerequisiteCount}
              className={prerequisitesRevealed ? 'concept-node__reveal-button concept-node__reveal-button--active nodrag nopan' : 'concept-node__reveal-button nodrag nopan'}
              onClick={(event) => revealGroup(event, 'prerequisites')}
            >
              <span>{prerequisitesRevealed ? '收起前置' : '第 1 层前置'}</span>
              <strong>{prerequisiteCount}</strong>
            </button>
            <button
              type="button"
              disabled={!introducedCount}
              className={introducedRevealed ? 'concept-node__reveal-button concept-node__reveal-button--active nodrag nopan' : 'concept-node__reveal-button nodrag nopan'}
              onClick={(event) => revealGroup(event, 'introduced')}
            >
              <span>{introducedRevealed ? '收起符号' : '第 2 层本式符号'}</span>
              <strong>{introducedCount}</strong>
            </button>
          </div>
          <div className={evidenceOpen ? 'concept-node__evidence concept-node__evidence--open' : 'concept-node__evidence'}>
            <div className="concept-node__evidence-heading">
              <span>{evidenceOpen ? '公式证据' : `公式证据已折叠 · 已展开 ${revealedCount}/2 层`}</span>
              <div className="concept-node__evidence-actions">
                <button type="button" className="nodrag nopan" onClick={toggleEvidence}>
                  {evidenceOpen ? '收起' : '展开'}
                </button>
                <button type="button" className="nodrag nopan" onClick={openFormula}>
                  查看公式
                </button>
              </div>
            </div>
            {evidenceOpen ? (
              <>
                {sourceSentence ? (
                  <p className="concept-node__source">
                    <RichMathText text={sourceSentence} />
                  </p>
                ) : null}
                <MathFormula latex={view.supporting_formula_latex} className="concept-node__formula" />
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {flags.length ? (
        <div className="concept-node__review">
          {flags.includes('needs_review') ? '需要复核' : '未人工审阅'}
        </div>
      ) : null}
      {role === 'introduced' ? <div className="concept-node__locked-note">背景概念，不继续展开</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
