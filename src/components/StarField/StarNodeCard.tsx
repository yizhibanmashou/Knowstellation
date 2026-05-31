import { ArrowRight, X } from 'lucide-react';
import type { StarNode } from '../../utils/starNavigation';
import { formatSectionLabel } from '../../utils/uiCopy';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../utils/uiCopy';
import { MathFormula } from '../common/MathFormula';

interface StarNodeCardProps {
  node: StarNode;
  x: number;
  y: number;
  onClose: () => void;
  onEnter: () => void;
}

export function StarNodeCard({ node, x, y, onClose, onEnter }: StarNodeCardProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const width = node.kind === 'chapter' ? 360 : 420;
  const height = node.kind === 'chapter' ? 250 : 390;
  const gap = 24;
  const left = x + gap + width < window.innerWidth ? x + gap : Math.max(16, x - width - gap);
  const top = y + gap + height < window.innerHeight ? y + gap : Math.max(80, window.innerHeight - height - 18);

  return (
    <div className="star-node-card fixed z-[70] w-[min(420px,calc(100vw-32px))]" style={{ left, top }}>
      <button type="button" className="star-node-card__close" onClick={onClose} aria-label="关闭卡片">
        <X size={15} />
      </button>
      <p className="star-node-card__eyebrow">{node.kind === 'chapter' ? '章节节点' : node.isBackbone ? '推荐起点' : '公式节点'}</p>
      <h2>{node.title}</h2>
      <p className="star-node-card__meta">
        {node.kind === 'chapter' ? `${node.formulaCount || 0} 个公式` : `${node.label} · ${formatSectionLabel(node.section) || '公式'}`}
      </p>
      {node.latex ? <MathFormula latex={node.latex} className="star-node-card__math" /> : null}
      <p className="star-node-card__copy">{node.kind === 'chapter' ? node.subtitle : node.context || node.subtitle}</p>
      <button type="button" className="star-node-card__action" onClick={onEnter}>
        {node.kind === 'chapter' ? '进入章节' : copy.storyline.openGraph}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
