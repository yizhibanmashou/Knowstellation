import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const conceptDir = path.resolve('public/data/concept_graph');
const dependencyDir = path.resolve('public/data/dependency');
const reviewDir = path.resolve('tmp/concept-review');
const SAFE_SINGLE_LETTER_CANONICAL_SYMBOLS = new Set(['N', 'P', 'p', 'q', 'R', 'S', 'w', 'z', 'h']);

function isFormulaArtifactName(name = ''): boolean {
  return /^formula\s+\S+\s+(?:relationship|result|concept)$/i.test(name);
}

function isFormulaReference(value = ''): boolean {
  return /^(?:equation|formula)\s+[A-Za-z]?\d+(?:\.\d+)?[a-z]?$/i.test(String(value || '').replace(/\s+/g, ' ').trim());
}

function isTemplateDefinition(value = ''): boolean {
  return /(?:is a supporting quantity in this equation|is the main quantity to read from this equation|right-hand side shows|names the biological object|operation or transformation rule used by the equation|model parameter conventionally denoted|is a coefficient or parameter attached|local context)/i.test(value);
}

function symbolKey(value = ''): string {
  return String(value || '')
    .replace(/&/g, '')
    .replace(/\s+/g, '')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function splitSenseId(senseId = ''): { formula_id: string; symbol: string } | null {
  const index = String(senseId).indexOf('::');
  if (index < 0) return null;
  return {
    formula_id: senseId.slice(0, index),
    symbol: senseId.slice(index + 2),
  };
}

function formulaReferencesForView(view: {
  defined_by_formula_id?: string;
  defined_symbol?: string;
  concept_id?: string;
  view_id?: string;
  formula_references?: Array<{ formula_id?: string; symbol?: string; concept_id?: string; view_id?: string }>;
}) {
  return [
    {
      formula_id: view.defined_by_formula_id,
      symbol: view.defined_symbol,
      concept_id: view.concept_id,
      view_id: view.view_id || view.concept_id,
    },
    ...(view.formula_references || []),
  ].filter((reference) => reference.formula_id);
}

function representedFormulaIdsForView(view: {
  defined_by_formula_id?: string;
  defined_symbol?: string;
  concept_id?: string;
  view_id?: string;
  formula_references?: Array<{ formula_id?: string; symbol?: string; concept_id?: string; view_id?: string }>;
}) {
  return formulaReferencesForView(view).map((reference) => reference.formula_id!).filter(Boolean);
}

function viewRepresentsFormulaSymbol(
  view: {
    defined_by_formula_id?: string;
    defined_symbol?: string;
    concept_id?: string;
    view_id?: string;
    formula_references?: Array<{ formula_id?: string; symbol?: string; concept_id?: string; view_id?: string }>;
  },
  formulaId: string,
  symbol?: string,
) {
  return formulaReferencesForView(view).some((reference) => (
    reference.formula_id === formulaId
    && (!symbol || symbolKey(reference.symbol || view.defined_symbol || '') === symbolKey(symbol))
  ));
}

function viewCarriesFormulaReference(
  view: {
    concept_id?: string;
    view_id?: string;
    formula_references?: Array<{ concept_id?: string; view_id?: string }>;
  },
  viewId: string,
) {
  return view.concept_id === viewId
    || view.view_id === viewId
    || (view.formula_references || []).some((reference) => reference.concept_id === viewId || reference.view_id === viewId);
}

test('public concept graphs contain real concept edges without formula artifacts', async () => {
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));
  let viewCount = 0;
  let edgeCount = 0;
  const representedFormulaIds = new Set<string>();

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      chapter_id: string;
      views: Array<{
        concept_id: string;
        name: string;
        prerequisite_concepts?: Array<{ concept_id: string; name: string; via_symbol?: string; relation?: string }>;
        successor_concepts?: Array<{ concept_id: string; name: string }>;
      }>;
    };
    const validIds = new Set(graph.views.map((view) => view.concept_id));
    const chapterEdges = graph.views.reduce((sum, view) => sum + (view.prerequisite_concepts || []).length, 0);
    viewCount += graph.views.length;
    edgeCount += chapterEdges;
    for (const view of graph.views) {
      for (const formulaId of representedFormulaIdsForView(view)) representedFormulaIds.add(formulaId);
    }

    for (const view of graph.views) {
      assert.equal(view.concept_id.endsWith('_statement'), false, `${graph.chapter_id} still has statement concept ${view.concept_id}`);
      assert.equal(isFormulaArtifactName(view.name), false, `${graph.chapter_id} still has formula artifact concept ${view.name}`);
      for (const reference of view.prerequisite_concepts || []) {
        assert.ok(validIds.has(reference.concept_id), `${graph.chapter_id} prerequisite ${reference.concept_id} is not a real view`);
        assert.equal(isFormulaArtifactName(reference.name), false, `${graph.chapter_id} prerequisite ${reference.name} is formula artifact`);
        assert.equal(reference.relation === 'explicit_reference' || isFormulaReference(reference.via_symbol), false, `${graph.chapter_id} concept depends on formula reference`);
      }
      for (const reference of view.successor_concepts || []) {
        assert.ok(validIds.has(reference.concept_id), `${graph.chapter_id} successor ${reference.concept_id} is not a real view`);
      }
    }
  }

  assert.ok(viewCount > 1000, 'whole-book concept graph should retain legitimate canonical concept views');
  assert.ok(representedFormulaIds.size > 2500, 'canonical concept views should retain formula-level references');
  assert.ok(edgeCount > 1000, 'whole-book concept graph should keep a meaningful number of real concept edges');
});

