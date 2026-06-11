export type ConceptRole = 'defined' | 'used';

export type ConceptNodeRole = 'focus' | 'prerequisite' | 'introduced';

export interface ConceptEvidence {
  chunk_id: string;
  block_index: number;
  block_type: string;
  sentence?: string;
  teaching_move?: string;
  teaching_move_zh?: string;
}

export interface SymbolConcept {
  chapter_id: string;
  formula_id: string;
  formula_label: string;
  symbol: string;
  role: ConceptRole;
  concept_id: string;
  concept_name: string;
  concept_type: string;
  definition: string;
  definition_zh?: string;
  aliases: string[];
  evidence: ConceptEvidence[];
  confidence: number;
  extraction_model: string;
}

export interface ConceptReference {
  concept_id: string;
  name: string;
  symbol?: string;
  defined_by_formula_id: string | null;
  from_formula_id?: string;
  formula_label: string;
  via_symbol?: string;
  clickable: boolean;
  confidence: number;
  relation?: string;
  concept_type?: string;
  definition?: string;
  definition_zh?: string;
  teaching_move?: string;
  teaching_move_zh?: string;
  source_sentence?: string;
  prerequisite_concepts?: ConceptReference[];
  introduced_concepts?: ConceptReference[];
}

export interface ConceptViewEdge {
  from: string;
  to: string;
  relation: 'prerequisite_for' | 'introduced_for' | string;
  clickable: boolean;
  confidence: number;
  symbol?: string;
  derived_from_formula_edge?: {
    from: string;
    to: string;
    via_symbol?: string;
  };
}

export interface ConceptView {
  chapter_id: string;
  concept_id: string;
  name: string;
  definition: string;
  definition_zh?: string;
  teaching_move?: string;
  teaching_move_zh?: string;
  source_sentence?: string;
  concept_type: string;
  defined_by_formula_id: string;
  defined_symbol: string;
  supporting_formula_label: string;
  supporting_formula_latex: string;
  formula_position?: number;
  formula_section?: string;
  formula_subsection?: string;
  evidence: ConceptEvidence[];
  confidence: number;
  prerequisite_concepts: ConceptReference[];
  introduced_concepts: ConceptReference[];
  edges: ConceptViewEdge[];
}

export interface ConceptGraphSummary {
  chapter_id: string;
  formulas_processed: number;
  symbol_concept_entries: number;
  unique_concepts: number;
  concept_views: number;
  prerequisite_edges: number;
  introduced_edges: number;
  low_confidence_entries: number;
  formula_edges_used: number;
}

export interface ConceptGraphSource {
  formula_dependency_graph: string;
  symbol_sense_prompts: string;
  structured_blocks?: string;
  method: string;
}

export interface ConceptGraphPayload {
  chapter_id: string;
  version: number;
  generated_at: string;
  source: ConceptGraphSource;
  summary: ConceptGraphSummary;
  symbol_concepts: SymbolConcept[];
  views: ConceptView[];
}
