import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { DependencyEdgeData } from '../../shared/types/graph';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { MathFormula } from '../../shared/components/MathFormula';

export function DependencyEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const data = props.data as unknown as DependencyEdgeData | undefined;
  const cross = Boolean(data?.crossChapter);
  const active = Boolean(data?.active);
  const dimmed = Boolean(data?.dimmed);
  const conceptKind = data?.kind === 'concept';
  const introducedKind = data?.kind === 'introduced';
  const labelVisible = !introducedKind && (conceptKind ? Boolean(data?.labelVisible) : Boolean(data?.labelVisible || active));
  const animated = cross || Boolean(props.animated);
  const label = data?.via || 'via';
  const mathLabel = /\\|[_^{}]/.test(label) || /^[A-Za-z]$/.test(label);
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph.edge;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={props.markerEnd}
        className={`dependency-edge ${conceptKind ? 'dependency-edge--concept' : ''} ${introducedKind ? 'dependency-edge--introduced' : ''} ${cross ? 'dependency-edge--cross' : ''} ${animated ? 'dependency-edge--animated' : ''} ${active ? 'dependency-edge--active' : ''} ${dimmed ? 'dependency-edge--dimmed' : ''}`}
        style={{
          strokeWidth: active ? 3 : introducedKind ? 1.75 : cross ? 2.35 : 2.1,
        }}
      />
      {labelVisible ? (
        <EdgeLabelRenderer>
          <div className={`edge-label nodrag nopan ${active ? 'edge-label--active' : ''}`} title={data?.explanation} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            <span className="edge-label__verb">{copy.uses}</span>
            {mathLabel ? <MathFormula latex={label} inline className="edge-label__math" /> : <span>{label}</span>}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