test('accepted formula dependencies can reach target formulas in the concept layer', async () => {
  const files = (await readdir(dependencyDir)).filter((file) => file.endsWith('_dependencies.json'));
  let formulaEdgeCount = 0;
  let missingTargetViewCount = 0;
  let publicDependencyReferenceCount = 0;
  let danglingPublicDependencyReferenceCount = 0;
  let emptyConceptPrerequisiteWithFormulaDependencyCount = 0;

  for (const file of files) {
    const dependencyGraph = JSON.parse(await readFile(path.join(dependencyDir, file), 'utf8')) as {
      chapter_id: string;
      dependencies?: Array<{
        dependent_id: string;
        prerequisites?: Array<{
          type?: string;
          target_id?: string;
          cross_chapter?: boolean;
          edge_status?: string;
          relation?: string;
        }>;
      }>;
    };
    const conceptGraph = JSON.parse(await readFile(path.join(conceptDir, `${dependencyGraph.chapter_id}_concept_graph.json`), 'utf8')) as {
      views: Array<{
        concept_id: string;
        defined_by_formula_id: string;
        formula_references?: Array<{ formula_id: string }>;
        prerequisite_concepts?: Array<{
          concept_id?: string;
          defined_by_formula_id?: string;
          from_formula_id?: string;
          relation?: string;
        }>;
      }>;
    };
    const formulasWithViews = new Set(conceptGraph.views.flatMap((view) => [
      view.defined_by_formula_id,
      ...(view.formula_references || []).map((reference) => reference.formula_id),
    ].filter(Boolean)));
    const publicConceptIds = new Set(conceptGraph.views.map((view) => view.concept_id));
    const formulasWithFormulaDependencies = new Set<string>();
    for (const dependency of dependencyGraph.dependencies || []) {
      for (const prerequisite of dependency.prerequisites || []) {
        if (prerequisite.type !== 'formula') continue;
        if (!prerequisite.target_id || prerequisite.cross_chapter) continue;
        if ((prerequisite.edge_status || 'accepted') !== 'accepted') continue;
        if (prerequisite.relation === 'compound_group') continue;
        formulasWithFormulaDependencies.add(dependency.dependent_id);
        formulaEdgeCount += 1;
        if (!formulasWithViews.has(prerequisite.target_id)) missingTargetViewCount += 1;
      }
    }
    for (const view of conceptGraph.views || []) {
      const representedFormulaIds = representedFormulaIdsForView(view);
      if (
        !/_used_/i.test(view.concept_id)
        && formulasWithFormulaDependencies.has(view.defined_by_formula_id)
        && !(view.prerequisite_concepts || []).length
      ) {
        emptyConceptPrerequisiteWithFormulaDependencyCount += 1;
      }
      for (const reference of view.prerequisite_concepts || []) {
        if (!reference.from_formula_id && !reference.defined_by_formula_id) continue;
        publicDependencyReferenceCount += 1;
        const formulaId = reference.from_formula_id || reference.defined_by_formula_id;
        if (!reference.concept_id || !publicConceptIds.has(reference.concept_id) || (formulaId && !formulasWithViews.has(formulaId))) {
          danglingPublicDependencyReferenceCount += 1;
        }
      }
    }
  }

  assert.ok(formulaEdgeCount > 2000, 'test should cover the whole-book formula dependency graph');
  assert.ok(missingTargetViewCount < formulaEdgeCount * 0.05, `${missingTargetViewCount} accepted formula dependency targets lack concept views`);
  assert.ok(publicDependencyReferenceCount > 1000, 'test should cover public formula-derived concept references');
  assert.equal(danglingPublicDependencyReferenceCount, 0, `${danglingPublicDependencyReferenceCount} public formula dependency references are dangling`);
  assert.equal(emptyConceptPrerequisiteWithFormulaDependencyCount, 0, `${emptyConceptPrerequisiteWithFormulaDependencyCount} concept views have formula dependencies but no concept prerequisites`);
});

