import { formatSectionLabel } from '../../utils/uiCopy';
import type { ActiveNode } from './starFieldTypes';

export function StarNodeHoverTooltip({ node, x, y }: ActiveNode) {
  const width = node.kind === 'chapter' ? 260 : 300;
  const gap = 18;
  const left = x + gap + width < window.innerWidth ? x + gap : Math.max(14, x - width - gap);
  const top = Math.min(Math.max(14, y + gap), Math.max(14, window.innerHeight - 150));

  return (
    <div className="star-node-hover-tooltip fixed z-[65]" style={{ left, top, width }}>
      <p>{node.fullLabel || node.label}</p>
      <strong>{node.title}</strong>
      <span>{node.kind === 'chapter' ? `${node.formulaCount || 0} 个公式` : formatSectionLabel(node.section) || node.subtitle}</span>
    </div>
  );
}
