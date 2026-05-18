import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { VariableNodeData } from '../../types/graph';

export function VariableDefNode({ data }: NodeProps) {
  const nodeData = data as unknown as VariableNodeData;
  const prerequisite = nodeData.prerequisite;
  return (
    <div className="variable-def-node">
      <Handle type="source" position={Position.Right} />
      <div className="text-sm font-semibold text-slate-800">{prerequisite.symbol}</div>
      <div className="mt-2 text-xs leading-5 text-slate-600">{prerequisite.definition}</div>
      <div className="mt-2 text-[11px] text-slate-500">{prerequisite.source}</div>
    </div>
  );
}
