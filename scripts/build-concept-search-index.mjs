import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REVIEW_DIR = resolve(ROOT, 'tmp/concept-review');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const DEFAULT_CONCEPT_DIRS = [
  resolve(ROOT, 'data/frontend/concept_graph'),
  resolve(ROOT, 'public/data/concept_graph'),
];

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    result.push(next);
  }
  return result;
}

function buildAliasLookup(symbolConcepts = []) {
  const lookup = new Map();
  for (const item of symbolConcepts) {
    const current = lookup.get(item.concept_id) || [];
    lookup.set(item.concept_id, [
      ...current,
      item.concept_name,
      item.concept_type,
      item.symbol,
      ...(item.aliases || []),
    ]);
  }
  return lookup;
}

async function buildCanonicalLookup(reviewDir = REVIEW_DIR) {
  const lookup = new Map();
  if (!await directoryExists(reviewDir)) return lookup;
  const files = (await readdir(reviewDir))
    .filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
  for (const file of files) {
    const payload = JSON.parse(await readFile(resolve(reviewDir, file), 'utf8'));
    for (const concept of payload.symbol_concepts || []) {
      if (!concept.concept_id || !concept.canonical_concept_id) continue;
      lookup.set(concept.concept_id, {
        canonical_concept_id: concept.canonical_concept_id,
        canonical_concept_name: concept.canonical_concept_name || concept.concept_name,
      });
    }
  }
  return lookup;
}

function formulaSortValue(value = '') {
  const match = String(value).match(/formula_([A-Za-z]?)(\d+)\.(\d+)([a-z]?)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const appendixOffset = match[1] ? 10_000 : 0;
  return appendixOffset + Number(match[2]) * 1000 + Number(match[3]) + (match[4] ? match[4].charCodeAt(0) / 1000 : 0);
}

function normalizeConceptText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slug(value = '') {
  return normalizeConceptText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'concept';
}

const SAFE_GLOBAL_CANONICAL_CONCEPT_NAMES = new Set([
  'additive genetic value',
  'additive genetic variance',
  'fitness',
  'population size',
  'selection coefficient',
  'standard deviation',
  'time',
  'trait value',
  'variance',
  'vector or matrix quantity',
]);

function canonicalForView(view = {}, canonicalLookup = new Map()) {
  const displayName = normalizeConceptText(view.name || view.title || '');
  if (SAFE_GLOBAL_CANONICAL_CONCEPT_NAMES.has(displayName.toLowerCase())) {
    return {
      canonical_concept_id: `canonical_${slug(displayName)}`,
      canonical_concept_name: displayName,
    };
  }
  if (view.canonical_concept_id) {
    return {
      canonical_concept_id: view.canonical_concept_id,
      canonical_concept_name: view.canonical_concept_name || displayName,
    };
  }
  return canonicalLookup.get(view.concept_id);
}

function baseSymbol(symbol = '') {
  let value = String(symbol || '').trim();
  value = value.replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\s+(\\?[A-Za-z])/g, '$1');
  value = value.replace(/\\overline\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\bar\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\widehat\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\hat\{([^{}]+)\}/g, '$1');
  value = value.replace(/_\{[^{}]+\}/g, '');
  value = value.replace(/\^\{[^{}]+\}/g, '');
  value = value.replace(/[{}]/g, '');
  value = value.replace(/^\\/, '');
  return normalizeConceptText(value);
}

function conceptMeaningKey(value = {}, canonicalLookup = new Map()) {
  const canonical = canonicalForView(value, canonicalLookup);
  if (canonical?.canonical_concept_id) return `canonical:${canonical.canonical_concept_id}`;
  const title = normalizeConceptText(value.name || value.title || '').toLowerCase();
  const symbol = baseSymbol(value.defined_symbol || value.symbol || value.via_symbol || '').toLowerCase();
  return `${title}:${symbol}`;
}

function isFormulaReferenceText(value = '') {
  return /^(?:equation|formula)\s+[A-Za-z]?\d+(?:\.\d+)?[a-z]?$/i.test(normalizeConceptText(value));
}

