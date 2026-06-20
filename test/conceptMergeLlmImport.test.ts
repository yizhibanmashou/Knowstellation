import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('import-concept-merge-llm-results validates and applies safe merge decisions', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-import-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  const resultsPath = path.join(tempDir, 'merge-results.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);
  await writeFile(
    resultsPath,
    JSON.stringify(batchResult('chapter_test_merge_0001', {
      group_id: 'chapter_test_merge_0001',
      decision: 'merge_all',
      canonical_concept_id: 'canonical_population_size',
      canonical_concept_name: 'Population Size',
      member_decisions: [
        { stable_key: 'chapter_test::formula_1::used::N', action: 'merge_to_canonical', reason: 'same named population size concept' },
        { stable_key: 'chapter_test::formula_2::used::N', action: 'merge_to_canonical', reason: 'same named population size concept' },
      ],
      confidence: 0.91,
      review_notes: 'Members refer to the same quantity.',
    })) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/import-concept-merge-llm-results.mjs'),
      '--input',
      resultsPath,
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--apply',
    ]);

    const summary = JSON.parse(await readFile(path.join(outputDir, 'llm_merge_import_summary.json'), 'utf8'));
    assert.equal(summary.counts.input_items, 1);
    assert.equal(summary.counts.accepted_entries, 2);
    assert.equal(summary.counts.rejected_results, 0);
    assert.equal(summary.counts.applied_entries, 2);

    const patch = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_llm_merge_patch.json'), 'utf8'));
    assert.equal(patch.entries.length, 2);
    assert.equal(patch.entries[0].canonical_concept_id, 'canonical_population_size');
    assert.ok(patch.entries[0].review_flags.includes('llm_canonical_merge'));

    const map = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    assert.equal(map.symbol_concepts[0].canonical_concept_id, 'canonical_population_size');
    assert.equal(map.symbol_concepts[1].canonical_concept_name, 'Population Size');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import-concept-merge-llm-results routes retryable and terminal rejects separately', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-import-reject-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  const resultsPath = path.join(tempDir, 'merge-results.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);
  await writeFile(
    resultsPath,
    [
      JSON.stringify(batchResult('chapter_test_merge_0001', {
        group_id: 'chapter_test_merge_0001',
        decision: 'merge_all',
        canonical_concept_id: 'canonical_population_size',
        canonical_concept_name: 'Population Size',
        member_decisions: [
          { stable_key: 'chapter_test::formula_missing::used::N', action: 'merge_to_canonical' },
        ],
        confidence: 0.9,
        review_notes: 'Bad stable key.',
      })),
      JSON.stringify(batchResult('chapter_test_merge_0001', {
        group_id: 'chapter_test_merge_0001',
        decision: 'merge_all',
        canonical_concept_id: 'canonical_population_size',
        canonical_concept_name: 'Population Size',
        member_decisions: [
          { stable_key: 'chapter_test::formula_1::used::N', action: 'merge_to_canonical' },
        ],
        confidence: 0.5,
        review_notes: 'Too uncertain.',
      })),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/import-concept-merge-llm-results.mjs'),
      '--input',
      resultsPath,
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
    ]);

    const summary = JSON.parse(await readFile(path.join(outputDir, 'llm_merge_import_summary.json'), 'utf8'));
    assert.equal(summary.counts.accepted_entries, 0);
    assert.equal(summary.counts.rejected_results, 2);
    assert.equal(summary.counts.retry_queue_entries, 1);
    assert.equal(summary.counts.human_review_queue_entries, 1);

    const retryQueue = (await readFile(path.join(outputDir, 'llm_merge_retry_queue.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(retryQueue.length, 1);
    assert.equal(retryQueue[0].retry_attempt, 1);
    assert.equal(retryQueue[0].input.previous_rejection.reasons.includes('low_confidence'), true);
    assert.match(retryQueue[0].prompt, /previous output failed validation/i);

    const humanQueue = JSON.parse(await readFile(path.join(outputDir, 'llm_merge_human_review_queue.json'), 'utf8'));
    assert.equal(humanQueue.entries.length, 1);
    assert.ok(humanQueue.entries.some((entry: { review_flags: string[] }) => entry.review_flags.includes('stable_key_not_in_group')));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('import-concept-merge-llm-results sends exhausted retry attempts to human fallback', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-import-exhausted-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  const resultsPath = path.join(tempDir, 'merge-results.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);
  await writeFile(
    resultsPath,
    JSON.stringify(batchResult('chapter_test_merge_0001__retry_2', {
      group_id: 'chapter_test_merge_0001',
      decision: 'merge_all',
      canonical_concept_id: 'canonical_population_size',
      canonical_concept_name: 'Population Size',
      member_decisions: [
        { stable_key: 'chapter_test::formula_1::used::N', action: 'merge_to_canonical' },
      ],
      confidence: 0.5,
      review_notes: 'Still too uncertain.',
    })) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/import-concept-merge-llm-results.mjs'),
      '--input',
      resultsPath,
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
    ]);

    const summary = JSON.parse(await readFile(path.join(outputDir, 'llm_merge_import_summary.json'), 'utf8'));
    assert.equal(summary.counts.retry_queue_entries, 0);
    assert.equal(summary.counts.human_review_queue_entries, 1);

    const humanQueue = JSON.parse(await readFile(path.join(outputDir, 'llm_merge_human_review_queue.json'), 'utf8'));
    assert.equal(humanQueue.entries[0].retry_attempt, undefined);
    assert.ok(humanQueue.entries[0].review_flags.includes('low_confidence'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function writeFixtures(inputDir: string, candidatesPath: string) {
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'N', 'Population Size'),
        concept('formula_2', 'N', 'Population Size'),
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
            {
              group_id: 'chapter_test_merge_0001',
              chapter_id: 'chapter_test',
              member_keys: [
                'chapter_test::formula_1::used::N',
                'chapter_test::formula_2::used::N',
              ],
              canonical_candidate: {
                concept_id: 'canonical_population_size',
                concept_name: 'Population Size',
              },
            },
          ],
        },
      },
    }),
    'utf8',
  );
}

function concept(formulaId: string, symbol: string, conceptName: string) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role: 'used',
    concept_id: `concept_${formulaId}_used_${symbol}`,
    concept_name: conceptName,
    concept_type: 'quantity_concept',
    definition: `${conceptName} definition.`,
    aliases: [symbol, conceptName],
    confidence: 0.88,
    review_status: 'unreviewed',
    review_flags: [],
  };
}

function batchResult(customId: string, payload: Record<string, unknown>) {
  return {
    custom_id: customId,
    response: {
      body: {
        output_text: JSON.stringify(payload),
      },
    },
  };
}