test('common repeated concept references carry stable canonical ids', async () => {
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));
  const expected = new Map([
    ['Population Size', 'canonical_population_size'],
    ['Process Time', 'canonical_process_time'],
    ['Variance Quantity', 'canonical_variance_quantity'],
  ]);
  const seen = new Map<string, Set<string>>();

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      views: Array<{
        name: string;
        canonical_concept_id?: string;
        prerequisite_concepts?: Array<{ name: string; canonical_concept_id?: string }>;
        introduced_concepts?: Array<{ name: string; canonical_concept_id?: string }>;
      }>;
    };
    for (const view of graph.views) {
      for (const item of [view, ...(view.prerequisite_concepts || []), ...(view.introduced_concepts || [])]) {
        const expectedId = expected.get(item.name);
        if (!expectedId) continue;
        const ids = seen.get(item.name) || new Set<string>();
        if (item.canonical_concept_id) ids.add(item.canonical_concept_id);
        seen.set(item.name, ids);
      }
    }
  }

  for (const [name, canonicalId] of expected) {
    const ids = seen.get(name) || new Set<string>();
    assert.deepEqual([...ids], [canonicalId], `${name} should use one stable canonical concept id`);
  }
});

test('public concept graphs retain most formulas with defined symbols', async () => {
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));
  let definedFormulaCount = 0;
  let coveredFormulaCount = 0;

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      chapter_id: string;
      views: Array<{ defined_by_formula_id: string; formula_references?: Array<{ formula_id: string }> }>;
    };
    const review = JSON.parse(await readFile(path.join(reviewDir, `${graph.chapter_id}_symbol_concept_map.json`), 'utf8')) as {
      symbol_concepts?: Array<{ formula_id: string; role: string; review_status?: string; symbol?: string }>;
    };
    const covered = new Set(graph.views.flatMap((view) => representedFormulaIdsForView(view)));
    const defined = new Set((review.symbol_concepts || [])
      .filter((concept) => concept.role === 'defined')
      .filter((concept) => concept.review_status !== 'rejected')
      .filter((concept) => concept.symbol)
      .map((concept) => concept.formula_id));
    definedFormulaCount += defined.size;
    for (const formulaId of defined) {
      if (covered.has(formulaId)) coveredFormulaCount += 1;
    }
  }

  assert.ok(definedFormulaCount > 1700, 'test should cover the full public symbol concept map');
  assert.ok(
    coveredFormulaCount / definedFormulaCount > 0.85,
    `concept views should cover at least 85% of formulas with accepted defined symbols (${coveredFormulaCount}/${definedFormulaCount})`,
  );
});

