import type { ChapterLearningEntry, ChapterNavigatorPayload } from '../../shared/types/learning';
import type { FeaturedFormula, SearchFormula } from '../../shared/types/formula';
import type { ConceptNavigationEntry, ConceptSearchResult } from '../../shared/types/search';
import { compactChapterId, displayChapterId, rawFormulaNumber } from '../../shared/utils/constants.ts';
import { formatChapterDescription, formatChapterLabel, formatChapterTitle, formatChapterTopic, formatConceptTitle, formatFormulaReferenceLabel, formatSectionLabel } from '../../shared/utils/uiCopy.ts';

export type StarNodeKind = 'chapter' | 'formula' | 'concept';

export interface StarNode {
  id: string;
  kind: StarNodeKind;
  label: string;
  displayLabel?: string;
  fullLabel?: string;
  title: string;
  subtitle: string;
  chapterId?: string;
  chapterRank?: number;
  formulaCount?: number;
  formulaId?: string;
  formulaLabel?: string;
  conceptId?: string;
  relatedConceptIds?: string[];
  conceptType?: string;
  symbol?: string;
  conceptContext?: string;
  occurrenceCount?: number;
  relatedFormulaLabels?: string[];
  latex?: string;
  context?: string;
  section?: string;
  isBackbone?: boolean;
  importance: number;
}

export function flattenChapters(payload: ChapterNavigatorPayload): ChapterLearningEntry[] {
  return payload.groups.flatMap((group) => group.chapters);
}

export function buildChapterStarNodes(payload: ChapterNavigatorPayload): StarNode[] {
  return flattenChapters(payload).map((chapter) => ({
    id: chapter.chapter_id,
    kind: 'chapter',
    label: formatChapterLabel(chapter.chapter_id, chapter.chapter),
    displayLabel: compactChapterId(chapter.chapter_id, chapter.chapter),
    fullLabel: formatChapterLabel(chapter.chapter_id, chapter.chapter),
    title: formatChapterTitle({
      chapterId: chapter.chapter_id,
      chapter: chapter.chapter,
      titleEn: chapter.title_en,
      titleZh: chapter.title_zh,
    }),
    subtitle: formatChapterDescription({
      chapterId: chapter.chapter_id,
      chapter: chapter.chapter,
      descriptionEn: chapter.description_en,
      descriptionZh: chapter.description_zh,
      formulaCount: chapter.full_formula_ids.length,
      sectionHint: chapter.section_hint,
    }),
    chapterId: chapter.chapter_id,
    chapterRank: chapter.chapter,
    formulaCount: chapter.full_formula_ids.length,
    importance: Math.max(1, chapter.full_formula_ids.length / 30),
  }));
}

export function buildFormulaStarNodes(input: {
  chapter: ChapterLearningEntry;
  searchIndex: SearchFormula[];
  featured: FeaturedFormula[];
}): StarNode[] {
  const formulaIds = new Set(input.chapter.full_formula_ids);
  const backboneIds = new Set(input.chapter.backbone_formula_ids);
  const featuredLookup = new Map(input.featured.map((item) => [item.id, item]));
  return input.searchIndex
    .filter((formula) => formulaIds.has(formula.id))
    .map((formula) => {
      const featured = featuredLookup.get(formula.id);
      const isBackbone = backboneIds.has(formula.id);
      return {
        id: formula.id,
        kind: 'formula' as const,
        label: rawFormulaNumber(formula.id),
        displayLabel: rawFormulaNumber(formula.id),
        fullLabel: formula.label,
        title: formula.label,
        subtitle: formatSectionLabel(formula.section) || formatChapterTopic(input.chapter.section_hint),
        chapterId: input.chapter.chapter_id,
        chapterRank: input.chapter.chapter,
        formulaId: formula.id,
        latex: formula.latex_preview,
        context: formula.context,
        section: formula.section,
        isBackbone,
        importance: isBackbone ? 3.2 : featured?.importance || 1,
      };
    });
}

function normalizeConceptText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim();
}

const SYMBOL_FRAGMENT_CONCEPT_RE = /(?:\b(?:simeq|frac|left|right|mathrm)\b|simeq|frac|left|right|simmathrm|simleft)/i;
const RAW_SYMBOL_CONCEPT_RE = /^(?:[A-Za-z]|[A-Za-z]_[A-Za-z0-9]+|[A-Za-z]\s+Sub\s+[A-Za-z0-9]+|[A-Za-z]\s+Power\s+[A-Za-z0-9]+)$/i;
const GENERIC_SYMBOL_CONCEPT_RE = /^(?:change|delta|alpha|beta|gamma|pi constant|time|order term|nablaw-bar|d-hat)$/i;

