import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { VariableNodeData } from '../../types/graph';

export function VariableDefNode({ data }: NodeProps) {
  const nodeData = data as unknown as VariableNodeData;
  const prerequisite = nodeData.prerequisite;
  return (
    <div className="variable-def-node bg-white/40 text-slate-600 backdrop-blur-md">
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <div className="text-xs font-semibold text-slate-600">{prerequisite.symbol}</div>
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-600">{prerequisite.definition}</div>
      <div className="mt-2 truncate text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{prerequisite.source}</div>
    </div>
  );
}
