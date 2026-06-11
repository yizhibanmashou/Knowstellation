import type { SearchFormula } from '../../shared/types/formula';
import type { ChapterSearchResult, ConceptSearchResult, FormulaSearchResult, SearchResult } from '../../shared/types/search';

interface QueryAliasRule {
  pattern: RegExp;
  aliases: string[];
  skipIf?: RegExp;
}

const CJK_QUERY_ALIASES: QueryAliasRule[] = [
  { pattern: /群体遗传|群体遗传学/, aliases: ['population genetics'] },
  { pattern: /有效群体|有效种群|有效大小/, aliases: ['effective population size', 'genetic effective size', 'effective size'] },
  { pattern: /群体大小|种群大小/, aliases: ['population size'], skipIf: /有效群体|有效种群|有效大小/ },
  { pattern: /中性演化|中性进化|中性/, aliases: ['neutral evolution', 'neutrality', 'neutral'] },
  { pattern: /遗传漂变|漂变/, aliases: ['genetic drift', 'drift'] },
  { pattern: /选择强度/, aliases: ['selection intensity', 'intensity'] },
  { pattern: /自然选择|选择/, aliases: ['selection', 'selective', "Price's theorem", 'fitness'], skipIf: /选择强度|截断选择|稳定选择/ },
  { pattern: /截断选择/, aliases: ['truncation selection', 'selection intensity'] },
  { pattern: /稳定选择/, aliases: ['stabilizing selection', 'normalizing selection'] },
  { pattern: /适合度|适应度/, aliases: ['fitness', 'mean fitness'] },
  { pattern: /突变/, aliases: ['mutation'] },
  { pattern: /重组/, aliases: ['recombination'] },
  { pattern: /迁移|基因流/, aliases: ['migration', 'gene flow'] },
  { pattern: /连锁不平衡/, aliases: ['linkage disequilibrium', 'LD'] },
  { pattern: /连锁/, aliases: ['linkage'], skipIf: /连锁不平衡/ },
  { pattern: /近交系数/, aliases: ['inbreeding coefficient'] },
  { pattern: /近交/, aliases: ['inbreeding'] },
  { pattern: /杂合度|杂合性/, aliases: ['heterozygosity', 'heterozygote'] },
  { pattern: /等位基因/, aliases: ['allele', 'allelic'] },
  { pattern: /固定概率|固定/, aliases: ['fixation', 'probability of fixation', 'fixed'] },
  { pattern: /丢失|损失/, aliases: ['loss', 'lost'] },
  { pattern: /频率/, aliases: ['frequency', 'allele frequency'] },
  { pattern: /方差/, aliases: ['variance'] },
  { pattern: /协方差/, aliases: ['covariance'] },
  { pattern: /遗传力|遗传率/, aliases: ['heritability'] },
  { pattern: /育种|育种家/, aliases: ['breeder', "breeder's equation"] },
  { pattern: /数量遗传/, aliases: ['quantitative genetics', 'quantitative trait'] },
  { pattern: /表型/, aliases: ['phenotype', 'phenotypic'] },
  { pattern: /基因型/, aliases: ['genotype', 'genotypic'] },
  { pattern: /共祖|溯祖/, aliases: ['coalescent', 'coalescence'] },
  { pattern: /扩散/, aliases: ['diffusion'] },
  { pattern: /单倍型/, aliases: ['haplotype'] },
  { pattern: /贝叶斯/, aliases: ['Bayesian', 'Bayes'] },
  { pattern: /矩阵/, aliases: ['matrix'] },
  { pattern: /特征值/, aliases: ['eigenvalue'] },
  { pattern: /微分|导数/, aliases: ['differential', 'derivative'] },
  { pattern: /积分/, aliases: ['integral', 'integration'] },
];

const EXACT_QUERY_ALIASES: QueryAliasRule[] = [
  { pattern: /^ld$/i, aliases: ['linkage disequilibrium'] },
  { pattern: /^ne$/i, aliases: ['effective population size', 'genetic effective size', 'N Sub E'] },
];