function isSymbolOnlyConcept(concept: ConceptSearchResult): boolean {
  const title = normalizeConceptText(concept.title);
  const symbol = normalizeConceptText(concept.symbol);
  const compactSymbol = symbol.replace(/\s+/g, '');
  if (!title) return false;
  if (/^updated\s+/i.test(title)) return true;
  if (RAW_SYMBOL_CONCEPT_RE.test(title)) return true;
  if (SYMBOL_FRAGMENT_CONCEPT_RE.test(title)) return true;
  if (GENERIC_SYMBOL_CONCEPT_RE.test(title)) return true;
  if (/[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/\\(?:left|right|simeq|frac|sum|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|_[A-Za-z0-9]+)$/.test(compactSymbol) && /^(?:[A-Za-z]_|[A-Za-z]\s+Sub\b)/i.test(title)) return true;
  if (/^[A-Za-z](?:\^\{?(?:\\prime|')\}?|')/.test(compactSymbol) && /^updated\b/i.test(title)) return true;
  return false;
}

function conceptGroupKey(concept: ConceptSearchResult): string {
  if (concept.canonical_concept_id) return `canonical:${concept.canonical_concept_id}`;
  return [concept.title, concept.symbol]
    .map((value) => normalizeConceptText(value).toLowerCase())
    .join('::');
}

function conceptNavigationGroupKey(entry: ConceptNavigationEntry): string {
  if (entry.canonical_concept_id) return `canonical:${entry.canonical_concept_id}`;
  return normalizeConceptText(entry.title).toLowerCase();
}

function formulaSortValueFromId(value = ''): number {
  const match = String(value).match(/formula_([A-Za-z]?)(\d+)\.(\d+)([a-z]?)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const appendixOffset = match[1] ? 10_000 : 0;
  return appendixOffset + Number(match[2]) * 1000 + Number(match[3]) + (match[4] ? match[4].charCodeAt(0) / 1000 : 0);
}

function compareConceptNavigationEntries(left: ConceptNavigationEntry, right: ConceptNavigationEntry): number {
  return left.depth - right.depth
    || left.order - right.order
    || formulaSortValueFromId(left.formula_id) - formulaSortValueFromId(right.formula_id)
    || String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const next = normalizeConceptText(value || '');
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    result.push(next);
  }
  return result;
}

function firstNonEmpty(values: Array<string | undefined>): string {
  return uniqueStrings(values)[0] || '';
}

function conceptFromNavigationEntry(entry: ConceptNavigationEntry, chapterId: string): ConceptSearchResult {
  return {
    resultType: 'concept',
    id: `concept:${entry.concept_id}`,
    concept_id: entry.concept_id,
    canonical_concept_id: entry.canonical_concept_id,
    canonical_concept_name: entry.canonical_concept_name,
    chapter_id: chapterId,
    formula_id: entry.formula_id,
    title: entry.title,
    context: '',
    symbol: normalizeConceptText(entry.symbol || ''),
    formula_label: entry.formula_label || '',
    formula_section: entry.formula_section,
  };
}

function groupConceptNavigationEntries(entries: ConceptNavigationEntry[]): Array<{
  representative: ConceptNavigationEntry;
  members: ConceptNavigationEntry[];
}> {
  const groups = new Map<string, ConceptNavigationEntry[]>();
  for (const entry of entries.slice().sort(compareConceptNavigationEntries)) {
    const key = conceptNavigationGroupKey(entry) || entry.concept_id;
    const current = groups.get(key) || [];
    current.push(entry);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((members) => ({
      representative: members.slice().sort(compareConceptNavigationEntries)[0],
      members,
    }))
    .sort((left, right) => compareConceptNavigationEntries(left.representative, right.representative));
}

function isGenericConcept(concept: ConceptSearchResult): boolean {
  const id = concept.concept_id.toLowerCase();
  const title = concept.title.toLowerCase();
  const rawTitle = concept.title.trim();
  const symbol = concept.symbol.trim();
  const tokenCount = rawTitle.split(/\s+/).filter(Boolean).length;
  const aliases = (concept.aliases || []).join(' ');
  const noisyTitle =
    tokenCount > 4 ||
    /^(?:int|sum|frac|left|right|sup|is clearly|where|if |then )/i.test(rawTitle) ||
    /(?:simeq|frac|left|right).*(?:simeq|frac|left|right)/i.test(rawTitle) ||
    /\b(?:being considered|clearly too restrictive|relationship)\b/i.test(rawTitle);
  const noisySymbol = symbol.length > 26 || /\\int|\\sum|\\frac/.test(symbol);
  const genericAlias = /\b(?:quantity_concept|theorem_or_principle)\b/i.test(aliases) && !/(hka|mcdonald|kreitman|likelihood|probability density|fitness|adaptive|substitution|neutrality|order term)/i.test(rawTitle);
  return id.endsWith('_statement') || isSymbolOnlyConcept(concept) || /^formula\s+\S+\s+(?:relationship|result|concept)$/i.test(concept.title) || /\bformula\b.*\bconcept\b/.test(title) || noisyTitle || noisySymbol || genericAlias;
}

function isFormulaStatementConcept(concept: ConceptSearchResult): boolean {
  return concept.concept_id.toLowerCase().endsWith('_statement')
    || isSymbolOnlyConcept(concept)
    || /^formula\s+\S+\s+(?:relationship|result|concept)$/i.test(concept.title.trim())
    || concept.id.toLowerCase().includes('_statement');
}

function conceptScore(concept: ConceptSearchResult, chapter: ChapterLearningEntry): number {
  const representative = new Set(chapter.representative_formula_ids);
  const backbone = new Set(chapter.backbone_formula_ids);
  let score = 0;
  if (backbone.has(concept.formula_id)) score += 80;
  if (representative.has(concept.formula_id)) score += 55;
  if (concept.symbol) score += 18;
  if (concept.context) score += Math.min(24, concept.context.length / 18);
  if ((concept.aliases || []).length) score += 8;
  if (concept.formula_section === chapter.section_hint) score += 6;
  if (isGenericConcept(concept)) score -= 85;
  return score;
}

function conceptDisplayLabel(concept: ConceptSearchResult): string {
  const symbol = normalizeConceptText(concept.symbol);
  if (!symbol) return '概念';
  const plain = symbol
    .replace(/\\widehat\{([^{}]+)\}/g, '^$1')
    .replace(/\\overline\{([^{}]+)\}/g, '¯$1')
    .replace(/\\mathbf\{([^{}]+)\}/g, '$1')
    .replace(/\\boldsymbol\{([^{}]+)\}/g, '$1')
    .replace(/[{}]/g, '');
  return plain.length > 8 ? `${plain.slice(0, 8)}…` : plain;
}

function conceptDisplayTitle(concept: ConceptSearchResult): string {
  const compactSymbol = concept.symbol.replace(/\s+/g, '');
  const title = concept.title.trim();
  if (/likelihood/i.test(title) || /^L(?:_|\b)/.test(compactSymbol)) return '似然函数';
  if (/probability density/i.test(title) || /\\phi/.test(compactSymbol)) return '概率密度';
  if (/fitness width/i.test(title) || /\\omega/.test(compactSymbol)) return '适合度宽度';
  if (/order term/i.test(title) || /^o$/.test(compactSymbol)) return '渐近余项';
  if (/tarone[- ]greenland.*neutrality index/i.test(title) || /^NI/.test(compactSymbol)) return 'Tarone-Greenland 中性指数';
  if (/estimated adaptive replacement substitutions/i.test(title) || /\\widehat\{\\eta\}_\{?a\}?/.test(compactSymbol)) return '适应性替换数估计';
  if (/alpha/i.test(title) || /\\alpha/.test(compactSymbol)) return '适应性替代比例';
  if (/lambda/i.test(title) || /\\lambda/.test(compactSymbol)) return '适应性替代率';
  if (/mean/i.test(title) || /\\mu/.test(compactSymbol)) return '均值参数';
  if (/^\\Pr$/.test(compactSymbol) || /^Pr$/.test(compactSymbol)) return '事件概率';
  if (/hka/i.test(concept.formula_section || '') || /^X/.test(compactSymbol)) return 'HKA 检验统计量';
  if (/^[A-Za-z0-9\\_{}^]+$/.test(title) || /\b(?:Sub|Power|Simeq|Frac)\b/.test(title)) {
    return conceptDisplayLabel(concept);
  }
  return formatConceptTitle(title, concept.symbol);
}

export function buildConceptStarNodes(input: {
  chapter: ChapterLearningEntry;
  conceptIndex: ConceptSearchResult[];
  conceptNavigation?: ConceptNavigationEntry[];
  maxConcepts?: number;
}): StarNode[] {
  const lookup = new Map(
    input.conceptIndex
      .filter((concept) => concept.chapter_id === input.chapter.chapter_id && !isFormulaStatementConcept(concept))
      .map((concept) => [concept.concept_id, concept]),
  );
  if (input.conceptNavigation?.length) {
    const navigableEntries = input.conceptNavigation
      .filter((entry) => !isFormulaStatementConcept(conceptFromNavigationEntry(entry, input.chapter.chapter_id)));
    return groupConceptNavigationEntries(navigableEntries)
      .slice(0, input.maxConcepts ?? Number.POSITIVE_INFINITY)
      .map(({ representative: entry, members }) => {
        const concept = lookup.get(entry.concept_id);
        const fallbackConcept = conceptFromNavigationEntry(entry, input.chapter.chapter_id);
        const title = concept
          ? conceptDisplayTitle(concept)
          : formatConceptTitle(entry.title, entry.symbol);
        const label = concept ? conceptDisplayLabel(concept) : conceptDisplayLabel(fallbackConcept);
        const relatedFormulaLabels = uniqueStrings(members.flatMap((item) => item.related_formula_labels?.length ? item.related_formula_labels : [item.formula_label]));
        return {
          id: `concept:${entry.concept_id}`,
          kind: 'concept',
          label,
          displayLabel: label,
          fullLabel: title,
          title,
          subtitle: concept?.context || (members.length > 1 ? `${members.length} related formula views` : entry.formula_label) || 'Concept navigation',
          chapterId: concept?.chapter_id || input.chapter.chapter_id,
          chapterRank: input.chapter.chapter,
          formulaId: concept?.primaryFormulaId || entry.formula_id || concept?.formula_id,
          formulaLabel: formatFormulaReferenceLabel(entry.formula_label || concept?.formula_label),
          conceptId: entry.concept_id,
          relatedConceptIds: uniqueStrings(members.map((item) => item.concept_id)),
          conceptType: 'chapter_concept',
          symbol: firstNonEmpty([entry.symbol, concept?.symbol]),
          context: concept?.context,
          conceptContext: concept?.context,
          occurrenceCount: members.length,
          relatedFormulaLabels,
          section: entry.formula_section || concept?.formula_section,
          isBackbone: false,
          importance: Math.max(1, Math.min(2.4, 2.2 - entry.depth * 0.12)),
        };
      });
  }

  const chapterConcepts = input.conceptIndex.filter((concept) => concept.chapter_id === input.chapter.chapter_id && !isFormulaStatementConcept(concept));
  if (!chapterConcepts.length) return [];

  const groups = new Map<string, ConceptSearchResult[]>();
  chapterConcepts.forEach((concept) => {
    const key = conceptGroupKey(concept);
    const current = groups.get(key) || [];
    current.push(concept);
    groups.set(key, current);
  });

  const ranked = [...groups.values()]
    .map((items) => {
      const sorted = items.slice().sort((left, right) => conceptScore(right, input.chapter) - conceptScore(left, input.chapter));
      const best = sorted[0];
      const occurrenceBonus = Math.min(24, items.length * 3);
      return {
        concept: best,
        score: conceptScore(best, input.chapter) + occurrenceBonus,
        occurrences: items.length,
      };
    })
    .sort((left, right) => right.score - left.score);

  const nonGeneric = ranked.filter((item) => !isGenericConcept(item.concept));
  const selected = nonGeneric.slice(0, input.maxConcepts ?? Math.min(10, Math.max(5, Math.ceil(input.chapter.backbone_formula_ids.length * 0.75))));

  return selected.map(({ concept, score, occurrences }) => ({
    id: `concept:${concept.concept_id}`,
    kind: 'concept',
    label: conceptDisplayLabel(concept),
    displayLabel: conceptDisplayLabel(concept),
    fullLabel: conceptDisplayTitle(concept),
    title: conceptDisplayTitle(concept),
    subtitle: concept.context || `${concept.formula_label} 中的概念起点`,
    chapterId: concept.chapter_id,
    chapterRank: input.chapter.chapter,
    formulaId: concept.primaryFormulaId || concept.formula_id,
    formulaLabel: formatFormulaReferenceLabel(concept.formula_label),
    conceptId: concept.concept_id,
    conceptType: 'chapter_concept',
    symbol: normalizeConceptText(concept.symbol),
    context: concept.context,
    conceptContext: concept.context,
    section: concept.formula_section,
    isBackbone: false,
    importance: Math.max(1, Math.min(2.4, score / 55 + occurrences * 0.06)),
  }));
}

export function buildChapterConceptLearningNodes(input: {
  chapter: ChapterLearningEntry;
  conceptIndex: ConceptSearchResult[];
  conceptNavigation?: ConceptNavigationEntry[];
  maxConcepts?: number;
}): StarNode[] {
  return buildConceptStarNodes(input);
}
