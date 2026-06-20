import { ArrowRight, X } from 'lucide-react';
import type { StarNode } from './starNavigation';
import { formatFormulaReferenceLabel, formatSectionLabel } from '../../shared/utils/uiCopy';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { MathFormula } from '../../shared/components/MathFormula';
import { buildReadableFormulaCopy } from '../graph/formulaInfo';

interface StarNodeCardProps {
  node: StarNode;
  x: number;
  y: number;
  onClose: () => void;
  onEnter: () => void;
}

export function StarNodeCard({ node, x, y, onClose, onEnter }: StarNodeCardProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE);
  const formulaCopy = node.kind === 'formula'
    ? buildReadableFormulaCopy({
        formulaId: node.id,
        language: DEFAULT_LANGUAGE,
        context: node.context,
        latex: node.latex,
        formulaLabel: node.fullLabel || node.title,
        formulaNumber: node.label,
        section: node.section,
      })
    : null;
  const width = node.kind === 'chapter' ? 360 : 420;
  const height = node.kind === 'chapter' ? 250 : node.kind === 'concept' ? 310 : 390;
  const gap = 24;
  const left = x + gap + width < window.innerWidth ? x + gap : Math.max(16, x - width - gap);
  const top = y + gap + height < window.innerHeight ? y + gap : Math.max(80, window.innerHeight - height - 18);
  const eyebrow = node.kind === 'chapter' ? '章节节点' : node.kind === 'concept' ? '概念节点' : node.isBackbone ? '主线公式' : '公式节点';
  const meta = node.kind === 'chapter'
    ? `${node.formulaCount || 0} 个公式`
    : node.kind === 'concept'
      ? [node.symbol, node.formulaLabel, formatSectionLabel(node.section)].filter(Boolean).join(' · ') || '概念'
      : `${node.label} · ${formatSectionLabel(node.section) || '公式'}`;
  const body = node.kind === 'chapter'
    ? node.subtitle
    : node.kind === 'concept'
      ? node.context || node.subtitle
      : formulaCopy?.takeaway || formulaCopy?.plainMeaning || node.subtitle;
  const action = node.kind === 'chapter' ? '进入章节' : node.kind === 'concept' ? '进入概念图谱' : copy.storyline.openGraph;

  return (
    <div className="star-node-card fixed z-[70] w-[min(420px,calc(100vw-32px))]" style={{ left, top }}>
      <button type="button" className="star-node-card__close" onClick={onClose} aria-label="关闭卡片">
        <X size={15} />
      </button>
      <p className="star-node-card__eyebrow">{eyebrow}</p>
      <h2>{node.kind === 'formula' ? formatFormulaReferenceLabel(node.title) : node.title}</h2>
      <p className="star-node-card__meta">{meta}</p>
      {node.latex ? <MathFormula latex={node.latex} className="star-node-card__math" /> : null}
      <p className="star-node-card__copy">{body}</p>
      <button type="button" className="star-node-card__action" onClick={onEnter}>
        {action}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
