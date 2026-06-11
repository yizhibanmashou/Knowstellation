import React from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { ConceptNodeData, ConceptRevealGroup } from '../../shared/types/graph';
import { formatSectionLabel } from '../../shared/utils/uiCopy';
import { MathFormula } from '../../shared/components/MathFormula';
import { RichMathText } from '../../shared/components/RichMathText';

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
  const clickable = role === 'prerequisite' && nodeData.clickable && Boolean(reference?.concept_id);
  const canExpandPrerequisites = role === 'prerequisite' && Boolean(nodeData.canExpandPrerequisites && reference);
  const focusDefinition = view.definition_zh?.trim() || view.definition;
  const referenceDefinition = reference?.definition_zh?.trim() || reference?.definition?.trim();
  const isIntroducedReference = reference?.relation === 'introduced_for';
  const compactDefinition = referenceDefinition
    || (role === 'prerequisite' && !isIntroducedReference
      ? `这个概念支撑当前公式，可顺着 ${formulaLabel} 查看它的来源。`
      : `这个符号在 ${formulaLabel} 中帮助解释当前概念。`);

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

  const togglePrerequisites = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!reference) return;
    nodeData.onExpandPrerequisites?.(reference);
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
        <span className="concept-node__role">
          {role === 'focus' ? '当前概念' : role === 'prerequisite' ? (nodeData.depth === 2 ? '第 2 层前置' : '前置概念') : '本式符号'}
        </span>
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
      {clickable || canExpandPrerequisites ? (
        <div className="concept-node__actions">
          {canExpandPrerequisites ? (
            <button
              type="button"
              className={nodeData.prerequisitesExpanded ? 'concept-node__expand-button concept-node__expand-button--active nodrag nopan' : 'concept-node__expand-button nodrag nopan'}
              onClick={togglePrerequisites}
              aria-label={`${nodeData.prerequisitesExpanded ? '收起' : '展开'} ${title} 的前置概念`}
            >
              <span>{nodeData.prerequisitesExpanded ? '收起前置' : '展开前置'}</span>
              {nodeData.prerequisitesExpanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            </button>
          ) : null}
          {clickable ? (
            <button
              type="button"
              className="concept-node__open-button nodrag nopan"
              onClick={openConcept}
              aria-label={`进入前置概念 ${title}`}
            >
              <span>进入概念</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {role === 'focus' ? (
        <>
          <div className="concept-node__learning-path" aria-label="概念展开层级">
            <span className="concept-node__path-step concept-node__path-step--active">概念解读</span>
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
              <MathFormula latex={view.supporting_formula_latex} className="concept-node__formula" />
            ) : null}
          </div>
        </>
      ) : null}
      {role === 'introduced' ? <div className="concept-node__locked-note">本式符号，用于理解当前公式</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
