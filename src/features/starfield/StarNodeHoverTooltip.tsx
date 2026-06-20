import { formatFormulaReferenceLabel, formatSectionLabel } from '../../shared/utils/uiCopy';
import type { ActiveNode } from './starFieldTypes';

export function StarNodeHoverTooltip({ node, x, y }: ActiveNode) {
  const width = node.kind === 'chapter' ? 260 : node.kind === 'concept' ? 280 : 300;
  const gap = 18;
  const left = x + gap + width < window.innerWidth ? x + gap : Math.max(14, x - width - gap);
  const top = Math.min(Math.max(14, y + gap), Math.max(14, window.innerHeight - 150));
  const meta = node.kind === 'chapter'
    ? `${node.formulaCount || 0} 个公式`
    : node.kind === 'concept'
      ? [node.symbol, node.formulaLabel].filter(Boolean).join(' · ') || '概念节点'
      : formatSectionLabel(node.section) || node.subtitle;

  return (
    <div className="star-node-hover-tooltip fixed z-[65]" style={{ left, top, width }}>
      <p>{node.fullLabel || node.label}</p>
      <strong>{node.kind === 'formula' ? formatFormulaReferenceLabel(node.title) : node.title}</strong>
      <span>{meta}</span>
    </div>
  );
}
