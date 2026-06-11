import { useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { VariableNodeData } from '../../shared/types/graph';
import { generateVariableDetails } from '../../shared/services/llmClient';
import { explainVariablePrerequisite, humanizeSource } from './formulaInfo';
import { DEFAULT_LANGUAGE, getUiCopy } from '../../shared/utils/uiCopy';
import { MathFormula } from '../../shared/components/MathFormula';

export function VariableDefNode({ data }: NodeProps) {
  const nodeData = data as unknown as VariableNodeData;
  const prerequisite = nodeData.prerequisite;
  const fallbackDefinition = explainVariablePrerequisite(prerequisite);
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph.variable;
  const [detail, setDetail] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; text: string }>({
    status: 'idle',
    text: fallbackDefinition,
  });
  const source = humanizeSource(prerequisite.source);

  useEffect(() => {
    if (!nodeData.formulaId || !prerequisite.symbol) {
      setDetail({ status: 'idle', text: fallbackDefinition });
      return;
    }
    let cancelled = false;
    setDetail({ status: 'loading', text: fallbackDefinition });
    generateVariableDetails({
      formulaId: nodeData.formulaId,
      latex: nodeData.formulaLatex || '',
      context: fallbackDefinition,
      symbol: prerequisite.symbol,
      prerequisite,
      language: 'zh',
    })
      .then((value) => {
        if (!cancelled) setDetail({ status: 'ready', text: value.text });
      })
      .catch(() => {
        if (!cancelled) setDetail({ status: 'error', text: fallbackDefinition });
      });
    return () => {
      cancelled = true;
    };
  }, [fallbackDefinition, nodeData.formulaId, nodeData.formulaLatex, prerequisite]);

  return (
    <div className="variable-def-node">
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2.5">
        <span className="variable-def-node__marker" />
        <MathFormula latex={prerequisite.symbol} inline className="variable-def-node__symbol min-w-0" />
      </div>
      <div className="variable-def-node__copy mt-2">{detail.text}</div>
      <div className="variable-def-node__source mt-2 truncate">
        {detail.status === 'loading' ? copy.loading : detail.status === 'ready' ? copy.ready : source}
      </div>
    </div>
  );
}
