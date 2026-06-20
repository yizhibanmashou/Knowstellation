import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchFormula } from '../src/shared/types/formula.ts';
import type { ChapterSearchResult, ConceptSearchResult } from '../src/shared/types/search.ts';
import { buildSearchQueryPlan, rankSearchResults, scoreChapterSearch, scoreConceptSearch, scoreFormulaSearch } from '../src/features/search/searchMatching.ts';

const formulas: SearchFormula[] = [
  {
    id: 'formula_2.1',
    number: '2.1',
    chapter: 2,
    chapter_id: 'chapter2',
    section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
    label: 'Formula 2.1',
    latex_preview: 'P_{ij}=\\binom{2N}{j}(i/2N)^{j}',
    context: 'Assuming the Wright-Fisher model, each sampled gamete has a binomial probability.',
    keywords: ['Neutral', 'Evolution', 'Wright-Fisher', 'binomial'],
  },
  {
    id: 'formula_2.5',
    number: '2.5',
    chapter: 2,
    chapter_id: 'chapter2',
    section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
    label: 'Formula 2.5',
    latex_preview: 'H_{t}=H_{0}\\left(1-\\frac{1}{2N}\\right)^{t}',
    context: 'This formula describes the expected population heterozygosity through time.',
    keywords: ['heterozygosity', 'population', 'neutral'],
  },
  {
    id: 'formula_2.10',
    number: '2.10',
    chapter: 2,
    chapter_id: 'chapter2',
    section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
    label: 'Formula 2.10',
    latex_preview: 'u_{t+1}=u_t+\\Delta u',
    context: 'A later formula in the same chapter.',
    keywords: ['neutral'],
  },
  {
    id: 'formula_16.15b',
    number: '16.15b',
    chapter: 16,
    chapter_id: 'chapter16',
    section: 'CHANGES IN VARIANCE UNDER TRUNCATION SELECTION',
    label: 'Formula 16.15b',
    latex_preview: '\\kappa=\\overline{\\imath}\\left(\\overline{\\imath}-x_{[1-p]}\\right)',
    context: 'Kappa is determined by selection intensity under truncation selection.',
    keywords: ['kappa', 'selection', 'intensity', 'truncation'],
  },
];
const formula21 = formulas.find((item) => item.number === '2.1')!;
const formula210 = formulas.find((item) => item.number === '2.10')!;
const formulaKappa = formulas.find((item) => item.number === '16.15b')!;

const chapter2: ChapterSearchResult = {
  resultType: 'chapter',
  id: 'chapter2',
  chapter_id: 'chapter2',
  chapter: 2,
  label: '第 2 章',
  title: 'Chapter 2 公式导航',
  context: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
  formula_count: 74,
};

const chapter20: ChapterSearchResult = {
  resultType: 'chapter',
  id: 'chapter20',
  chapter_id: 'chapter20',
  chapter: 20,
  label: '第 20 章',
  title: 'Chapter 20 公式导航',
  context: 'Chapter 20 包含 77 个公式。',
  formula_count: 77,
};

const heterozygosityConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_chapter2_formula_2_5_defined_h_t',
  concept_id: 'concept_chapter2_formula_2_5_defined_h_t',
  chapter_id: 'chapter2',
  formula_id: 'formula_2.5',
  title: 'Heterozygosity',
  context: 'Heterozygosity 是由当前支撑公式引入的局部数学量。',
  symbol: 'H_{t}',
  formula_label: 'Formula 2.5',
  formula_section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
  aliases: ['Heterozygosity', 'H Sub T', '杂合度'],
};

const effectivePopulationSizeConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_chapter3_formula_3_15_defined_n_e',
  concept_id: 'concept_chapter3_formula_3_15_defined_n_e',
  chapter_id: 'chapter3',
  formula_id: 'formula_3.15',
  title: 'Population Size',
  context: '模型中表示的个体数或基因拷贝数。',
  symbol: 'N_{e}',
  formula_label: 'Formula 3.15',
  formula_section: 'The Genetic Effective Size of a Population: Introduction',
  aliases: ['Population Size', 'quantity_concept', 'N_{e}', 'N Sub E', 'AGE STRUCTURE'],
};

const genericPopulationSizeConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_chapter3_formula_3_3_used_n_t',
  concept_id: 'concept_chapter3_formula_3_3_used_n_t',
  chapter_id: 'chapter3',
  formula_id: 'formula_3.3',
  title: 'Population Size',
  context: '模型中表示的个体数或基因拷贝数。',
  symbol: 'N_{t}',
  formula_label: 'Formula 3.3',
  formula_section: 'GENERAL CONSIDERATIONS',
  aliases: ['Population Size', 'quantity_concept', 'N_{t}', 'N Sub T', 'MONOECY'],
};

const linkageDisequilibriumConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_chapter2_formula_2_18_defined_d_ab',
  concept_id: 'concept_chapter2_formula_2_18_defined_d_ab',
  chapter_id: 'chapter2',
  formula_id: 'formula_2.18',
  title: 'D Sub Ab',
  context: 'D Sub Ab 是由当前支撑公式引入的局部数学量。',
  symbol: 'D_{AB}',
  formula_label: 'Formula 2.18',
  formula_section: 'Neutral Evolution in One- and Two-Locus Systems: Introduction',
  aliases: ['D Sub Ab', 'quantity_concept', 'D_{AB}', 'LINKAGE DISEQUILIBRIUM'],
};

const detailedBalanceConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_appendix3_formula_a3_21_defined_pi_j',
  concept_id: 'concept_appendix3_formula_a3_21_defined_pi_j',
  chapter_id: 'appendix3',
  formula_id: 'formula_A3.21',
  title: 'Detailed Balance Equation Holds, Namely,',
  context: 'Detailed Balance Equation Holds, Namely, 是由当前支撑公式引入的局部数学量。',
  symbol: '\\pi_{j}^{*}',
  formula_label: 'Formula A3.21',
  formula_section: 'INTRODUCTION TO MARKOV CHAINS',
  aliases: ['Detailed Balance Equation Holds, Namely,', 'quantity_concept', '\\pi_{j}^{*}', 'Pi Sub J Power *'],
};

const selectionIntensityConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_chapter14_formula_14_3a_defined_bar_imath',
  concept_id: 'concept_chapter14_formula_14_3a_defined_bar_imath',
  chapter_id: 'chapter14',
  formula_id: 'formula_14.3a',
  title: 'Expected Selection Intensity',
  context: 'Expected Selection Intensity 是由当前支撑公式引入的局部数学量。',
  symbol: '\\bar\\imath',
  formula_label: 'Formula 14.3a',
  formula_section: 'TRUNCATION SELECTION',
  aliases: ['Expected Selection Intensity', 'quantity_concept', '\\bar\\imath', 'Barimath', 'Selection Intensities and Differentials Under Truncation Selection'],
};

const fitnessConcept: ConceptSearchResult = {
  resultType: 'concept',
  id: 'concept:concept_appendix3_formula_a3_53_defined_w',
  concept_id: 'concept_appendix3_formula_a3_53_defined_w',
  chapter_id: 'appendix3',
  formula_id: 'formula_A3.53',
  title: 'Fitness',
  context: 'Fitness 是由当前支撑公式引入的局部数学量。',
  symbol: 'w',
  formula_label: 'Formula A3.53',
  formula_section: 'THE GIBBS SAMPLER',
  aliases: ['Fitness', 'quantity_concept', 'w'],
};

test('buildSearchQueryPlan expands common Chinese genetics concepts', () => {
  const plan = buildSearchQueryPlan('杂合度');
  assert.equal(plan.hasCjkAlias, true);
  assert.ok(plan.variants.includes('heterozygosity'));
});

test('scoreFormulaSearch ranks exact formula number above continued typing candidates', () => {
  const plan = buildSearchQueryPlan('公式 2.1');
  const exact = scoreFormulaSearch(formula21, plan);
  const continued = scoreFormulaSearch(formula210, plan);
  assert.ok(exact);
  assert.ok(continued);
  assert.equal(exact.reason, '公式编号精确匹配');
  assert.equal(continued.reason, '继续输入候选');
  assert.ok(exact.score > continued.score);
});

