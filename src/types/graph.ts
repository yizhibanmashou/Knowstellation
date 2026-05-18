import type { FormulaPrerequisite, ChapterFormula } from './formula';

export interface FormulaNodeData {
  formula: ChapterFormula;
  focused: boolean;
  loading?: boolean;
  onExpand: (formulaId: string) => void;
}

export interface VariableNodeData {
  prerequisite: FormulaPrerequisite;
}

export interface DependencyEdgeData {
  via: string;
  crossChapter: boolean;
  confidence: number;
}