test('public concept views do not expose template definitions or placeholder names', async () => {
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      chapter_id: string;
      views: Array<{ concept_id: string; name: string; definition?: string; definition_zh?: string }>;
    };
    for (const view of graph.views) {
      assert.notEqual(view.name, 'Model Quantity', `${graph.chapter_id} exposes placeholder concept ${view.concept_id}`);
      assert.equal(isTemplateDefinition(view.definition), false, `${graph.chapter_id} exposes template definition in ${view.concept_id}`);
      assert.equal(isTemplateDefinition(view.definition_zh), false, `${graph.chapter_id} exposes template zh definition in ${view.concept_id}`);
    }
  }
});

test('public concept graphs keep legal subscripted and powered LHS concepts with readable names', async () => {
  const cases = [
    { chapter_id: 'chapter10', formula_id: 'formula_10.3a', symbol: '\\widehat{E}[S_{i}^{A}]' },
    { chapter_id: 'chapter10', formula_id: 'formula_10.12a', symbol: 'E[D_{s}]' },
    { chapter_id: 'chapter28', formula_id: 'formula_28.14a', symbol: '\\widetilde{\\sigma}_{A}^{2}' },
    { chapter_id: 'chapter28', formula_id: 'formula_28.45a', symbol: '\\widetilde{\\sigma}_{A}^{2}' },
  ];

  for (const item of cases) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, `${item.chapter_id}_concept_graph.json`), 'utf8')) as {
      views: Array<{
        defined_by_formula_id: string;
        defined_symbol?: string;
        name: string;
        formula_references?: Array<{ formula_id: string; symbol?: string }>;
      }>;
    };
    const view = graph.views.find((candidate) => viewRepresentsFormulaSymbol(candidate, item.formula_id, item.symbol));
    assert.ok(view, `${item.chapter_id} ${item.formula_id} missing legal LHS concept view`);
    assert.ok(viewRepresentsFormulaSymbol(view, item.formula_id, item.symbol));
    assert.doesNotMatch(view.name, /\b(?:Sub|Power|Widehat|Widetilde|Mathbf|Sigma)\b/i);
    assert.doesNotMatch(view.name, /^Formula\s+\S+\s+Defined Quantity$/i);
  }
});

test('public concept graphs keep legal bold matrix LHS concepts', async () => {
  const cases = [
    { chapter_id: 'chapter19', formula_id: 'formula_19.2a', symbol: '\\mathbf{V}' },
    { chapter_id: 'chapter19', formula_id: 'formula_19.3d', symbol: '\\mathbf{M}' },
  ];

  for (const item of cases) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, `${item.chapter_id}_concept_graph.json`), 'utf8')) as {
      views: Array<{ defined_by_formula_id: string; defined_symbol?: string; name: string }>;
    };
    const view = graph.views.find((candidate) => candidate.defined_by_formula_id === item.formula_id);
    assert.ok(view, `${item.chapter_id} ${item.formula_id} missing legal bold matrix LHS concept view`);
    assert.equal(view.defined_symbol, item.symbol);
    assert.match(view.name, /\b(?:Matrix|V|M)\b/i);
  }
});