const LATEX_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\sigma\b/g, ' sigma '],
  [/\\Delta\b/g, ' delta '],
  [/\\mu\b/g, ' mu '],
  [/\\pi\b/g, ' pi '],
  [/\\beta\b/g, ' beta '],
  [/\\alpha\b/g, ' alpha '],
  [/\\theta\b/g, ' theta '],
  [/\\rho\b/g, ' rho '],
  [/\\varphi\b/g, ' phi '],
  [/\\phi\b/g, ' phi '],
  [/\\kappa\b/g, ' kappa '],
  [/\\omega\b/g, ' omega '],
  [/\\Omega\b/g, ' omega '],
  [/\\lambda\b/g, ' lambda '],
  [/\\gamma\b/g, ' gamma '],
  [/\\bar\s*\{([^{}]+)\}/g, '$1 bar '],
  [/\\overline\s*\{([^{}]+)\}/g, '$1 bar '],
  [/\\widehat\s*\{([^{}]+)\}/g, '$1 hat '],
  [/\\widetilde\s*\{([^{}]+)\}/g, '$1 tilde '],
  [/\\hat\s*\{([^{}]+)\}/g, '$1 hat '],
  [/\\tilde\s*\{([^{}]+)\}/g, '$1 tilde '],
  [/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1 over $2 $1/$2 '],
  [/\\(?:mathbf|mathrm|mathit|operatorname)\s*\{([^{}]+)\}/g, '$1'],
  [/\\(?:left|right|quad|qquad|cdot|times|sum|prod|int|exp|ln|log)\b/g, ' '],
];

export interface SearchQueryPlan {
  raw: string;
  normalized: string;
  formulaNumber?: string;
  variants: string[];
  compactVariants: string[];
  looseVariants: string[];
  hasCjkAlias: boolean;
}

export interface FormulaSearchDocument extends SearchFormula {
  searchAliases: string[];
  searchText: string;
  searchCompact: string;
  searchLoose: string;
}

export interface ConceptSearchDocument extends ConceptSearchResult {
  searchText: string;
  searchCompact: string;
  searchLoose: string;
}

interface SearchScore {
  score: number;
  reason: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, '.')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

