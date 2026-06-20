import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const CONCEPT_DIR = path.resolve(ROOT, 'public/data/concept_graph');
const DEPENDENCY_DIR = path.resolve(ROOT, 'public/data/dependency');
const OUTPUT_PATH = path.resolve(ROOT, 'tmp/concept_graph_health.json');

const TEMPLATE_DEFINITION_RE = /(?:is a supporting quantity in this equation|is the main quantity to read from this equation|right-hand side shows|names the biological object|operation or transformation rule used by the equation|model parameter conventionally denoted|is a coefficient or parameter attached|local context|是调节关系强弱或方向的参数|是这条公式要读出的核心量|是本式中的辅助量)/i;
const FRAGMENT_NAME_RE = /\b(?:Sub|Power|Widehat|Widetilde|Mathbf|Boldsymbol|Mathrm|Frac|Simeq)\b/i;
const AMBIGUOUS_NAME_LIMIT = 3;
const LOW_CONFIDENCE_LIMIT = 0.72;
const MIN_FORMULA_COVERAGE_RATE = 0.95;
const MAX_ISOLATED_VIEW_RATE = 0.01;
const MIN_AVERAGE_PREREQUISITES_PER_VIEW = 1.89;
const MAX_EXPLICIT_REFERENCE_RATE = 0.3;
const MIN_SYMBOL_DEPENDENCY_RATE = 0.65;
const MIN_INTRODUCED_PREREQUISITE_RATIO = 0.8;
const MAX_INTRODUCED_PREREQUISITE_RATIO = 1.5;
const MAX_SELECTION_RESPONSE_IDS = 7;
const MAX_SINGLE_LETTER_POLYSEMY_ANOMALIES = 4;
const REVIEWED_SINGLE_LETTER_POLYSEMY_ALLOWLIST = new Set([
  'chapter16::d',
]);
const PUBLIC_REVIEW_STATUSES = new Set(['unreviewed', 'approved', 'edited', 'flagged', 'rejected']);
const PENDING_REVIEW_PLACEHOLDER = '解读尚在审核中';
const PUBLIC_PLACEHOLDER_NAME_RE = /^(?:Defined Quantity|Vector or Matrix Quantity|Variable|Value|Quantity|Parameter|Coefficient|Probability|Expectation|Mean|Variance|Time|Function|Response)$/i;
const BARE_SINGLE_LETTER_NAME_RE = /^[A-Za-z]$/;
const FORMULA_PREFIX_NAME_RE = /^Formula\s+\S+\s+/i;
const CHINESE_TEXT_RE = /[\u3400-\u9fff]/u;
const HIGH_RISK_GENERIC_NAMES = new Set([
  'alpha',
  'coefficient',
  'expectation',
  'function',
  'lambda',
  'mean',
  'mean time',
  'probability',
  'response',
  'time',
  'value',
  'variable',
  'variance',
  'vector or matrix quantity',
]);

function normalizeSymbol(value = '') {
  return String(value || '')
    .replace(/&/g, '')
    .replace(/\s+/g, '')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function baseSymbolForAudit(value = '') {
  return String(value || '')
    .replace(/\\(?:overline|widehat|hat|bar|tilde|mathbf|boldsymbol|bm|mathrm|mathit|mathbb)\s*\{?([A-Za-z])\}?/g, '$1')
    .replace(/^\\([A-Za-z]+).*$/, '$1')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 1)
    .toLowerCase();
}