test('public used-symbol views keep reviewed concept names', async () => {
  const cases = [
    {
      chapter_id: 'chapter16',
      view_id: 'concept_chapter16_formula_16_1a_used_a_j',
      expected_name: 'Additive Matrix Exponentiation',
    },
    {
      chapter_id: 'chapter26',
      view_id: 'concept_chapter26_formula_26_13a_used_a_2',
      expected_name: 'Additive Matrix Exponentiation',
    },
  ];

  for (const item of cases) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, `${item.chapter_id}_concept_graph.json`), 'utf8')) as {
      views: Array<{
        concept_id: string;
        view_id?: string;
        name: string;
        formula_references?: Array<{ concept_id?: string; view_id?: string }>;
      }>;
    };
    const view = graph.views.find((candidate) => viewCarriesFormulaReference(candidate, item.view_id));
    assert.ok(view, `${item.chapter_id} missing used-symbol concept view ${item.view_id}`);
    assert.equal(view.name, item.expected_name);
  }
});

test('public concept names do not expose mechanical LaTeX readable fragments', async () => {
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      chapter_id: string;
      views: Array<{ concept_id: string; name: string; prerequisite_concepts?: Array<{ name: string }>; introduced_concepts?: Array<{ name: string }> }>;
    };

    for (const view of graph.views) {
      const items = [view, ...(view.prerequisite_concepts || []), ...(view.introduced_concepts || [])];
      for (const item of items) {
        assert.doesNotMatch(
          item.name || '',
          /\b(?:Sub|Power|Widehat|Widetilde|Mathbf|Boldsymbol|Mathrm|Frac|Simeq)\b/i,
          `${graph.chapter_id} exposes mechanical concept name ${view.concept_id}: ${item.name}`,
        );
      }
    }
  }
});

test('public concept graphs do not expose LaTeX alignment markers as symbols', async () => {
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      chapter_id: string;
      views: Array<{
        defined_by_formula_id: string;
        name: string;
        defined_symbol?: string;
        prerequisite_concepts?: Array<{ name: string; symbol?: string; via_symbol?: string }>;
        introduced_concepts?: Array<{ name: string; symbol?: string; via_symbol?: string }>;
      }>;
    };
    for (const view of graph.views) {
      const publicItems = [view, ...(view.prerequisite_concepts || []), ...(view.introduced_concepts || [])];
      for (const item of publicItems) {
        const publicItem = item as { name?: string; symbol?: string; via_symbol?: string };
        assert.equal(String(publicItem.name || '').includes('&'), false, `${graph.chapter_id} exposes alignment marker in name ${publicItem.name}`);
        assert.equal(String(publicItem.symbol || '').includes('&'), false, `${graph.chapter_id} exposes alignment marker in symbol ${publicItem.symbol}`);
        assert.equal(String(publicItem.via_symbol || '').includes('&'), false, `${graph.chapter_id} exposes alignment marker in via_symbol ${publicItem.via_symbol}`);
      }
    }
  }

  const chapter6 = JSON.parse(await readFile(path.join(conceptDir, 'chapter6_concept_graph.json'), 'utf8')) as {
    views: Array<{
      concept_id: string;
      canonical_concept_id?: string;
      defined_by_formula_id: string;
      defined_symbol?: string;
      name: string;
      formula_references?: Array<{ formula_id: string; symbol?: string }>;
    }>;
  };
  const priceExpansion = chapter6.views.find((view) => view.defined_by_formula_id === 'formula_6.4');
  assert.ok(priceExpansion, 'chapter6 formula_6.4 should retain a concept view');
  assert.equal(priceExpansion.defined_symbol, 'R_{z}');
  assert.notEqual(priceExpansion.name, 'R Sub Z&');
  const traitResponseViews = chapter6.views.filter((view) => view.canonical_concept_id === 'canonical_chapter6_trait_response');
  assert.equal(traitResponseViews.length, 1, 'chapter6 Trait Response should be one canonical public view');
  assert.equal(traitResponseViews[0].concept_id, 'canonical_chapter6_trait_response');
  assert.ok((traitResponseViews[0].formula_references || []).length >= 17, 'chapter6 Trait Response should retain multi-formula references');
  assert.ok((traitResponseViews[0].formula_references || []).some((reference) => reference.formula_id === 'formula_6.32'));

  const appendix1 = JSON.parse(await readFile(path.join(conceptDir, 'appendix1_concept_graph.json'), 'utf8')) as {
    views: Array<{
      defined_by_formula_id: string;
      defined_symbol?: string;
      name: string;
      canonical_concept_id?: string;
      formula_references?: Array<{ formula_id: string; symbol?: string }>;
    }>;
  };
  for (const formulaId of ['formula_A1.41', 'formula_A1.44']) {
    const view = appendix1.views.find((candidate) => viewRepresentsFormulaSymbol(candidate, formulaId, '\\bar{t}'));
    assert.ok(view, `appendix1 ${formulaId} should retain a concept view`);
    assert.ok(viewRepresentsFormulaSymbol(view, formulaId, '\\bar{t}'));
    assert.equal(view.canonical_concept_id, 'canonical_appendix1_time_to_fixation');
    assert.notEqual(view.name, 'T-bar&');
  }
});