test('buildSearchQueryPlan normalizes comma decimal formula numbers', () => {
  const plan = buildSearchQueryPlan('2,1');
  const exact = scoreFormulaSearch(formula21, plan);
  assert.equal(plan.formulaNumber, '2.1');
  assert.ok(exact);
  assert.equal(exact.reason, '公式编号精确匹配');
});

test('scoreFormulaSearch allows broad formula prefix browsing', () => {
  const plan = buildSearchQueryPlan('2.');
  const first = scoreFormulaSearch(formula21, plan);
  const second = scoreFormulaSearch(formulas[1], plan);
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.reason, '公式编号匹配');
});

test('scoreChapterSearch treats chapter queries as chapter navigation', () => {
  const plan = buildSearchQueryPlan('chapter2');
  const match = scoreChapterSearch(chapter2, plan);
  assert.equal(plan.formulaNumber, undefined);
  assert.ok(match);
  assert.equal(match.reason, '章节编号精确匹配');
  assert.equal(scoreChapterSearch(chapter20, plan), null);
});

test('explicit chapter intent does not fall through to formula or concept results', () => {
  const missingChapterPlan = buildSearchQueryPlan('chapter 1');
  assert.equal(missingChapterPlan.formulaNumber, undefined);
  assert.equal(scoreFormulaSearch(formula21, missingChapterPlan), null);
  assert.equal(scoreConceptSearch(heterozygosityConcept, missingChapterPlan), null);
  assert.equal(scoreChapterSearch(chapter2, missingChapterPlan), null);

  const chinesePlan = buildSearchQueryPlan('第2章');
  assert.equal(chinesePlan.formulaNumber, undefined);
  const match = scoreChapterSearch(chapter2, chinesePlan);
  assert.ok(match);
  assert.equal(scoreFormulaSearch(formula21, chinesePlan), null);
});

test('scoreConceptSearch maps Chinese concept queries into concept results', () => {
  const plan = buildSearchQueryPlan('杂合度');
  const match = scoreConceptSearch(heterozygosityConcept, plan);
  assert.ok(match);
  assert.ok(match.score >= 720);
});

test('scoreConceptSearch keeps effective population size above generic population size', () => {
  const plan = buildSearchQueryPlan('有效群体大小');
  const effective = scoreConceptSearch(effectivePopulationSizeConcept, plan);
  const generic = scoreConceptSearch(genericPopulationSizeConcept, plan);
  assert.ok(effective);
  assert.equal(generic, null);
  assert.ok(!plan.variants.includes('population size'));
});

test('scoreConceptSearch treats LD as a token instead of an arbitrary substring', () => {
  const plan = buildSearchQueryPlan('连锁不平衡');
  const linkage = scoreConceptSearch(linkageDisequilibriumConcept, plan);
  const detailedBalance = scoreConceptSearch(detailedBalanceConcept, plan);
  assert.ok(linkage);
  assert.equal(detailedBalance, null);
  assert.ok(linkage.score >= 800);
});

test('scoreConceptSearch prefers selection intensity over broad selection or fitness', () => {
  const plan = buildSearchQueryPlan('选择强度');
  const intensity = scoreConceptSearch(selectionIntensityConcept, plan);
  const fitness = scoreConceptSearch(fitnessConcept, plan);
  assert.ok(intensity);
  assert.equal(fitness, null);
  assert.ok(!plan.variants.includes('fitness'));
});

test('scoreFormulaSearch maps Chinese query to English index terms', () => {
  const plan = buildSearchQueryPlan('选择强度');
  const match = scoreFormulaSearch(formulaKappa, plan);
  assert.ok(match);
  assert.equal(match.reason, '中文主题映射');
});

test('scoreFormulaSearch searches readable LaTeX command names', () => {
  const plan = buildSearchQueryPlan('kappa');
  const match = scoreFormulaSearch(formulaKappa, plan);
  assert.ok(match);
  assert.equal(match.reason, '公式表达式匹配');
});

test('rankSearchResults keeps stronger matches before weaker matches', () => {
  const ranked = rankSearchResults([
    { ...formulas[1], resultType: 'formula', searchScore: 500 },
    { ...formulas[0], resultType: 'formula', searchScore: 1000 },
  ]);
  assert.equal(ranked[0].id, 'formula_2.1');
});
