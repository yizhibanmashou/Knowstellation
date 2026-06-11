import type { FormulaPrerequisite } from '../../shared/types/formula';
import { explainPrerequisite } from './formulaInfo';

interface DependencyExplanationProps {
  prerequisite: FormulaPrerequisite;
}

export function DependencyExplanation({ prerequisite }: DependencyExplanationProps) {
  return <p className="dependency-explanation">{explainPrerequisite(prerequisite)}</p>;
}
