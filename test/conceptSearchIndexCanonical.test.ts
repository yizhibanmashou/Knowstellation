import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('build-concept-search-index keeps one searchable entry per view with canonical metadata', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-search-canonical-'));
  const conceptDir = path.join(tempDir, 'concept_graph');
  const reviewDir = path.join(tempDir, 'review');
  await mkdir(conceptDir, { recursive: true });
  await mkdir(reviewDir, { recursive: true });

  await writeFile(
    path.join(conceptDir, 'chapter_test_concept_graph.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      views: [
        conceptView('concept_one', 'formula_1', 'Formula 1', 'N_{1}', 'Population Size'),
        conceptView('concept_two', 'formula_2', 'Formula 2', 'N_{2}', 'Population Size'),
        conceptView('concept_three', 'formula_3', 'Formula 3', 'H', 'Heterozygosity'),
      ],
    }),
    'utf8',
  );
  await writeFile(
    path.join(reviewDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        canonicalConcept('concept_one', 'formula_1', 'N_{1}', 'canonical_population_size', 'Population Size'),
        canonicalConcept('concept_two', 'formula_2', 'N_{2}', 'canonical_population_size', 'Population Size'),
      ],
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/build-concept-search-index.mjs'),
      conceptDir,
      '--review-dir',
      reviewDir,
    ]);

    const index = JSON.parse(await readFile(path.join(conceptDir, 'concept_search_index.json'), 'utf8'));
    const populationItems = index.items.filter((item: { canonical_concept_id?: string }) => item.canonical_concept_id === 'canonical_population_size');
    assert.equal(populationItems.length, 2);
    assert.deepEqual(populationItems.map((item: { view_id?: string }) => item.view_id).sort(), ['concept_one', 'concept_two']);
    assert.ok(populationItems.every((item: { occurrenceCount?: number }) => item.occurrenceCount === 2));
    assert.ok(populationItems.every((item: { viewOccurrenceCount?: number }) => item.viewOccurrenceCount === 1));
    assert.deepEqual(populationItems[0].relatedFormulaLabels, ['Formula 1', 'Formula 2']);
    assert.equal(index.items.filter((item: { title: string }) => item.title === 'Population Size').length, 2);

    const navEntries = index.chapters[0].concept_navigation.filter((entry: { canonical_concept_id?: string }) => entry.canonical_concept_id === 'canonical_population_size');
    assert.equal(navEntries.length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function conceptView(conceptId: string, formulaId: string, label: string, symbol: string, name: string) {
  return {
    chapter_id: 'chapter_test',
    concept_id: conceptId,
    name,
    definition: `${name} definition.`,
    concept_type: 'quantity_concept',
    defined_by_formula_id: formulaId,
    defined_symbol: symbol,
    supporting_formula_label: label,
    supporting_formula_latex: symbol,
    formula_position: Number(formulaId.replace(/\D+/g, '')),
    confidence: 0.9,
    evidence: [],
    prerequisite_concepts: [],
    introduced_concepts: [],
    edges: [],
  };
}

function canonicalConcept(
  conceptId: string,
  formulaId: string,
  symbol: string,
  canonicalId: string,
  canonicalName: string,
) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role: 'defined',
    concept_id: conceptId,
    concept_name: canonicalName,
    concept_type: 'quantity_concept',
    definition: `${canonicalName} definition.`,
    aliases: [symbol, canonicalName],
    evidence: [],
    confidence: 0.9,
    review_status: 'unreviewed',
    review_flags: ['auto_canonical_merge'],
    canonical_concept_id: canonicalId,
    canonical_concept_name: canonicalName,
  };
}
