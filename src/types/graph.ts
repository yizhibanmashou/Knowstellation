import type { FormulaPrerequisite, ChapterFormula } from './formula';
import type { FocusAnnotationKind } from '../utils/focusAnnotations';

export type FormulaExpansionIntent = 'auto' | 'prerequisites' | 'successors';

export interface FormulaNodeData {
  formula: ChapterFormula;
  focused: boolean;
  loading?: boolean;
  role?: 'focus' | 'prerequisite' | 'expanded' | 'successor';
  mode?: 'guided' | 'explore';
  locked?: boolean;
  lockedReason?: string;
  lockedTargetFormulaId?: string;
  lockedTargetLabel?: string;
  learned?: boolean;
  chapterGraph?: boolean;
  symbolExplanations?: Array<
    FormulaPrerequisite & {
      shortLabel?: string;
      llmText?: string;
      llmStatus?: 'loading' | 'ready' | 'error';
      kind?: FocusAnnotationKind;
    }
  >;
  onExpand: (formulaId: string, intent?: FormulaExpansionIntent) => void;
  onLockedTarget?: (formulaId: string) => void;
}

export interface VariableNodeData {
  prerequisite: FormulaPrerequisite;
  formulaId?: string;
  formulaLatex?: string;
}

export interface DependencyEdgeData {
  via: string;
  crossChapter: boolean;
  confidence: number;
  explanation?: string;
  active?: boolean;
  dimmed?: boolean;
  labelVisible?: boolean;
}
