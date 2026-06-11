export interface SearchFormula {
  id: string;
  number: string;
  chapter: number;
  chapter_id: string;
  section: string;
  label: string;
  latex_preview: string;
  context: string;
  keywords: string[];
}

export interface FeaturedFormula {
  id: string;
  chapter: string;
  chapter_id?: string;
  label: string;
  display_name: string;
  importance: number;
  latex_preview?: string;
}

export interface FormulaLearningCopyText {
  plainMeaning: string;
  inThisChapter: string;
}

export interface FormulaLearningCopyEntry {
  en?: FormulaLearningCopyText;
  zh?: FormulaLearningCopyText;
  source_context_hash?: string;
  model?: string;
}

export interface FormulaLearningCopyPayload {
  version: number;
  generated_at: string;
  source: string;
  items: Record<string, FormulaLearningCopyEntry>;
}

export interface ChapterFormula {
  id: string;
  latex: string;
  label: string;
  chapter_id?: string;
  section: string;
  subsection: string;
  position: number;
  depth?: number;
  context_text: string;
  symbols_used: string[];
  symbols_defined: string[];
}

export interface FormulaPrerequisite {
  type: 'formula' | 'variable_definition';
  target_id?: string;
  via_symbol?: string;
  relation?: string;
  reason?: string;
  confidence: number;
  cross_chapter?: boolean;
  match_type?: 'exact' | 'family';
  edge_status?: 'accepted' | 'candidate' | 'ambiguous' | 'rejected';
  edge_evidence?:
    | 'explicit_reference'
    | 'exact_match'
    | 'canonical_match'
    | 'compound_group'
    | 'text_definition'
    | 'llm_reasoned'
    | 'family_candidate';
  canonical_symbol?: string;
  symbol_role?: string;
  edge_weight?: number;
  review_note?: string;
  symbol?: string;
  target?: string;
  definition?: string;
  meaning?: string;
  source?: string;
  source_chunk_id?: string;
  sense_id?: string;
  relationship?: string;
  source_excerpt?: string;
  candidates?: SymbolSenseCandidate[];
}

export interface FormulaDependency {
  dependent_id: string;
  prerequisites: FormulaPrerequisite[];
}

export interface ChapterDependencies {
  chapter_id: string;
  version: number;
  generated_at: string;
  formulas: ChapterFormula[];
  dependencies: FormulaDependency[];
  symbol_index: Record<string, string[]>;
  ambiguous: unknown[];
}

export type SymbolSenseMatchType =
  | 'formula_dependency'
  | 'variable_definition'
  | 'self_defined'
  | 'unresolved';

export type SymbolSenseSource =
  | {
      type: 'formula';
      formula_id: string;
      text_excerpt?: string;
    }
  | {
      type: 'text';
      text_excerpt: string;
      formula_id?: string;
    }
  | {
      type: 'none';
      formula_id?: string;
      text_excerpt?: string;
    };

export interface SymbolSenseScope {
  section: string;
  position_range: {
    start: number | null;
    end: number | null;
  };
}

export interface SymbolSenseCandidate {
  sense_id: string;
  meaning: string;
  confidence: number;
  reason?: string;
  source?: string;
}

export interface SymbolSenseResolution {
  symbol: string;
  sense_id: string;
  match_type: SymbolSenseMatchType;
  source: SymbolSenseSource;
  meaning: string;
  scope: SymbolSenseScope;
  relationship: string;
  confidence: number;
  reason: string;
  candidates: SymbolSenseCandidate[];
}

export interface SymbolSenseAmbiguousSymbol {
  symbol: string;
  candidates: SymbolSenseCandidate[];
  resolution_strategy: 'deferred_to_human' | 'nearest_prior' | 'context_match';
  note: string;
}

export interface SymbolSenseMergeDecision {
  symbol: string;
  existing_sense_id: string | null;
  new_sense_id: string;
  action: 'merge' | 'create_new' | 'ambiguous';
  reason: string;
}

export interface SymbolSenseFormulaResult {
  formula_id: string;
  symbols_used: string[];
  symbols_defined: string[];
  resolution: SymbolSenseResolution[];
  ambiguous_symbols: SymbolSenseAmbiguousSymbol[];
  merge_decisions: SymbolSenseMergeDecision[];
}

export interface SymbolSensePayload {
  chapter_id: string;
  version: number;
  generated_at: string;
  results: SymbolSenseFormulaResult[];
}

export interface SymbolSenseRegistryEntry {
  sense_id: string;
  symbol: string;
  meaning: string;
  source: SymbolSenseSource;
  scope: SymbolSenseScope;
  evidence_formula_ids: string[];
  merge_actions: SymbolSenseMergeDecision[];
}

export interface StorylineStep {
  formula_id: string;
  title: string;
  transition_en: string;
  transition_zh: string;
  support_formula_ids: string[];
}

export interface StorylineEntry {
  id: string;
  title_en: string;
  title_zh: string;
  symbol: string;
  intro_en: string;
  intro_zh: string;
  steps: StorylineStep[];
}

export interface StorylinePayload {
  version: number;
  items: StorylineEntry[];
}