test('concept navigation covers every real concept view in each public chapter', async () => {
  const index = JSON.parse(await readFile(path.join(conceptDir, 'concept_search_index.json'), 'utf8')) as {
    chapters: Array<{
      chapter_id: string;
      concept_root_ids: string[];
      concept_root_view_ids?: string[];
      concept_navigation: Array<{ concept_id: string; view_id?: string; prerequisite_view_ids?: string[]; prerequisite_concept_ids: string[]; depth: number; order: number }>;
    }>;
  };
  const chapterNav = new Map(index.chapters.map((chapter) => [chapter.chapter_id, chapter]));
  const files = (await readdir(conceptDir)).filter((file) => file.endsWith('_concept_graph.json'));

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(conceptDir, file), 'utf8')) as {
      chapter_id: string;
      views: Array<{ concept_id: string; view_id?: string; prerequisite_concepts?: Array<{ concept_id: string; view_id?: string }> }>;
    };
    const nav = chapterNav.get(graph.chapter_id);
    assert.ok(nav, `${graph.chapter_id} missing concept navigation`);
    assert.equal(nav.concept_navigation.length, graph.views.length, `${graph.chapter_id} concept navigation should cover all real views`);
    const viewIds = new Set(graph.views.map((view) => view.view_id || view.concept_id));
    const navIds = new Set(nav.concept_navigation.map((entry) => entry.view_id || entry.concept_id));
    assert.deepEqual(navIds, viewIds, `${graph.chapter_id} navigation ids should match graph views`);
    for (const rootId of nav.concept_root_view_ids || []) {
      const entry = nav.concept_navigation.find((item) => (item.view_id || item.concept_id) === rootId);
      assert.ok(entry);
      assert.equal((entry.prerequisite_view_ids || []).length, 0, `${graph.chapter_id} root ${rootId} has prerequisites`);
    }
  }
});

test('public formula dependencies stay chapter-local in the current graph release', async () => {
  const files = (await readdir(dependencyDir)).filter((file) => file.endsWith('_dependencies.json'));
  let edgeCount = 0;

  for (const file of files) {
    const graph = JSON.parse(await readFile(path.join(dependencyDir, file), 'utf8')) as {
      chapter_id: string;
      dependencies?: Array<{
        dependent_id: string;
        prerequisites?: Array<{ target_id: string; cross_chapter?: boolean; target_chapter_id?: string }>;
      }>;
    };
    for (const dependency of graph.dependencies || []) {
      for (const prerequisite of dependency.prerequisites || []) {
        edgeCount += 1;
        assert.equal(
          prerequisite.cross_chapter === true || prerequisite.target_chapter_id !== undefined,
          false,
          `${graph.chapter_id} ${dependency.dependent_id} has cross-chapter prerequisite ${prerequisite.target_id}`,
        );
      }
    }
  }

  assert.ok(edgeCount > 1000, 'dependency graph should remain populated while chapter-local');
});

