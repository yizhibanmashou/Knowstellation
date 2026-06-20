import type { SearchFormula } from './formula';

export type FormulaSearchResult = SearchFormula & {
  resultType: 'formula';
  matchReason?: string;
  searchScore?: number;
};

export interface ChapterSearchResult {
  resultType: 'chapter';
  id: string;
  chapter_id: string;
  chapter: number;
  label: string;
  title: string;
  context: string;
  formula_count: number;
  matchReason?: string;
  searchScore?: number;
}

export interface ConceptSearchResult {
  resultType: 'concept';
  id: string;
  concept_id: string;
  view_id?: string;
  canonical_concept_id?: string;
  canonical_concept_name?: string;
  chapter_id: string;
  formula_id: string;
  title: string;
  context: string;
  symbol: string;
  formula_label: string;
  formula_section?: string;
  aliases?: string[];
  matchReason?: string;
  searchScore?: number;
  occurrenceCount?: number;
  formulaOccurrenceCount?: number;
  viewOccurrenceCount?: number;
  relatedFormulaLabels?: string[];
  primaryFormulaId?: string;
}

export interface ConceptNavigationEntry {
  view_id?: string;
  concept_id: string;
  canonical_concept_id?: string;
  canonical_concept_name?: string;
  formula_id: string;
  title: string;
  symbol: string;
  formula_label?: string;
  formula_section?: string;
  prerequisite_view_ids?: string[];
  prerequisite_concept_ids: string[];
  depth: number;
  order: number;
  occurrence_count?: number;
  related_formula_labels?: string[];
}

export interface ConceptChapterNavigation {
  chapter_id: string;
  concept_root_view_ids?: string[];
  concept_root_ids: string[];
  concept_navigation: ConceptNavigationEntry[];
}

export interface ConceptSearchIndexPayload {
  version?: number;
  generated_at?: string;
  source?: string;
  chapters?: ConceptChapterNavigation[];
  items: ConceptSearchResult[];
}

export type SearchResult = FormulaSearchResult | ChapterSearchResult | ConceptSearchResult;
