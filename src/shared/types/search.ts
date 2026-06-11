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
}

export type SearchResult = FormulaSearchResult | ChapterSearchResult | ConceptSearchResult;