export function looseSearchText(value: string): string {
  let next = normalizeSearchText(value);
  LATEX_WORD_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  return next.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function addVariant(variants: Set<string>, value?: string | null) {
  const normalized = normalizeSearchText(value || '');
  if (normalized) variants.add(normalized);
}

function addChapterNumberVariants(variants: Set<string>, query: string) {
  const chapterMatch =
    query.match(/^(?:chapter|chap|ch|c)\s*([a-z]?\d+)$/i) ||
    query.match(/^第\s*([a-z]?\d+)\s*章$/i) ||
    query.match(/^([a-z]?\d+)\s*章$/i) ||
    query.match(/^([a-z]?\d+)$/i);
  if (!chapterMatch?.[1]) return;
  const raw = chapterMatch[1].toLowerCase();
  addVariant(variants, raw);
  addVariant(variants, `chapter ${raw}`);
  addVariant(variants, `chapter${raw}`);
  addVariant(variants, `chap ${raw}`);
  addVariant(variants, `ch ${raw}`);
  addVariant(variants, `c${raw}`);
  addVariant(variants, `第${raw}章`);
}

function addFormulaNumberVariants(variants: Set<string>, query: string) {
  const formulaMatch = query.match(/(?:^|[\s(（]|公式\s*|formula\s*|式\s*)([a-z]?\d+(?:\.(?:\d+[a-z]?)?)?)/i);
  if (!formulaMatch?.[1]) return;
  const raw = formulaMatch[1].toLowerCase();
  addVariant(variants, raw);
  addVariant(variants, `formula ${raw}`);
  addVariant(variants, `formula${raw}`);
  addVariant(variants, `公式 ${raw}`);
  addVariant(variants, `公式${raw}`);
}

function formulaNumberFromQuery(query: string): string | undefined {
  return query.match(/(?:^|[\s(（]|公式\s*|formula\s*|式\s*)([a-z]?\d+(?:\.(?:\d+[a-z]?)?)?)/i)?.[1]?.toLowerCase();
}

export function buildSearchQueryPlan(query: string): SearchQueryPlan {
  const raw = query.trim();
  const normalized = normalizeSearchText(raw);
  const formulaNumber = formulaNumberFromQuery(normalized);
  const variants = new Set<string>();
  let hasCjkAlias = false;

  addVariant(variants, raw);
  addFormulaNumberVariants(variants, normalized);
  addChapterNumberVariants(variants, normalized);

  CJK_QUERY_ALIASES.forEach(({ pattern, aliases, skipIf }) => {
    if (skipIf?.test(normalized)) return;
    if (!pattern.test(normalized)) return;
    hasCjkAlias = true;
    aliases.forEach((alias) => addVariant(variants, alias));
  });
  EXACT_QUERY_ALIASES.forEach(({ pattern, aliases }) => {
    if (!pattern.test(normalized)) return;
    aliases.forEach((alias) => addVariant(variants, alias));
  });

  const compactVariants = [...variants].map(compactSearchText).filter(Boolean);
  const looseVariants = [...variants].map(looseSearchText).filter(Boolean);

  return {
    raw,
    normalized,
    formulaNumber,
    variants: [...variants],
    compactVariants: [...new Set(compactVariants)],
    looseVariants: [...new Set(looseVariants)],
    hasCjkAlias,
  };
}

function formulaNumberAliases(item: SearchFormula): string[] {
  return [item.id, item.number, item.label, `formula ${item.number}`, `formula${item.number}`, `公式 ${item.number}`, `公式${item.number}`];
}

function broadFormulaPrefix(value: string): boolean {
  return /^[a-z]?\d+\.?$/i.test(value);
}

function formulaNumberStartsWith(itemNumber: string, queryNumber: string): boolean {
  if (!queryNumber) return false;
  if (/^[a-z]?\d+$/i.test(queryNumber)) {
    return itemNumber === queryNumber || itemNumber.startsWith(`${queryNumber}.`);
  }
  return itemNumber.startsWith(queryNumber);
}

function hasExplicitChapterIntent(plan: SearchQueryPlan): boolean {
  return (
    /\b(?:chapter|chap|ch)\s*[a-z]?\d+\b/i.test(plan.normalized) ||
    /(?:第\s*[a-z]?\d+\s*章|^[a-z]?\d+\s*章$)/i.test(plan.normalized)
  );
}

function hasExplicitAppendixIntent(plan: SearchQueryPlan): boolean {
  return (
    /\b(?:appendix|app)\s*[a-z]?\d+\b/i.test(plan.normalized) ||
    /(?:附录\s*[a-z]?\d+|^[a-z]?\d+\s*附录$)/i.test(plan.normalized)
  );
}

function chapterIntentNumber(plan: SearchQueryPlan): string | null {
  return (
    plan.normalized.match(/\b(?:chapter|chap|ch)\s*([a-z]?\d+)\b/i)?.[1] ||
    plan.normalized.match(/^第\s*([a-z]?\d+)\s*章$/i)?.[1] ||
    plan.normalized.match(/^([a-z]?\d+)\s*章$/i)?.[1] ||
    null
  )?.toLowerCase() || null;
}

function appendixIntentNumber(plan: SearchQueryPlan): string | null {
  return (
    plan.normalized.match(/\b(?:appendix|app)\s*([a-z]?\d+)\b/i)?.[1] ||
    plan.normalized.match(/附录\s*([a-z]?\d+)/i)?.[1] ||
    plan.normalized.match(/^([a-z]?\d+)\s*附录$/i)?.[1] ||
    null
  )?.toLowerCase() || null;
}

export function isChapterSearchQuery(plan: SearchQueryPlan): boolean {
  return hasExplicitChapterIntent(plan) || hasExplicitAppendixIntent(plan);
}

export function isFormulaNumberBrowseQuery(plan: SearchQueryPlan): boolean {
  return Boolean(plan.formulaNumber && broadFormulaPrefix(compactSearchText(plan.formulaNumber)));
}

export function isExactFormulaNumberQuery(plan: SearchQueryPlan): boolean {
  return Boolean(plan.formulaNumber && !isFormulaNumberBrowseQuery(plan));
}

function fieldIncludes(field: string, plan: SearchQueryPlan, minLength = 2): boolean {
  const compact = compactSearchText(field);
  const loose = looseSearchText(field);
  const tokens = normalizeSearchText(`${field} ${latexWords(field)}`)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter(Boolean);
  const matchesVariant = (variant: string, candidate: string): boolean => {
    if (variant.length < minLength) return false;
    if (/^[a-z0-9]{1,2}$/i.test(variant)) {
      return compact === variant || loose === variant || tokens.includes(variant);
    }
    return candidate.includes(variant);
  };
  return (
    plan.compactVariants.some((variant) => matchesVariant(variant, compact)) ||
    plan.looseVariants.some((variant) => matchesVariant(variant, loose))
  );
}

function fieldStartsWith(field: string, plan: SearchQueryPlan): boolean {
  const compact = compactSearchText(field);
  return plan.compactVariants.some((variant) => variant && compact.startsWith(variant));
}

function fieldEquals(field: string, plan: SearchQueryPlan): boolean {
  const compact = compactSearchText(field);
  return plan.compactVariants.some((variant) => variant && compact === variant);
}

function bestScore(current: SearchScore | null, next: SearchScore): SearchScore {
  if (!current || next.score > current.score) return next;
  return current;
}

function planHasVariant(plan: SearchQueryPlan, values: string[]): boolean {
  const targets = values.map(compactSearchText);
  return plan.compactVariants.some((variant) => targets.includes(variant));
}

function conceptTextIncludes(item: ConceptSearchResult, values: string[]): boolean {
  const text = [item.title, item.context, item.symbol, item.formula_label, item.formula_section, ...(item.aliases || [])].filter(Boolean).join(' ');
  const compact = compactSearchText(text);
  const loose = looseSearchText(text);
  return values.some((value) => {
    const compactValue = compactSearchText(value);
    const looseValue = looseSearchText(value);
    return compact.includes(compactValue) || loose.includes(looseValue);
  });
}

function isBroadContextAlias(alias: string, item: ConceptSearchResult): boolean {
  const normalized = normalizeSearchText(alias);
  if (!normalized) return true;
  if (/^[a-z_]+_concept$/i.test(normalized)) return true;
  if (compactSearchText(alias) === compactSearchText(item.formula_section || '')) return true;
  const tokens = normalized.split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(Boolean);
  const isAllCapsPhrase = alias === alias.toUpperCase() && tokens.length >= 2;
  return tokens.length >= 5 || isAllCapsPhrase;
}

function primaryConceptAliases(item: ConceptSearchResult): string[] {
  return (item.aliases || []).filter((alias) => !isBroadContextAlias(alias, item));
}

function broadConceptAliases(item: ConceptSearchResult): string[] {
  return (item.aliases || []).filter((alias) => isBroadContextAlias(alias, item));
}

function primaryConceptTextIncludes(item: ConceptSearchResult, values: string[]): boolean {
  const text = [item.title, item.context, item.symbol, ...primaryConceptAliases(item)].filter(Boolean).join(' ');
  const compact = compactSearchText(text);
  const loose = looseSearchText(text);
  return values.some((value) => {
    const compactValue = compactSearchText(value);
    const looseValue = looseSearchText(value);
    return compact.includes(compactValue) || loose.includes(looseValue);
  });
}

function isFormulaStatementConcept(item: ConceptSearchResult): boolean {
  return item.concept_id.endsWith('_statement') || /^formula\s+\S+\s+result$/i.test(item.title);
}

function conceptScore(item: ConceptSearchResult, score: SearchScore): SearchScore {
  const penalty = isFormulaStatementConcept(item) ? 80 : 0;
  return { ...score, score: Math.max(0, score.score - penalty) };
}

function hasEffectivePopulationSizeIntent(plan: SearchQueryPlan): boolean {
  return planHasVariant(plan, ['effective population size', 'genetic effective size', 'effective size']);
}

function looksLikeEffectivePopulationSize(item: ConceptSearchResult): boolean {
  const title = compactSearchText(item.title);
  const evidence = compactSearchText([item.symbol, item.formula_section, ...(item.aliases || [])].filter(Boolean).join(' '));
  return title.includes('populationsize') && (evidence.includes('n_{e}') || evidence.includes('nsube') || evidence.includes('effectivesize'));
}

function effectivePopulationSizeScore(item: ConceptSearchResult): number {
  const evidence = compactSearchText([item.formula_section, ...(item.aliases || [])].filter(Boolean).join(' '));
  return evidence.includes('geneticeffectivesize') || evidence.includes('effectivesize') ? 865 : 840;
}

function hasSelectionIntensityIntent(plan: SearchQueryPlan): boolean {
  return planHasVariant(plan, ['selection intensity', 'intensity']);
}

function looksLikeSelectionIntensity(item: ConceptSearchResult): boolean {
  return primaryConceptTextIncludes(item, ['selection intensity', 'strength of selection']);
}

function hasLinkageDisequilibriumIntent(plan: SearchQueryPlan): boolean {
  return planHasVariant(plan, ['linkage disequilibrium']);
}

function looksLikeLinkageDisequilibrium(item: ConceptSearchResult): boolean {
  const directConcept = primaryConceptTextIncludes(item, ['linkage disequilibrium']);
  const hasExactLinkageAlias = broadConceptAliases(item).some((alias) => compactSearchText(alias) === 'linkagedisequilibrium');
  const compactSymbol = compactSearchText(item.symbol);
  const directSymbol =
    hasExactLinkageAlias &&
    !/\\delta/i.test(item.symbol) &&
    (/^d(?:$|[_^{])/.test(compactSymbol) || /\(d\)/.test(compactSymbol));
  return directConcept || directSymbol;
}

export function buildFormulaSearchDocument(item: SearchFormula): FormulaSearchDocument {
  const searchAliases = [
    ...formulaNumberAliases(item),
    item.section,
    item.latex_preview,
    latexWords(item.latex_preview),
    item.context,
    ...item.keywords,
  ].filter(Boolean);
  const searchText = searchAliases.join(' ');
  return {
    ...item,
    searchAliases,
    searchText,
    searchCompact: compactSearchText(searchText),
    searchLoose: looseSearchText(searchText),
  };
}

export function buildConceptSearchDocument(item: ConceptSearchResult): ConceptSearchDocument {
  const searchText = [
    item.title,
    item.context,
    item.symbol,
    item.formula_label,
    item.formula_section,
    ...(item.aliases || []),
  ].filter(Boolean).join(' ');
  return {
    ...item,
    searchText,
    searchCompact: compactSearchText(searchText),
    searchLoose: looseSearchText(searchText),
  };
}

function latexWords(value: string): string {
  let next = value;
  LATEX_WORD_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  return next;
}

export function scoreFormulaSearch(item: SearchFormula, plan: SearchQueryPlan): SearchScore | null {
  if (!plan.normalized) return null;
  let score: SearchScore | null = null;

  const itemNumber = compactSearchText(item.number);
  const queryNumber = compactSearchText(plan.formulaNumber || '');
  if (queryNumber && itemNumber === queryNumber) {
    score = bestScore(score, { score: 1000, reason: '公式编号精确匹配' });
  } else if (queryNumber && formulaNumberStartsWith(itemNumber, queryNumber)) {
    score = bestScore(score, {
      score: broadFormulaPrefix(queryNumber) ? 920 : 830,
      reason: broadFormulaPrefix(queryNumber) ? '公式编号匹配' : '继续输入候选',
    });
  } else if (!queryNumber && formulaNumberAliases(item).some((alias) => fieldEquals(alias, plan))) {
    score = bestScore(score, { score: 900, reason: '公式编号匹配' });
  }

  if (fieldIncludes(item.label, plan, 2)) {
    score = bestScore(score, { score: 780, reason: '公式标题匹配' });
  }
  if (fieldIncludes(`${item.latex_preview} ${latexWords(item.latex_preview)}`, plan, 2)) {
    score = bestScore(score, { score: 730, reason: '公式表达式匹配' });
  }
  if (fieldIncludes(item.keywords.join(' '), plan, 2)) {
    score = bestScore(score, { score: 640, reason: plan.hasCjkAlias ? '中文主题映射' : '关键词匹配' });
  }
  if (fieldIncludes(item.section, plan, 2)) {
    score = bestScore(score, { score: 590, reason: plan.hasCjkAlias ? '中文主题映射' : '章节主题匹配' });
  }
  if (fieldIncludes(item.context, plan, 3)) {
    score = bestScore(score, { score: 500, reason: plan.hasCjkAlias ? '中文主题映射' : '教材上下文匹配' });
  }

  return score;
}

export function toFormulaSearchResult(item: SearchFormula, match: SearchScore): FormulaSearchResult {
  return {
    ...item,
    resultType: 'formula',
    matchReason: match.reason,
    searchScore: match.score,
  };
}

export function scoreConceptSearch(item: ConceptSearchResult, plan: SearchQueryPlan): SearchScore | null {
  if (!plan.normalized || plan.formulaNumber) return null;
  let score: SearchScore | null = null;

  const primaryAliases = primaryConceptAliases(item);
  const broadAliases = broadConceptAliases(item);

  if (hasEffectivePopulationSizeIntent(plan) && looksLikeEffectivePopulationSize(item)) {
    score = bestScore(score, conceptScore(item, { score: effectivePopulationSizeScore(item), reason: plan.hasCjkAlias ? '中文概念映射' : '概念名称匹配' }));
  }
  if (hasSelectionIntensityIntent(plan) && looksLikeSelectionIntensity(item)) {
    score = bestScore(score, conceptScore(item, { score: 840, reason: plan.hasCjkAlias ? '中文概念映射' : '概念名称匹配' }));
  }
  if (hasLinkageDisequilibriumIntent(plan) && looksLikeLinkageDisequilibrium(item)) {
    score = bestScore(score, conceptScore(item, { score: 840, reason: plan.hasCjkAlias ? '中文概念映射' : '概念名称匹配' }));
  }

  if (fieldEquals(item.title, plan)) {
    score = bestScore(score, conceptScore(item, { score: 880, reason: plan.hasCjkAlias ? '中文概念映射' : '概念名称精确匹配' }));
  } else if (fieldStartsWith(item.title, plan)) {
    score = bestScore(score, conceptScore(item, { score: 820, reason: plan.hasCjkAlias ? '中文概念映射' : '概念名称匹配' }));
  } else if (fieldIncludes(item.title, plan, 2)) {
    score = bestScore(score, conceptScore(item, { score: 760, reason: plan.hasCjkAlias ? '中文概念映射' : '概念名称匹配' }));
  }
  if (primaryAliases.some((alias) => fieldEquals(alias, plan))) {
    score = bestScore(score, conceptScore(item, { score: 850, reason: plan.hasCjkAlias ? '中文概念映射' : '概念别名精确匹配' }));
  } else if (primaryAliases.some((alias) => fieldStartsWith(alias, plan))) {
    score = bestScore(score, conceptScore(item, { score: 800, reason: plan.hasCjkAlias ? '中文概念映射' : '概念别名匹配' }));
  } else if (primaryAliases.some((alias) => fieldIncludes(alias, plan, 2))) {
    score = bestScore(score, conceptScore(item, { score: 740, reason: plan.hasCjkAlias ? '中文概念映射' : '概念别名匹配' }));
  }
  if (fieldIncludes(`${item.symbol} ${item.formula_label}`, plan, 2)) {
    score = bestScore(score, conceptScore(item, { score: 690, reason: '概念符号匹配' }));
  }
  if (fieldIncludes(item.context, plan, 3)) {
    score = bestScore(score, conceptScore(item, { score: 610, reason: plan.hasCjkAlias ? '中文概念映射' : '概念解读匹配' }));
  }
  if (fieldIncludes(item.formula_section || '', plan, 2)) {
    score = bestScore(score, conceptScore(item, { score: plan.hasCjkAlias ? 680 : 540, reason: plan.hasCjkAlias ? '中文概念映射' : '章节主题匹配' }));
  }
  if (broadAliases.some((alias) => fieldIncludes(alias, plan, 2))) {
    score = bestScore(score, conceptScore(item, { score: plan.hasCjkAlias ? 660 : 520, reason: plan.hasCjkAlias ? '中文概念映射' : '章节主题匹配' }));
  }

  return score;
}

export function toConceptSearchResult(item: ConceptSearchResult, match: SearchScore): ConceptSearchResult {
  return {
    ...item,
    matchReason: match.reason,
    searchScore: match.score,
  };
}

export function scoreChapterSearch(chapter: ChapterSearchResult, plan: SearchQueryPlan): SearchScore | null {
  if (!plan.normalized) return null;
  if (plan.formulaNumber) return null;
  const chapterNumber = String(chapter.chapter_id.match(/\d+$/)?.[0] || chapter.chapter);
  const isAppendix = /^appendix/i.test(chapter.chapter_id);
  const explicitChapterNumber = chapterIntentNumber(plan);
  const explicitAppendixNumber = appendixIntentNumber(plan);
  if (!isAppendix && explicitChapterNumber && explicitChapterNumber !== chapterNumber) return null;
  if (isAppendix && explicitAppendixNumber && explicitAppendixNumber !== chapterNumber) return null;
  if (!isAppendix && explicitAppendixNumber) return null;
  if (isAppendix && explicitChapterNumber) return null;
  const chapterAliases = [
    chapter.chapter_id,
    chapter.label,
    chapter.title,
    chapter.context,
    ...(isAppendix
      ? [`appendix ${chapterNumber}`, `appendix${chapterNumber}`, `app ${chapterNumber}`, `附录${chapterNumber}`]
      : [`chapter ${chapterNumber}`, `chapter${chapterNumber}`, `chap ${chapterNumber}`, `ch ${chapterNumber}`, `c${chapterNumber}`, `第${chapterNumber}章`]),
  ].join(' ');

  if (!isAppendix && hasExplicitChapterIntent(plan) && (fieldEquals(chapter.chapter_id, plan) || fieldEquals(`chapter${chapterNumber}`, plan) || fieldEquals(`第${chapterNumber}章`, plan))) {
    return { score: 960, reason: '章节编号精确匹配' };
  }
  if (isAppendix && hasExplicitAppendixIntent(plan) && (fieldEquals(chapter.chapter_id, plan) || fieldEquals(`appendix${chapterNumber}`, plan) || fieldEquals(`附录${chapterNumber}`, plan))) {
    return { score: 960, reason: '章节编号精确匹配' };
  }
  if (fieldIncludes(chapterAliases, plan, 2)) {
    return { score: 820, reason: plan.hasCjkAlias ? '中文主题映射' : '章节匹配' };
  }
  return null;
}

function formulaSortValue(result: SearchResult): string {
  if (result.resultType === 'chapter') return `${String(result.chapter).padStart(3, '0')}.000`;
  if (result.resultType === 'concept') return `${result.chapter_id}.${result.formula_label}.${result.title}`;
  return result.number.replace(/^a/i, '999.');
}

export function rankSearchResults<T extends SearchResult>(results: T[]): T[] {
  return [...results].sort((left, right) => {
    const scoreDelta = (right.searchScore || 0) - (left.searchScore || 0);
    if (scoreDelta) return scoreDelta;
    return formulaSortValue(left).localeCompare(formulaSortValue(right), undefined, { numeric: true, sensitivity: 'base' });
  });
}
