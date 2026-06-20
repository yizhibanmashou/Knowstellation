import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConceptBackedFocusSymbolPrerequisites, buildFocusSymbolPrerequisites } from '../src/features/graph/graphCanvasModel.ts';
import type { ChapterFormula, FormulaDependency } from '../src/shared/types/formula.ts';
import type { ConceptGraphPayload } from '../src/shared/types/conceptGraph.ts';

test('buildConceptBackedFocusSymbolPrerequisites covers styled chapter 6 symbols from formula and concept layers', () => {
  const formula: ChapterFormula = {
    id: 'formula_6.1',
    latex: '\\overline{z}=\\sum q_{i}z_{i}/N+\\widehat{p}',
    label: 'Formula 6.1',
    chapter_id: 'chapter6',
    section: 'Selection',
    subsection: 'Trait response',
    position: 1,
    context_text: 'Mean trait value combines class frequencies and trait values.',
    symbols_defined: ['\\overline{z}'],
    symbols_used: ['N', 'q_{i}', 'z_{i}', '\\widehat{p}'],
  };
  const conceptGraph = {
    chapter_id: 'chapter6',
    version: 1,
    generated_at: '2026-06-19T00:00:00Z',
    source: {
      formula_dependency_graph: '',
      symbol_sense_prompts: '',
      method: 'test',
    },
    summary: {
      chapter_id: 'chapter6',
      formulas_processed: 1,
      symbol_concept_entries: 2,
      unique_concepts: 2,
      concept_views: 2,
      prerequisite_edges: 0,
      introduced_edges: 0,
      low_confidence_entries: 0,
      formula_edges_used: 0,
    },
    views: [
      {
        chapter_id: 'chapter6',
        concept_id: 'concept_mean_trait',
        name: 'Mean Trait Value',
        definition: 'The population mean of the trait.',
        definition_zh: 'Trait mean across the population.',
        concept_type: 'quantity_concept',
        defined_by_formula_id: formula.id,
        defined_symbol: '\\overline{z}',
        supporting_formula_label: formula.label,
        supporting_formula_latex: formula.latex,
        confidence: 0.95,
        prerequisite_concepts: [],
        successor_concepts: [],
        introduced_concepts: [],
        edges: [],
        evidence: [],
      },
      {
        chapter_id: 'chapter6',
        concept_id: 'concept_estimated_frequency',
        name: 'Estimated Allele Frequency',
        definition: 'An estimated allele frequency used as an input.',
        definition_zh: 'Estimated allele frequency used as an input.',
        concept_type: 'quantity_concept',
        defined_by_formula_id: 'formula_6.other',
        defined_symbol: '\\hat{p}',
        supporting_formula_label: 'Formula 6.other',
        supporting_formula_latex: '\\hat{p}=x',
        confidence: 0.92,
        prerequisite_concepts: [],
        successor_concepts: [],
        introduced_concepts: [
          {
            concept_id: 'concept_foreign_symbol',
            name: 'Foreign Symbol',
            symbol: 'X_{foreign}',
            defined_by_formula_id: 'formula_6.other',
            formula_label: 'Formula 6.other',
            clickable: false,
            confidence: 0.9,
            concept_type: 'quantity_concept',
            definition: 'A symbol introduced by the foreign formula only.',
            definition_zh: 'A symbol introduced by the foreign formula only.',
          },
        ],
        edges: [],
        evidence: [],
      },
      {
        chapter_id: 'chapter6',
        concept_id: 'concept_offspring_parent_regression',
        name: 'Offspring-on-Parent Trait Regression',
        definition: 'A regression coefficient relating offspring mean traits to parent traits.',
        definition_zh: 'A regression coefficient relating offspring mean traits to parent traits.',
        concept_type: 'quantity_concept',
        defined_by_formula_id: 'formula_6.35',
        defined_symbol: '\\beta_{\\overline{z}|z}',
        supporting_formula_label: 'Formula 6.35',
        supporting_formula_latex: '\\beta_{\\overline{z}|z}=x',
        confidence: 0.91,
        formula_references: [
          {
            formula_id: formula.id,
            formula_label: formula.label,
            formula_latex: formula.latex,
            symbol: '\\overline{z}',
          },
        ],
        prerequisite_concepts: [],
        successor_concepts: [],
        introduced_concepts: [],
        edges: [],
        evidence: [],
      },
    ],
  } satisfies ConceptGraphPayload;

  const notes = buildConceptBackedFocusSymbolPrerequisites(formula, null, conceptGraph);
  const symbols = new Set(notes.map((item) => item.symbol));

  assert.ok(notes.some((item) => item.symbol === '\\overline{z}' && item.source === 'concept_graph'));
  assert.ok(notes.some((item) => item.symbol === '\\widehat{p}' && item.source === 'concept_graph'));
  for (const symbol of ['N', 'q_{i}', 'z_{i}', '\\widehat{p}']) {
    assert.ok(symbols.has(symbol), `missing hover note for ${symbol}`);
  }
  assert.equal(symbols.has('X_{foreign}'), false);
  assert.equal(notes.some((item) => item.concept_id === 'concept_offspring_parent_regression'), false);
});