function isFormulaReferenceDependency(reference = {}) {
  return normalizeConceptText(reference.relation || '') === 'explicit_reference'
    || isFormulaReferenceText(reference.via_symbol)
    || isFormulaReferenceText(reference.derived_from_formula_edge?.via_symbol);
}

const FORMULA_ARTIFACT_NAME_RE = /^formula\s+\S+\s+(?:relationship|result|concept)$/i;
const SYMBOL_FRAGMENT_CONCEPT_NAME_RE = /(?:\b(?:simeq|frac|left|right|mathrm|simmathrm|simleft)\b)/i;
const RAW_SYMBOL_CONCEPT_NAME_RE = /^(?:[A-Za-z]|[A-Za-z]_[A-Za-z0-9]+|[A-Za-z]\s+Sub\s+[A-Za-z0-9]+|[A-Za-z]\s+Power\s+[A-Za-z0-9]+)$/i;
const GENERIC_SYMBOL_CONCEPT_NAME_RE = /^(?:change|delta|alpha|beta|gamma|pi constant|time|order term|nablaw-bar|d-hat)$/i;

function isSymbolOnlyConcept(view = {}) {
  const name = normalizeConceptText(view.name || view.title || '');
  const symbol = normalizeConceptText(view.defined_symbol || view.symbol || '');
  const compactSymbol = symbol.replace(/\s+/g, '');
  if (!name) return false;
  if (/^updated\s+/i.test(name)) return true;
  if (RAW_SYMBOL_CONCEPT_NAME_RE.test(name)) return true;
  if (SYMBOL_FRAGMENT_CONCEPT_NAME_RE.test(name)) return true;
  if (/[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/\\(?:left|right|simeq|frac|sum|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|_[A-Za-z0-9]+)$/.test(compactSymbol) && /^(?:[A-Za-z]_|[A-Za-z]\s+Sub\b)/i.test(name)) return true;
  if (/^[A-Za-z](?:\^\{?(?:\\prime|')\}?|')/.test(compactSymbol) && /^updated\b/i.test(name)) return true;
  return false;
}

function isFormulaStatementConcept(view = {}) {
  const id = String(view.concept_id || '').toLowerCase();
  const name = String(view.name || view.title || '').trim();
  const symbol = String(view.defined_symbol || view.symbol || '').trim();
  const type = String(view.concept_type || '').toLowerCase();
  return (
    id.endsWith('_statement') ||
    type === 'formula_evidence_view' ||
    type === 'formula_symbol' ||
    isSymbolOnlyConcept(view) ||
    FORMULA_ARTIFACT_NAME_RE.test(name) ||
    (/^formula\s+\S+$/i.test(symbol) && /relationship|result/i.test(name))
  );
}

function realConceptViews(payload) {
  return (payload.views || []).filter((view) => !isFormulaStatementConcept(view));
}

function groupConceptViews(views, canonicalLookup = new Map()) {
  const groups = new Map();
  for (const view of views) {
    const key = conceptMeaningKey(view, canonicalLookup) || view.concept_id;
    const current = groups.get(key) || [];
    current.push(view);
    groups.set(key, current);
  }
  return [...groups.values()].map((items) => {
    const sorted = items.slice().sort(compareViews);
    const representative = sorted[0];
    return {
      key: conceptMeaningKey(representative, canonicalLookup) || representative.concept_id,
      representative,
      members: sorted,
    };
  }).sort((left, right) => compareViews(left.representative, right.representative));
}

function compareViews(left, right) {
  return (
    Number(left.formula_position ?? Number.MAX_SAFE_INTEGER) - Number(right.formula_position ?? Number.MAX_SAFE_INTEGER) ||
    formulaSortValue(left.defined_by_formula_id) - formulaSortValue(right.defined_by_formula_id) ||
    String(left.name || '').localeCompare(String(right.name || ''), undefined, { numeric: true, sensitivity: 'base' }) ||
    String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
  );
}

function groupLookupByViewId(groups) {
  const lookup = new Map();
  for (const group of groups || []) {
    for (const member of group.members || []) {
      lookup.set(member.view_id || member.concept_id, group);
    }
  }
  return lookup;
}

function buildConceptNavigation(payload, canonicalLookup = new Map()) {
  const views = realConceptViews(payload);
  const viewKey = (view) => view.view_id || view.concept_id;
  const referenceKey = (reference) => reference.view_id || reference.concept_id;
  const byViewId = new Map(views.map((view) => [viewKey(view), view]));
  const prereqById = new Map();
  const outgoing = new Map();
  const depthById = new Map();

  for (const view of views) {
    const currentViewId = viewKey(view);
    const prereqs = unique((view.prerequisite_concepts || [])
      .filter((reference) => reference.clickable !== false && !isFormulaStatementConcept(reference) && !isFormulaReferenceDependency(reference))
      .map(referenceKey)
      .filter((conceptId) => conceptId && conceptId !== currentViewId && byViewId.has(conceptId)));
    prereqById.set(currentViewId, prereqs);
    prereqs.forEach((prereqId) => {
      const current = outgoing.get(prereqId) || [];
      current.push(currentViewId);
      outgoing.set(prereqId, current);
    });
  }

  const ready = views
    .filter((view) => !(prereqById.get(viewKey(view)) || []).length)
    .sort(compareViews);
  const remaining = new Set(views.map(viewKey));
  const ordered = [];

  while (ready.length) {
    const view = ready.shift();
    const currentViewId = view ? viewKey(view) : '';
    if (!view || !remaining.has(currentViewId)) continue;
    remaining.delete(currentViewId);
    const prereqDepths = (prereqById.get(currentViewId) || []).map((id) => depthById.get(id) ?? 0);
    depthById.set(currentViewId, prereqDepths.length ? Math.max(...prereqDepths) + 1 : 0);
    ordered.push(view);
    for (const dependentId of outgoing.get(currentViewId) || []) {
      if (!remaining.has(dependentId)) continue;
      const prereqs = prereqById.get(dependentId) || [];
      if (prereqs.every((id) => !remaining.has(id))) {
          const dependent = byViewId.get(dependentId);
          if (dependent && !ready.some((item) => viewKey(item) === dependentId)) {
            ready.push(dependent);
            ready.sort(compareViews);
        }
      }
    }
  }

  const cycleRemainder = [...remaining]
    .map((id) => byViewId.get(id))
    .filter(Boolean)
    .sort(compareViews);
  for (const view of cycleRemainder) {
    const currentViewId = viewKey(view);
    const prereqDepths = (prereqById.get(currentViewId) || [])
      .map((id) => depthById.get(id))
      .filter((value) => typeof value === 'number');
    depthById.set(currentViewId, prereqDepths.length ? Math.max(...prereqDepths) + 1 : 0);
    ordered.push(view);
  }

  const concept_navigation = ordered.map((view, index) => ({
    view_id: viewKey(view),
    concept_id: view.concept_id,
    canonical_concept_id: canonicalForView(view, canonicalLookup)?.canonical_concept_id,
    canonical_concept_name: canonicalForView(view, canonicalLookup)?.canonical_concept_name,
    formula_id: view.defined_by_formula_id,
    title: view.name,
    symbol: view.defined_symbol || '',
    formula_label: view.supporting_formula_label || '',
    formula_section: view.formula_section || '',
    prerequisite_view_ids: prereqById.get(viewKey(view)) || [],
    prerequisite_concept_ids: unique((prereqById.get(viewKey(view)) || [])
      .map((id) => byViewId.get(id)?.concept_id)
      .filter(Boolean)),
    depth: depthById.get(viewKey(view)) ?? 0,
    order: index,
    occurrence_count: 1,
    related_formula_labels: unique([view.supporting_formula_label || '']),
  }));

  return {
    chapter_id: payload.chapter_id,
    concept_root_view_ids: concept_navigation
      .filter((item) => item.prerequisite_view_ids.length === 0)
      .map((item) => item.view_id),
    concept_root_ids: concept_navigation
      .filter((item) => item.prerequisite_view_ids.length === 0)
      .map((item) => item.concept_id),
    concept_navigation,
  };
}

function buildSearchItems(payload, canonicalLookup = new Map()) {
  const aliasLookup = buildAliasLookup(payload.symbol_concepts);
  const views = realConceptViews(payload).slice().sort(compareViews);
  const groupsByViewId = groupLookupByViewId(groupConceptViews(views, canonicalLookup));
  return views.map((view) => {
    const group = groupsByViewId.get(view.view_id || view.concept_id) || { members: [view], representative: view };
    const canonical = canonicalForView(view, canonicalLookup);
    const aliases = unique([
      ...group.members.flatMap((member) => aliasLookup.get(member.concept_id) || []),
      ...group.members.map((member) => canonicalForView(member, canonicalLookup)?.canonical_concept_name),
      ...group.members.map((member) => member.name),
      view.name,
      view.concept_type,
      view.formula_subsection,
      view.source_sentence,
    ]);
    const relatedFormulaLabels = unique(group.members.flatMap((member) => [
      member.supporting_formula_label || '',
      ...(member.formula_references || []).map((reference) => reference.formula_label || ''),
    ]));
    const occurrenceCount = Math.max(
      group.members.length,
      group.members.reduce((sum, member) => sum + (member.formula_references || []).length, 0),
    );
    return {
      resultType: 'concept',
      id: `concept:${view.view_id || view.concept_id}`,
      concept_id: view.concept_id,
      view_id: view.view_id || view.concept_id,
      canonical_concept_id: canonical?.canonical_concept_id,
      canonical_concept_name: canonical?.canonical_concept_name,
      chapter_id: view.chapter_id,
      formula_id: view.defined_by_formula_id,
      title: view.name,
      context: publicConceptSearchContext(view),
      symbol: view.defined_symbol || '',
      formula_label: view.supporting_formula_label || '',
      formula_section: view.formula_section || '',
      aliases,
      occurrenceCount,
      formulaOccurrenceCount: Math.max(1, (view.formula_references || []).length || 1),
      viewOccurrenceCount: 1,
      relatedFormulaLabels,
      primaryFormulaId: view.defined_by_formula_id,
    };
  });
}

function publicConceptSearchContext(view) {
  const candidates = [
    view.definition_zh,
    view.definition,
    view.source_sentence,
    `${view.name || 'Concept'} 是由当前公式上下文确定的概念。`,
  ];
  return candidates
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .find((value) => value && !value.includes('解读尚在审核中')) || '';
}

async function directoryExists(dir) {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

async function buildConceptSearchIndex(conceptDir, canonicalLookup) {
  const files = (await readdir(conceptDir))
    .filter((file) => file.endsWith('_concept_graph.json'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
  const items = [];
  const chapters = [];
  for (const file of files) {
    const payload = JSON.parse(await readFile(resolve(conceptDir, file), 'utf8'));
    chapters.push(buildConceptNavigation(payload, canonicalLookup));
    items.push(...buildSearchItems(payload, canonicalLookup));
  }
  const index = {
    version: 2,
    generated_at: new Date().toISOString(),
    source: 'concept_graph/*.json',
    chapters,
    items,
  };
  await mkdir(conceptDir, { recursive: true });
  await writeFile(resolve(conceptDir, 'concept_search_index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`Generated ${items.length} concept search entries in ${conceptDir}`);
}

function parseArgs(args) {
  const conceptDirs = [];
  const options = { reviewDir: REVIEW_DIR, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--review-dir') options.reviewDir = resolve(ROOT, args[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else conceptDirs.push(resolve(ROOT, arg));
  }
  return {
    ...options,
    conceptDirs: conceptDirs.length ? conceptDirs : DEFAULT_CONCEPT_DIRS,
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(`Build concept search index

Usage:
  node scripts/build-concept-search-index.mjs
  node scripts/build-concept-search-index.mjs data/frontend/concept_graph --review-dir tmp/concept-review
`);
  process.exit(0);
}
const canonicalLookup = await buildCanonicalLookup(options.reviewDir);

for (const conceptDir of options.conceptDirs) {
  if (await directoryExists(conceptDir)) {
    await buildConceptSearchIndex(conceptDir, canonicalLookup);
  }
}
