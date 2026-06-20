import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

test('chapter 18 cumulative response concepts use textbook-calibrated names', async () => {
  const symbolMap = JSON.parse(await readFile(
    path.resolve('tmp/concept-review/chapter18_symbol_concept_map.json'),
    'utf8',
  ));
  const symbolConcepts = symbolMap.symbol_concepts as Array<{
    formula_id: string;
    role: 'defined' | 'used';
    symbol: string;
    concept_name: string;
    review_status?: string;
  }>;

  assertConcept(symbolConcepts, 'formula_18.25b', 'defined', 'R_{C}', 'Cumulative Response');
  assertConcept(symbolConcepts, 'formula_18.25b', 'used', 'c', 'Control Population');
  assertConcept(symbolConcepts, 'formula_18.25b', 'used', 's', 'Selected Population');
  assertConcept(symbolConcepts, 'formula_18.23a', 'defined', '\\overline{z}_{s,t}', 'Selected Population Mean Trait Value');
  assertConcept(symbolConcepts, 'formula_18.23b', 'defined', '\\overline{z}_{c,t}', 'Control Population Mean Trait Value');

  assert.equal(
    symbolConcepts.some((item) => item.formula_id === 'formula_18.25b' && item.role === 'defined' && item.symbol === 't'),
    false,
    'function argument t should not be promoted to a defined concept for R_C(t)',
  );
  assert.equal(
    symbolConcepts.some((item) => item.formula_id === 'formula_18.23a' && item.role === 'defined' && item.symbol === 's'),
    false,
    'selected-population subscript s should not be promoted to a defined concept for z-bar_{s,t}',
  );
  assert.equal(
    symbolConcepts.some((item) => item.formula_id === 'formula_18.23b' && item.role === 'defined' && item.symbol === 'c'),
    false,
    'control-population subscript c should not be promoted to a defined concept for z-bar_{c,t}',
  );
});

test('chapter 18 public concept view carries nested prerequisite concepts for local expansion', async () => {
  const graph = JSON.parse(await readFile(
    path.resolve('public/data/concept_graph/chapter18_concept_graph.json'),
    'utf8',
  ));
  const view = graph.views.find((item: {
    defined_by_formula_id: string;
    name: string;
    formula_references?: Array<{ formula_id: string }>;
  }) => (
    item.name === 'Cumulative Response'
    && (
      item.defined_by_formula_id === 'formula_18.25b'
      || (item.formula_references || []).some((reference) => reference.formula_id === 'formula_18.25b')
    )
  ));

  assert.ok(view, 'Cumulative Response view should be public after curated textbook calibration');
  assert.ok(
    view.prerequisite_concepts.some((item: { name: string }) => item.name === 'Selected Population Mean Trait Value'),
    'selected population mean should be a first-layer prerequisite',
  );
  assert.ok(
    view.prerequisite_concepts.some((item: { name: string }) => item.name === 'Control Population Mean Trait Value'),
    'control population mean should be a first-layer prerequisite',
  );
  assert.ok(
    view.prerequisite_concepts.some((item: { name: string; introduced_concepts?: Array<{ name: string }> }) => (
      item.name === 'Selected Population Mean Trait Value'
      && (item.introduced_concepts || []).some((nested) => nested.name === 'Selected Population')
    )),
    'selected population mean should carry real second-layer background concepts for same-view expansion',
  );
  assert.ok(
    view.prerequisite_concepts.some((item: { name: string; introduced_concepts?: Array<{ name: string }> }) => (
      item.name === 'Control Population Mean Trait Value'
      && (item.introduced_concepts || []).some((nested) => nested.name === 'Control Population')
    )),
    'control population mean should carry real second-layer background concepts for same-view expansion',
  );
});

function assertConcept(
  symbolConcepts: Array<{ formula_id: string; role: string; symbol: string; concept_name: string; review_status?: string }>,
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  expectedName: string,
) {
  const concept = symbolConcepts.find((item) => (
    item.formula_id === formulaId && item.role === role && item.symbol === symbol
  ));
  assert.ok(concept, `${formulaId} ${role} ${symbol} should exist`);
  assert.equal(concept.concept_name, expectedName);
}