function normalizeName(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function formulaScopeKey(view = {}) {
  return normalizeName(view.formula_subsection || view.formula_section || 'chapter');
}

function viewIdentity(value = {}) {
  return String(value?.view_id || value?.concept_id || '').trim();
}

function hasEvidenceSentence(view = {}) {
  return (view.evidence || []).some((item) => String(item?.sentence || '').trim());
}

function isTemplateDefinition(value = '') {
  return TEMPLATE_DEFINITION_RE.test(String(value || ''));
}

function acceptedFormulaPrerequisites(dependency) {
  return (dependency?.prerequisites || []).filter((item) => (
    item.type === 'formula'
    && item.target_id
    && !item.cross_chapter
    && (item.edge_status || 'accepted') === 'accepted'
    && item.relation !== 'compound_group'
  ));
}

function formulaHasDefinedSymbols(formula) {
  return (formula?.symbols_defined || []).some((symbol) => String(symbol || '').trim());
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function pushConceptDetail(target, graph, view, extra = {}) {
  target.push({
    chapter_id: graph.chapter_id,
    concept_id: view.concept_id,
    formula_id: view.defined_by_formula_id,
    symbol: view.defined_symbol,
    name: view.name,
    ...extra,
  });
}

function representedFormulaIds(view) {
  return [
    view?.defined_by_formula_id,
    ...(view?.formula_references || []).map((reference) => reference?.formula_id),
  ].filter(Boolean);
}

function isUsedOnlyConceptView(view) {
  return /_used_/i.test(String(view?.concept_id || view?.view_id || ''));
}

async function audit() {
  const files = (await readdir(CONCEPT_DIR))
    .filter((file) => file.endsWith('_concept_graph.json') && !file.startsWith('concept_'))
    .sort();

  const details = {
    fragment_names: [],
    template_definitions: [],
    missing_dependency_targets: [],
    missing_review_status: [],
    rejected_public_views: [],
    missing_source_sentences: [],
    missing_evidence_sentences: [],
    low_confidence_views: [],
    high_risk_generic_names: [],
    invalid_public_review_statuses: [],
    placeholder_names: [],
    bare_single_letter_names: [],
    formula_prefix_names: [],
    pending_review_placeholders: [],
    non_chinese_definitions: [],
    duplicate_same_name_prerequisite_edges: [],
    same_chapter_symbol_multi_names: [],
    same_chapter_symbol_scope_multi_names: [],
    same_chapter_name_multi_ids: [],
    same_chapter_name_multi_canonical_ids: [],
    name_family_subsection_multi_canonical_ids: [],
    cross_chapter_dependencies: [],
    self_prerequisite_references: [],
    same_formula_different_symbol_prerequisites: [],
    reciprocal_prerequisite_edges: [],
    formula_dependency_views_without_prerequisites: [],
    missing_reference_symbols: [],
    selection_response_ids: [],
    single_letter_polysemy_anomalies: [],
  };

  let formulas = 0;
  let formulasWithViews = 0;
  let definitionFormulas = 0;
  let definitionFormulasWithViews = 0;
  let views = 0;
  let prerequisiteReferences = 0;
  let isolatedViews = 0;
  let acceptedDependencies = 0;
  let explicitDependencies = 0;
  let symbolResolvableDependencies = 0;
  let symbolResolvableExplicitDependencies = 0;
  let exactOrCanonicalDependencies = 0;
  let introducedReferences = 0;
  const sameSymbolNames = new Map();
  const sameScopedSymbolNames = new Map();
  const sameNameIds = new Map();
  const sameNameCanonicalIds = new Map();
  const sameNameFamilySubsectionCanonicalIds = new Map();
  const selectionResponseIds = new Set();
  const singleLetterNames = new Map();

  for (const file of files) {
    const graph = await readJson(path.join(CONCEPT_DIR, file));
    if (JSON.stringify(graph).includes(PENDING_REVIEW_PLACEHOLDER)) {
      details.pending_review_placeholders.push({ chapter_id: graph.chapter_id, file });
    }
    const dependencyPath = path.join(DEPENDENCY_DIR, file.replace('_concept_graph.json', '_dependencies.json'));
    const dependencyGraph = await readJson(dependencyPath);
    const viewIds = new Set((graph.views || []).map((view) => view.concept_id));
    const viewIdentityIds = new Set((graph.views || []).flatMap((view) => [view.concept_id, view.view_id].filter(Boolean)));
    const formulaIdsWithViews = new Set((graph.views || []).flatMap(representedFormulaIds));
    const formulaById = new Map((dependencyGraph.formulas || [])
      .filter((formula) => formula?.id)
      .map((formula) => [formula.id, formula]));
    const chapterFormulaIds = new Set(formulaById.keys());
    const acceptedDependencyByFormula = new Map((dependencyGraph.dependencies || []).map((dependency) => [
      dependency.dependent_id,
      acceptedFormulaPrerequisites(dependency),
    ]));

    views += graph.views?.length || 0;
    formulas += chapterFormulaIds.size || graph.summary?.formulas_processed || 0;
    formulasWithViews += formulaIdsWithViews.size;
    const definitionFormulaIds = [...formulaById.values()]
      .filter(formulaHasDefinedSymbols)
      .map((formula) => formula.id);
    definitionFormulas += definitionFormulaIds.length;
    definitionFormulasWithViews += definitionFormulaIds.filter((id) => formulaIdsWithViews.has(id)).length;

    for (const view of graph.views || []) {
      const prereqs = view.prerequisite_concepts || [];
      const successors = view.successor_concepts || [];
      const introduced = view.introduced_concepts || [];
      prerequisiteReferences += prereqs.length;
      introducedReferences += introduced.length;
      if (!prereqs.length && !successors.length) isolatedViews += 1;
      if (!isUsedOnlyConceptView(view) && (acceptedDependencyByFormula.get(view.defined_by_formula_id) || []).length && !prereqs.length) {
        pushConceptDetail(details.formula_dependency_views_without_prerequisites, graph, view);
      }

      if (!view.review_status) pushConceptDetail(details.missing_review_status, graph, view);
      if (view.review_status && !PUBLIC_REVIEW_STATUSES.has(view.review_status)) {
        pushConceptDetail(details.invalid_public_review_statuses, graph, view, { review_status: view.review_status });
      }
      if (view.review_status === 'rejected') pushConceptDetail(details.rejected_public_views, graph, view);
      if (!String(view.source_sentence || '').trim()) pushConceptDetail(details.missing_source_sentences, graph, view);
      if (!hasEvidenceSentence(view)) pushConceptDetail(details.missing_evidence_sentences, graph, view);
      if (Number(view.confidence || 0) < LOW_CONFIDENCE_LIMIT) {
        pushConceptDetail(details.low_confidence_views, graph, view, { confidence: view.confidence });
      }
      if (HIGH_RISK_GENERIC_NAMES.has(normalizeName(view.name))) {
        pushConceptDetail(details.high_risk_generic_names, graph, view, {
          review_status: view.review_status,
          review_flags: view.review_flags || [],
        });
      }

      if (FRAGMENT_NAME_RE.test(view.name || '')) pushConceptDetail(details.fragment_names, graph, view);
      if (PUBLIC_PLACEHOLDER_NAME_RE.test(view.name || '')) pushConceptDetail(details.placeholder_names, graph, view);
      if (BARE_SINGLE_LETTER_NAME_RE.test(view.name || '')) pushConceptDetail(details.bare_single_letter_names, graph, view);
      if (FORMULA_PREFIX_NAME_RE.test(view.name || '')) pushConceptDetail(details.formula_prefix_names, graph, view);
      if (!CHINESE_TEXT_RE.test(String(view.definition_zh || ''))) pushConceptDetail(details.non_chinese_definitions, graph, view, { definition_zh: view.definition_zh });
      if (isTemplateDefinition(view.definition) || isTemplateDefinition(view.definition_zh)) {
        pushConceptDetail(details.template_definitions, graph, view);
      }

      if (normalizeName(view.canonical_concept_name || view.name) === 'selection response') {
        selectionResponseIds.add(view.canonical_concept_id || view.concept_id);
      }

      const symbol = normalizeSymbol(view.defined_symbol);
      if (symbol) {
        const key = `${graph.chapter_id}::${symbol}`;
        if (!sameSymbolNames.has(key)) sameSymbolNames.set(key, new Map());
        const names = sameSymbolNames.get(key);
        const name = normalizeName(view.name);
        if (!names.has(name)) names.set(name, new Set());
        names.get(name).add(view.defined_by_formula_id);

        const scopedKey = `${graph.chapter_id}::${formulaScopeKey(view)}::${symbol}`;
        if (!sameScopedSymbolNames.has(scopedKey)) sameScopedSymbolNames.set(scopedKey, new Map());
        const scopedNames = sameScopedSymbolNames.get(scopedKey);
        if (!scopedNames.has(name)) scopedNames.set(name, new Set());
        scopedNames.get(name).add(view.defined_by_formula_id);

        if (/^[A-Za-z]$/.test(symbol)) {
          const polyKey = `${graph.chapter_id}::${symbol.toLowerCase()}`;
          if (!singleLetterNames.has(polyKey)) singleLetterNames.set(polyKey, new Set());
          singleLetterNames.get(polyKey).add(normalizeName(view.canonical_concept_name || view.name));
        }
      }

      for (const reference of prereqs) {
        const sourceIdentity = viewIdentity(reference);
        const targetIdentity = viewIdentity(view);
        if (sourceIdentity && targetIdentity && sourceIdentity === targetIdentity) {
          pushConceptDetail(details.self_prerequisite_references, graph, view, {
            reference_concept_id: reference.concept_id,
            reference_view_id: reference.view_id,
          });
        }
        const referenceFormulaId = reference.defined_by_formula_id || reference.from_formula_id || '';
        if (referenceFormulaId && referenceFormulaId === view.defined_by_formula_id) {
          const referenceSymbol = normalizeSymbol(reference.symbol || reference.via_symbol || '');
          const currentSymbol = normalizeSymbol(view.defined_symbol || '');
          if (referenceSymbol && currentSymbol && referenceSymbol !== currentSymbol) {
            pushConceptDetail(details.same_formula_different_symbol_prerequisites, graph, view, {
              reference_concept_id: reference.concept_id,
              reference_view_id: reference.view_id,
              reference_symbol: reference.symbol || reference.via_symbol,
            });
          }
        }
      }
      const prerequisiteNames = new Map();
      for (const reference of prereqs) {
        const key = normalizeName(reference.canonical_concept_name || reference.name);
        if (!key) continue;
        const current = prerequisiteNames.get(key) || [];
        current.push(reference);
        prerequisiteNames.set(key, current);
      }
      for (const [name, references] of prerequisiteNames) {
        if (references.length > 1) {
          pushConceptDetail(details.duplicate_same_name_prerequisite_edges, graph, view, {
            name,
            count: references.length,
            reference_ids: references.map((reference) => reference.view_id || reference.concept_id).filter(Boolean),
          });
        }
      }

      const nameKey = `${graph.chapter_id}::${normalizeName(view.canonical_concept_name || view.name)}`;
      if (!sameNameIds.has(nameKey)) sameNameIds.set(nameKey, new Set());
      sameNameIds.get(nameKey).add(view.concept_id);
      if (!sameNameCanonicalIds.has(nameKey)) sameNameCanonicalIds.set(nameKey, new Set());
      sameNameCanonicalIds.get(nameKey).add(view.canonical_concept_id || '');
      const nameFamilySubsectionKey = `${graph.chapter_id}::${formulaScopeKey(view)}::${normalizeName(view.canonical_concept_name || view.name)}::${normalizeSymbol(view.family_key || view.symbol_family || baseSymbolForAudit(view.defined_symbol || ''))}`;
      if (!sameNameFamilySubsectionCanonicalIds.has(nameFamilySubsectionKey)) sameNameFamilySubsectionCanonicalIds.set(nameFamilySubsectionKey, new Set());
      sameNameFamilySubsectionCanonicalIds.get(nameFamilySubsectionKey).add(view.canonical_concept_id || '');
    }

    for (const dependency of dependencyGraph.dependencies || []) {
      for (const prereq of dependency.prerequisites || []) {
        if (prereq.cross_chapter) {
          details.cross_chapter_dependencies.push({
            chapter_id: graph.chapter_id,
            dependent_id: dependency.dependent_id,
            target_id: prereq.target_id,
          });
        }
      }
      for (const prereq of acceptedFormulaPrerequisites(dependency)) {
        acceptedDependencies += 1;
        if (prereq.edge_evidence === 'explicit_reference') explicitDependencies += 1;
        const dependentFormula = formulaById.get(dependency.dependent_id);
        const targetFormula = formulaById.get(prereq.target_id);
        if (formulaHasDefinedSymbols(dependentFormula) && formulaHasDefinedSymbols(targetFormula)) {
          symbolResolvableDependencies += 1;
          if (prereq.edge_evidence === 'explicit_reference') symbolResolvableExplicitDependencies += 1;
        }
        if (['exact_match', 'canonical_match', 'family_match'].includes(prereq.edge_evidence)) exactOrCanonicalDependencies += 1;
        if (!formulaIdsWithViews.has(prereq.target_id)) {
          details.missing_dependency_targets.push({
            chapter_id: graph.chapter_id,
            dependent_id: dependency.dependent_id,
            target_id: prereq.target_id,
            via_symbol: prereq.via_symbol,
          });
        }
      }
    }

    for (const view of graph.views || []) {
      for (const reference of [...(view.prerequisite_concepts || []), ...(view.successor_concepts || []), ...(view.introduced_concepts || [])]) {
        if (!String(reference?.via_symbol || reference?.symbol || '').trim()) {
          pushConceptDetail(details.missing_reference_symbols, graph, view, {
            reference_concept_id: reference.concept_id,
            reference_view_id: reference.view_id,
            reference_name: reference.name,
          });
        }
      }
      for (const reference of [...(view.prerequisite_concepts || []), ...(view.successor_concepts || [])]) {
        if (reference?.concept_id && !viewIds.has(reference.concept_id)) {
          details.missing_dependency_targets.push({
            chapter_id: graph.chapter_id,
            dependent_id: view.defined_by_formula_id,
            target_id: reference.defined_by_formula_id || reference.from_formula_id,
            concept_id: reference.concept_id,
          });
        }
        if (reference?.view_id && !viewIdentityIds.has(reference.view_id)) {
          details.missing_dependency_targets.push({
            chapter_id: graph.chapter_id,
            dependent_id: view.defined_by_formula_id,
            target_id: reference.defined_by_formula_id || reference.from_formula_id,
            concept_id: reference.concept_id,
            view_id: reference.view_id,
          });
        }
      }
    }

    const edgeKeys = new Set();
    for (const view of graph.views || []) {
      const targetIdentity = viewIdentity(view);
      for (const reference of view.prerequisite_concepts || []) {
        const sourceIdentity = viewIdentity(reference);
        if (!sourceIdentity || !targetIdentity || sourceIdentity === targetIdentity) continue;
        const reverseKey = `${targetIdentity}->${sourceIdentity}`;
        if (edgeKeys.has(reverseKey)) {
          details.reciprocal_prerequisite_edges.push({
            chapter_id: graph.chapter_id,
            source_id: sourceIdentity,
            target_id: targetIdentity,
            formula_id: view.defined_by_formula_id,
          });
        }
        edgeKeys.add(`${sourceIdentity}->${targetIdentity}`);
      }
    }
  }

  addMultiNameDetails(details.same_chapter_symbol_multi_names, sameSymbolNames);
  addMultiNameDetails(details.same_chapter_symbol_scope_multi_names, sameScopedSymbolNames);
  details.selection_response_ids = [...selectionResponseIds].sort();
  for (const [key, names] of singleLetterNames) {
    if (names.size > 5 && !REVIEWED_SINGLE_LETTER_POLYSEMY_ALLOWLIST.has(key)) {
      details.single_letter_polysemy_anomalies.push({
        key,
        count: names.size,
        names: [...names].sort(),
      });
    }
  }
  details.single_letter_polysemy_anomalies.sort(sortDetailByCount);

  for (const [key, ids] of sameNameIds) {
    if (ids.size > 1) {
      details.same_chapter_name_multi_ids.push({
        key,
        count: ids.size,
        concept_ids: [...ids].sort(),
      });
    }
  }

  for (const [key, ids] of sameNameCanonicalIds) {
    if (ids.size > 1 || ids.has('')) {
      details.same_chapter_name_multi_canonical_ids.push({
        key,
        count: ids.size,
        canonical_concept_ids: [...ids].sort(),
      });
    }
  }

  for (const [key, ids] of sameNameFamilySubsectionCanonicalIds) {
    if (ids.size > 1 || ids.has('')) {
      details.name_family_subsection_multi_canonical_ids.push({
        key,
        count: ids.size,
        canonical_concept_ids: [...ids].sort(),
      });
    }
  }

  details.same_chapter_symbol_multi_names.sort(sortDetailByCount);
  details.same_chapter_symbol_scope_multi_names.sort(sortDetailByCount);
  details.same_chapter_name_multi_ids.sort(sortDetailByCount);
  details.same_chapter_name_multi_canonical_ids.sort(sortDetailByCount);
  details.name_family_subsection_multi_canonical_ids.sort(sortDetailByCount);

  const summary = {
    files: files.length,
    formulas,
    formulas_with_views: formulasWithViews,
    formula_coverage_rate: formulas ? formulasWithViews / formulas : 0,
    definition_formulas: definitionFormulas,
    definition_formulas_with_views: definitionFormulasWithViews,
    definition_formula_coverage_rate: definitionFormulas ? definitionFormulasWithViews / definitionFormulas : 0,
    views,
    missing_review_status_count: details.missing_review_status.length,
    rejected_public_view_count: details.rejected_public_views.length,
    missing_source_sentence_count: details.missing_source_sentences.length,
    missing_evidence_sentence_count: details.missing_evidence_sentences.length,
    low_confidence_view_count: details.low_confidence_views.length,
    high_risk_generic_name_count: details.high_risk_generic_names.length,
    fragment_name_count: details.fragment_names.length,
    placeholder_name_count: details.placeholder_names.length,
    bare_single_letter_name_count: details.bare_single_letter_names.length,
    formula_prefix_name_count: details.formula_prefix_names.length,
    pending_review_placeholder_count: details.pending_review_placeholders.length,
    non_chinese_definition_count: details.non_chinese_definitions.length,
    template_definition_count: details.template_definitions.length,
    duplicate_same_name_prerequisite_edge_count: details.duplicate_same_name_prerequisite_edges.length,
    accepted_dependencies: acceptedDependencies,
    missing_dependency_target_count: details.missing_dependency_targets.length,
    missing_dependency_target_rate: acceptedDependencies ? details.missing_dependency_targets.length / acceptedDependencies : 0,
    explicit_reference_count: explicitDependencies,
    explicit_reference_rate: acceptedDependencies ? explicitDependencies / acceptedDependencies : 0,
    symbol_resolvable_dependency_count: symbolResolvableDependencies,
    symbol_resolvable_explicit_reference_count: symbolResolvableExplicitDependencies,
    symbol_resolvable_explicit_reference_rate: symbolResolvableDependencies ? symbolResolvableExplicitDependencies / symbolResolvableDependencies : 0,
    exact_or_canonical_dependency_count: exactOrCanonicalDependencies,
    exact_or_canonical_dependency_rate: acceptedDependencies ? exactOrCanonicalDependencies / acceptedDependencies : 0,
    cross_chapter_dependency_count: details.cross_chapter_dependencies.length,
    prerequisite_references: prerequisiteReferences,
    introduced_references: introducedReferences,
    introduced_prerequisite_ratio: prerequisiteReferences ? introducedReferences / prerequisiteReferences : 0,
    average_prerequisites_per_view: views ? prerequisiteReferences / views : 0,
    isolated_view_count: isolatedViews,
    isolated_view_rate: views ? isolatedViews / views : 0,
    same_chapter_symbol_polysemy_count: details.same_chapter_symbol_multi_names.length,
    same_chapter_symbol_multi_name_count: details.same_chapter_symbol_scope_multi_names.length,
    same_chapter_symbol_scope_multi_name_count: details.same_chapter_symbol_scope_multi_names.length,
    same_chapter_name_multi_id_count: details.same_chapter_name_multi_ids.length,
    same_chapter_name_multi_canonical_id_count: details.same_chapter_name_multi_canonical_ids.length,
    name_family_subsection_multi_canonical_id_count: details.name_family_subsection_multi_canonical_ids.length,
    self_prerequisite_reference_count: details.self_prerequisite_references.length,
    same_formula_different_symbol_prerequisite_count: details.same_formula_different_symbol_prerequisites.length,
    reciprocal_prerequisite_edge_count: details.reciprocal_prerequisite_edges.length,
    formula_dependency_view_without_prerequisite_count: details.formula_dependency_views_without_prerequisites.length,
    missing_reference_symbol_count: details.missing_reference_symbols.length,
    invalid_public_review_status_count: details.invalid_public_review_statuses.length,
    selection_response_id_count: details.selection_response_ids.length,
    single_letter_polysemy_anomaly_count: details.single_letter_polysemy_anomalies.length,
  };

  return { generated_at: new Date().toISOString(), summary, details };
}

function addMultiNameDetails(target, source) {
  for (const [key, names] of source) {
    if (names.size >= AMBIGUOUS_NAME_LIMIT) {
      target.push({
        key,
        count: names.size,
        names: [...names.entries()].map(([name, formulaIds]) => ({
          name,
          formula_ids: [...formulaIds].sort(),
        })),
      });
    }
  }
}

function sortDetailByCount(left, right) {
  return right.count - left.count || left.key.localeCompare(right.key);
}

const result = await audit();
await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result.summary, null, 2));
if (
  result.summary.cross_chapter_dependency_count
  || result.summary.fragment_name_count
  || result.summary.placeholder_name_count
  || result.summary.bare_single_letter_name_count
  || result.summary.formula_prefix_name_count
  || result.summary.pending_review_placeholder_count
  || result.summary.non_chinese_definition_count
  || result.summary.template_definition_count
  || result.summary.duplicate_same_name_prerequisite_edge_count
  || result.summary.missing_dependency_target_rate > 0.01
  || result.summary.missing_review_status_count
  || result.summary.invalid_public_review_status_count
  || result.summary.rejected_public_view_count
  || result.summary.missing_source_sentence_count
  || result.summary.missing_evidence_sentence_count
  || result.summary.formula_coverage_rate < MIN_FORMULA_COVERAGE_RATE
  || result.summary.isolated_view_rate > MAX_ISOLATED_VIEW_RATE
  || result.summary.average_prerequisites_per_view < MIN_AVERAGE_PREREQUISITES_PER_VIEW
  || result.summary.introduced_prerequisite_ratio < MIN_INTRODUCED_PREREQUISITE_RATIO
  || result.summary.introduced_prerequisite_ratio > MAX_INTRODUCED_PREREQUISITE_RATIO
  || result.summary.symbol_resolvable_explicit_reference_rate > MAX_EXPLICIT_REFERENCE_RATE
  || result.summary.exact_or_canonical_dependency_rate < MIN_SYMBOL_DEPENDENCY_RATE
  || result.summary.self_prerequisite_reference_count
  || result.summary.same_formula_different_symbol_prerequisite_count
  || result.summary.reciprocal_prerequisite_edge_count
  || result.summary.formula_dependency_view_without_prerequisite_count
  || result.summary.missing_reference_symbol_count
  || result.summary.selection_response_id_count > MAX_SELECTION_RESPONSE_IDS
  || result.summary.single_letter_polysemy_anomaly_count > MAX_SINGLE_LETTER_POLYSEMY_ANOMALIES
  || result.summary.same_chapter_symbol_scope_multi_name_count
  || result.summary.name_family_subsection_multi_canonical_id_count
) {
  process.exitCode = 1;
}
