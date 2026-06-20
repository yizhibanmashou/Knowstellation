import type { FormulaPrerequisite, ChapterFormula } from './formula';
import type { ConceptNodeRole, ConceptReference, ConceptView } from './conceptGraph';
import type { FocusAnnotationKind } from '../../features/graph/focusAnnotations';

export type FormulaExpansionIntent = 'auto' | 'prerequisites' | 'successors';
export type ConceptRevealGroup = 'prerequisites' | 'successors' | 'introduced';

export interface FormulaNodeData {
  formula: ChapterFormula;
  focused: boolean;
  loading?: boolean;
  role?: 'focus' | 'prerequisite' | 'expanded' | 'successor';
  mode?: 'concept' | 'formula' | 'explore' | 'conceptMap';
  locked?: boolean;
  lockedReason?: string;
  lockedTargetFormulaId?: string;
  lockedTargetLabel?: string;
  learned?: boolean;
  chapterGraph?: boolean;
  hasGraphPrerequisites?: boolean;
  hasGraphSuccessors?: boolean;
  studyNextFormulaId?: string;
  studyNextFormulaLabel?: string;
  studyNextFormulaLocked?: boolean;
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
  onOpenStudyFormula?: (formulaId: string) => void;
}

export interface VariableNodeData {
  prerequisite: FormulaPrerequisite;
  formulaId?: string;
  formulaLatex?: string;
}

export interface ConceptNodeData {
  view: ConceptView;
  role: ConceptNodeRole;
  reference?: ConceptReference;
  clickable: boolean;
  active?: boolean;
  depth?: number;
  canExpandPrerequisites?: boolean;
  prerequisitesExpanded?: boolean;
  evidenceOpen?: boolean;
  conceptCounts?: Partial<Record<ConceptRevealGroup, number>>;
  revealedGroups?: Partial<Record<ConceptRevealGroup, boolean>>;
  onRevealGroup?: (group: ConceptRevealGroup) => void;
  onToggleEvidence?: () => void;
  onExpandPrerequisites?: (reference: ConceptReference) => void;
  onOpenConcept: (conceptId: string) => void;
  onOpenFormula: (formulaId: string) => void;
}

export interface ConceptMapNodeData {
  view: ConceptView;
  active?: boolean;
  prerequisiteCount: number;
  successorCount: number;
  formulaLabel?: string;
  onOpenConcept: (conceptId: string) => void;
  onOpenFormula: (formulaId: string) => void;
}

export interface DependencyEdgeData {
  via: string;
  crossChapter: boolean;
  confidence: number;
  kind?: 'formula' | 'concept' | 'introduced';
  relation?: string;
  explanation?: string;
  active?: boolean;
  dimmed?: boolean;
  labelVisible?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
}
