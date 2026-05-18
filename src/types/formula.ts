export interface SearchFormula {
  id: string;
  number: string;
  chapter: number;
  section: string;
  label: string;
  latex_preview: string;
  context: string;
  keywords: string[];
}

export interface FeaturedFormula {
  id: string;
  chapter: string;
  label: string;
  display_name: string;
  importance: number;
  latex_preview?: string;
}

export interface ChapterFormula {
  id: string;
  latex: string;
  label: string;
  section: string;
  subsection: string;
  position: number;
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
  symbol?: string;
  definition?: string;
  source?: string;
  source_chunk_id?: string;
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