test('auto canonical concept provenance is limited to same-chapter same-subsection symbol clusters', async () => {
  const dependencyFiles = (await readdir(dependencyDir)).filter((file) => file.endsWith('_dependencies.json'));
  const clusterBySenseId = new Map<string, {
    chapter_id: string;
    subsection?: string;
    canonical_symbol?: string;
    merge_basis?: string;
    member_sense_ids?: string[];
    member_formula_ids?: string[];
    formulaSubsections: Map<string, string>;
  }>();

  for (const file of dependencyFiles) {
    const graph = JSON.parse(await readFile(path.join(dependencyDir, file), 'utf8')) as {
      chapter_id: string;
      formulas?: Array<{ id: string; subsection?: string }>;
      symbol_sense_clusters?: Array<{
        canonical_sense_id: string;
        chapter_id: string;
        subsection?: string;
        canonical_symbol?: string;
        merge_basis?: string;
        member_sense_ids?: string[];
        member_formula_ids?: string[];
      }>;
    };
    const formulaSubsections = new Map((graph.formulas || []).map((formula) => [formula.id, String(formula.subsection || '').trim().toLowerCase()]));
    for (const cluster of graph.symbol_sense_clusters || []) {
      clusterBySenseId.set(cluster.canonical_sense_id, {
        ...cluster,
        formulaSubsections,
      });
    }
  }

  const reviewFiles = (await readdir(reviewDir)).filter((file) => file.endsWith('_symbol_concept_map.json'));
  let autoCanonicalEntries = 0;

  for (const file of reviewFiles) {
    const payload = JSON.parse(await readFile(path.join(reviewDir, file), 'utf8')) as {
      chapter_id: string;
      symbol_concepts?: Array<{
        formula_id: string;
        symbol: string;
        canonical_sense_id?: string;
        canonical_merge_basis?: string;
      }>;
    };
    for (const concept of payload.symbol_concepts || []) {
      if (concept.canonical_merge_basis !== 'same_chapter_subsection_canonical_symbol') continue;
      autoCanonicalEntries += 1;
      assert.ok(concept.canonical_sense_id, `${payload.chapter_id} ${concept.formula_id} missing canonical_sense_id`);
      const cluster = clusterBySenseId.get(concept.canonical_sense_id);
      assert.ok(cluster, `${payload.chapter_id} references unknown cluster ${concept.canonical_sense_id}`);
      assert.equal(cluster.chapter_id, payload.chapter_id, `${payload.chapter_id} canonical cluster crosses chapter boundary`);
      assert.equal(cluster.merge_basis, 'same_chapter_subsection_canonical_symbol');
      assert.ok((cluster.member_sense_ids || []).length > 1, `${payload.chapter_id} canonical cluster should not be single-member`);
      assert.equal(
        /^[A-Za-z]$/.test(cluster.canonical_symbol || '') && !SAFE_SINGLE_LETTER_CANONICAL_SYMBOLS.has(cluster.canonical_symbol || ''),
        false,
        `${payload.chapter_id} unsafe single-letter cluster ${cluster.canonical_symbol}`,
      );
      const conceptSenseKey = `${concept.formula_id}::${symbolKey(concept.symbol)}`;
      const clusterSenseKeys = new Set((cluster.member_sense_ids || [])
        .map(splitSenseId)
        .filter(Boolean)
        .map((sense) => `${sense!.formula_id}::${symbolKey(sense!.symbol)}`));
      assert.ok(clusterSenseKeys.has(conceptSenseKey), `${payload.chapter_id} ${concept.formula_id}::${concept.symbol} is not a member of its cluster`);
      const clusterSubsection = String(cluster.subsection || '').trim().toLowerCase();
      assert.ok(clusterSubsection, `${payload.chapter_id} cluster missing subsection`);
      for (const formulaId of cluster.member_formula_ids || []) {
        assert.equal(
          cluster.formulaSubsections.get(formulaId),
          clusterSubsection,
          `${payload.chapter_id} cluster ${concept.canonical_sense_id} spans subsections`,
        );
      }
    }
  }

  assert.ok(autoCanonicalEntries > 100, 'same-section symbol clusters should annotate canonical concept provenance');
});
