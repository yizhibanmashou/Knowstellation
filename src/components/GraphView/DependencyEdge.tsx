import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { DependencyEdgeData } from '../../types/graph';

export function DependencyEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath(props);
  const data = props.data as unknown as DependencyEdgeData | undefined;
  const cross = Boolean(data?.crossChapter);
  const animated = cross || Boolean(props.animated);

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={props.markerEnd}
        className={`dependency-edge ${cross ? 'dependency-edge--cross' : ''} ${animated ? 'dependency-edge--animated' : ''}`}
        style={{
          strokeWidth: 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {data?.via || 'via'}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