test('buildFocusSymbolPrerequisites merges dependency notes with scanned symbols and fraction groups', () => {
  const formula: ChapterFormula = {
    id: 'formula_hover_ratio',
    latex: '\\frac{d_s}{p_s}=q',
    label: 'Formula hover ratio',
    chapter_id: 'chapter-test',
    section: 'Runtime hover',
    subsection: '',
    position: 0,
    context_text: 'The local ratio compares d_s with p_s.',
    symbols_defined: [],
    symbols_used: [],
  };
  const dependency: FormulaDependency = {
    dependent_id: formula.id,
    prerequisites: [
      {
        type: 'variable_definition',
        symbol: 'q',
        meaning: 'local comparison output',
        confidence: 0.86,
        edge_status: 'accepted',
      },
    ],
  };

  const notes = buildFocusSymbolPrerequisites(formula, dependency);
  const keys = notes.map((item) => `${item.kind || 'symbol'}:${item.target || item.symbol}`);

  assert.ok(keys.includes('symbol:q'));
  assert.ok(keys.includes('symbol:d_s'));
  assert.ok(keys.includes('symbol:p_s'));
  assert.ok(keys.includes('compound:\\frac{d_s}{p_s}'));
  assert.ok(keys.includes('compound:\\frac{d_s}{}'));
  assert.ok(keys.includes('compound:\\frac{}{p_s}'));
});

test('buildConceptBackedFocusSymbolPrerequisites keeps fallback symbols when concept notes exist', () => {
  const formula: ChapterFormula = {
    id: 'formula_guided_concept_only',
    latex: 'R=S+h^{2}',
    label: 'Formula guided concept only',
    chapter_id: 'chapter-test',
    section: 'Guided',
    subsection: '',
    position: 1,
    context_text: 'The response is explained by reviewed concepts.',
    symbols_defined: ['R'],
    symbols_used: ['S', 'h^{2}'],
  };
  const dependency: FormulaDependency = {
    dependent_id: formula.id,
    prerequisites: [
      {
        type: 'variable_definition',
        symbol: 'S',
        meaning: 'fallback selection differential',
        confidence: 0.86,
        edge_status: 'accepted',
      },
    ],
  };
  const conceptGraph = {
    chapter_id: 'chapter-test',
    version: 1,
    generated_at: '2026-06-14T00:00:00Z',
    source: {
      formula_dependency_graph: '',
      symbol_sense_prompts: '',
      method: 'test',
    },
    summary: {
      chapter_id: 'chapter-test',
      formulas_processed: 1,
      symbol_concept_entries: 1,
      unique_concepts: 1,
      concept_views: 1,
      prerequisite_edges: 0,
      introduced_edges: 0,
      low_confidence_entries: 0,
      formula_edges_used: 0,
    },
    views: [
      {
        chapter_id: 'chapter-test',
        concept_id: 'concept_response',
        name: 'Selection Response',
        definition: 'The change in the trait mean after selection.',
        definition_zh: '选择后性状均值的变化。',
        concept_type: 'quantity_concept',
        defined_by_formula_id: formula.id,
        defined_symbol: 'R',
        supporting_formula_label: formula.label,
        supporting_formula_latex: formula.latex,
        confidence: 0.94,
        prerequisite_concepts: [],
        successor_concepts: [],
        introduced_concepts: [],
        edges: [],
        evidence: [],
      },
    ],
  } satisfies ConceptGraphPayload;

  const notes = buildConceptBackedFocusSymbolPrerequisites(formula, dependency, conceptGraph);

  assert.ok(notes.some((item) => item.symbol === 'R' && item.source === 'concept_graph'));
  assert.ok(notes.some((item) => item.symbol === 'S'));
  assert.ok(notes.some((item) => item.symbol === 'h^{2}'));
});

