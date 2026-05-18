import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { DependencyEdgeData } from '../../types/graph';

export function DependencyEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath(props);
  const data = props.data as unknown as DependencyEdgeData | undefined;
  const cross = Boolean(data?.crossChapter);

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={props.markerEnd}
        className={`dependency-edge ${cross ? 'dependency-edge--cross' : ''}`}
        style={{
          stroke: cross ? '#6366f1' : '#94a3b8',
          strokeWidth: 1.5,
          strokeDasharray: cross ? '6 3' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {data?.via || 'via'}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
