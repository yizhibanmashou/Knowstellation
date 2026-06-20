import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('apply-concept-merge-candidates writes safe canonical merge patches', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-apply-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'used', 'N', 'Population Size', 'quantity_concept'),
        concept('formula_2', 'used', 'N', 'Population Size', 'quantity_concept'),
        concept('formula_3', 'used', 'P', 'Probability', 'quantity_concept'),
        concept('formula_4', 'used', 'P', 'Probability', 'quantity_concept'),
      ],
    }),
    'utf8',
  );
  await writeFile(
    candidatesPath,
    JSON.stringify({
      chapters: {
        chapter_test: {
          groups: [
            mergeGroup('chapter_test_merge_0001', ['formula_1', 'formula_2'], 'Population Size', 'concept_formula_1_used_N', ['exact_normalized_name']),
            mergeGroup('chapter_test_merge_0002', ['formula_3', 'formula_4'], 'Probability', 'concept_formula_3_used_P', ['exact_normalized_name']),
          ],
        },
      },
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/apply-concept-merge-candidates.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
    ]);

    const patch = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_canonical_merge_patch.json'), 'utf8'));
    assert.equal(patch.entries.length, 2);
    assert.equal(patch.entries.every((entry: { canonical_concept_name: string }) => entry.canonical_concept_name === 'Population Size'), true);
    assert.equal(patch.entries.every((entry: { review_flags: string[] }) => entry.review_flags.includes('auto_canonical_merge')), true);

    const report = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_canonical_merge_report.json'), 'utf8'));
    assert.equal(report.eligible_groups, 1);
    assert.equal(report.skipped_reasons.generic_canonical_name, 1);

    const unchangedMap = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    assert.equal(unchangedMap.symbol_concepts[0].canonical_concept_id, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('apply-concept-merge-candidates can apply canonical metadata to symbol maps', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-apply-map-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'used', 'N', 'Population Size', 'quantity_concept'),
        concept('formula_2', 'used', 'N', 'Population Size', 'quantity_concept'),
      ],
    }),
    'utf8',
  );
  await writeFile(
    candidatesPath,
    JSON.stringify({
      chapters: {
        chapter_test: {
          groups: [
            mergeGroup('chapter_test_merge_0001', ['formula_1', 'formula_2'], 'Population Size', 'concept_formula_1_used_N', ['exact_normalized_name']),
          ],
        },
      },
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/apply-concept-merge-candidates.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--apply',
    ]);

    const map = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    assert.equal(map.symbol_concepts[0].canonical_concept_id, 'concept_formula_1_used_N');
    assert.equal(map.symbol_concepts[1].canonical_concept_id, 'concept_formula_1_used_N');
    assert.equal(map.symbol_concepts[1].canonical_concept_name, 'Population Size');
    assert.ok(map.symbol_concepts[1].review_flags.includes('auto_canonical_merge'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function concept(
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  conceptName: string,
  conceptType: string,
) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role,
    concept_id: `concept_${formulaId}_${role}_${symbol}`,
    concept_name: conceptName,
    concept_type: conceptType,
    definition: `${conceptName} definition.`,
    definition_zh: `${conceptName} definition zh.`,
    aliases: [symbol, conceptName],
    evidence: [],
    confidence: 0.88,
    review_status: 'unreviewed',
    review_flags: [],
    extraction_model: 'test',
  };
}

function mergeGroup(
  groupId: string,
  formulaIds: string[],
  conceptName: string,
  canonicalConceptId: string,
  reasons: string[],
) {
  const symbol = conceptName === 'Probability' ? 'P' : 'N';
  return {
    group_id: groupId,
    reasons,
    score: 1,
    canonical_candidate: {
      stable_key: `chapter_test::${formulaIds[0]}::used::${symbol}`,
      concept_id: canonicalConceptId,
      concept_name: conceptName,
      concept_type: 'quantity_concept',
    },
    member_keys: formulaIds.map((formulaId) => `chapter_test::${formulaId}::used::${symbol}`),
  };
}