test('buildConceptBackedFocusSymbolPrerequisites prefers reviewed concept graph definitions', () => {
  const formula: ChapterFormula = {
    id: 'formula_2.3',
    latex: 'f_{t}=\\frac{1}{2N}+\\left(1-\\frac{1}{2N}\\right)f_{t-1}',
    label: 'Formula 2.3',
    chapter_id: 'chapter2',
    section: 'Drift',
    subsection: '',
    position: 3,
    context_text: 'The inbreeding coefficient follows from identity by descent.',
    symbols_defined: ['f_{t}'],
    symbols_used: ['N', 'f_{t-1}'],
  };
  const conceptGraph = {
    chapter_id: 'chapter2',
    version: 1,
    generated_at: '2026-06-14T00:00:00Z',
    source: {
      formula_dependency_graph: '',
      symbol_sense_prompts: '',
      method: 'test',
    },
    summary: {
      chapter_id: 'chapter2',
      formulas_processed: 1,
      symbol_concept_entries: 2,
      unique_concepts: 2,
      concept_views: 1,
      prerequisite_edges: 0,
      introduced_edges: 1,
      low_confidence_entries: 0,
      formula_edges_used: 0,
    },
    views: [
      {
        chapter_id: 'chapter2',
        concept_id: 'concept_inbreeding_coefficient',
        name: 'Inbreeding Coefficient',
        definition: 'Probability that two alleles are identical by descent.',
        definition_zh: '两个等位基因同源同祖的概率。',
        concept_type: 'quantity_concept',
        defined_by_formula_id: 'formula_2.3',
        defined_symbol: 'f_{t}',
        supporting_formula_label: 'Formula 2.3',
        supporting_formula_latex: formula.latex,
        confidence: 0.95,
        prerequisite_concepts: [],
        successor_concepts: [],
        introduced_concepts: [
          {
            concept_id: 'concept_population_size',
            name: 'Population Size',
            symbol: 'N',
            defined_by_formula_id: null,
            formula_label: 'Formula 2.3',
            clickable: false,
            confidence: 0.88,
            concept_type: 'domain_concept',
            definition: 'The size of the modeled population.',
            definition_zh: '模型中的群体大小。',
          },
        ],
        edges: [],
        evidence: [],
      },
    ],
  } satisfies ConceptGraphPayload;

  const notes = buildConceptBackedFocusSymbolPrerequisites(formula, null, conceptGraph);
  const ftNote = notes.find((item) => item.symbol === 'f_{t}' && item.source === 'concept_graph');
  const nNote = notes.find((item) => item.symbol === 'N' && item.source === 'concept_graph');

  assert.equal(ftNote?.shortLabel, 'Inbreeding Coefficient');
  assert.equal(ftNote?.definition, '两个等位基因同源同祖的概率。');
  assert.equal(ftNote?.llmStatus, 'ready');
  assert.equal(nNote?.definition, '模型中的群体大小。');
});
