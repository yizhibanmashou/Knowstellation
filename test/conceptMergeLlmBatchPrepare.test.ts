import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('prepare-concept-merge-llm-batches creates unresolved merge review tasks', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-llm-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-merge-llm-batches.mjs'),
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--chapter',
      'chapter_test',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.merge_group_tasks, 1);
    assert.equal(manifest.counts.model_tasks, 1);
    assert.equal(manifest.counts.member_decisions_requested, 2);

    const batch = JSON.parse((await readFile(path.join(outputDir, 'merge_batch_0001_generic.jsonl'), 'utf8')).trim());
    assert.equal(batch.custom_id, 'chapter_test_merge_0001');
    assert.equal(batch.input.members.length, 2);
    assert.equal(batch.input.members[0].stable_key, 'chapter_test::formula_1::used::N');
    assert.equal(batch.output_schema.required.includes('member_decisions'), true);
    assert.match(batch.prompt, /candidate duplicate concepts/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-merge-llm-batches shards large merge groups without dropping members', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-shards-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  await mkdir(inputDir, { recursive: true });
  const formulaIds = ['formula_1', 'formula_2', 'formula_3', 'formula_4', 'formula_5'];
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: formulaIds.map((formulaId) => concept(formulaId, 'N', 'Population Size')),
    }),
    'utf8',
  );
  await writeFile(
    candidatesPath,
    JSON.stringify({
      chapters: {
        chapter_test: {
          groups: [
            group('chapter_test_merge_big', formulaIds, 'N', 'canonical_population_size', 'Population Size'),
          ],
        },
      },
    }),
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-merge-llm-batches.mjs'),
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--chapter',
      'chapter_test',
      '--max-members-per-task',
      '2',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.merge_group_tasks, 1);
    assert.equal(manifest.counts.model_tasks, 3);
    assert.equal(manifest.counts.member_decisions_requested, 5);

    const lines = (await readFile(path.join(outputDir, 'merge_batch_0001_generic.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(lines[0].custom_id, 'chapter_test_merge_big__part_0001');
    assert.equal(lines[1].custom_id, 'chapter_test_merge_big__part_0002');
    assert.equal(lines[2].custom_id, 'chapter_test_merge_big__part_0003');
    assert.equal(lines[0].input.part_count, 3);
    assert.equal(lines[0].input.total_unresolved_members, 5);
    assert.equal(lines[2].input.members.length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-merge-llm-batches can emit OpenAI Responses batch lines', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-openai-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-merge-llm-batches.mjs'),
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--chapter',
      'chapter_test',
      '--format',
      'openai-responses',
      '--model',
      'gpt-5-mini',
    ]);

    const batch = JSON.parse((await readFile(path.join(outputDir, 'merge_batch_0001_openai-responses.jsonl'), 'utf8')).trim());
    assert.equal(batch.method, 'POST');
    assert.equal(batch.url, '/v1/responses');
    assert.equal(batch.body.model, 'gpt-5-mini');
    assert.equal(batch.body.text.format.name, 'concept_merge_decision');
    assert.match(batch.body.input[1].content, /review_canonical_concept_merge/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-merge-llm-batches can prepare retry queue tasks', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-retry-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  const retryQueuePath = path.join(tempDir, 'llm_merge_retry_queue.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);
  await writeFile(
    retryQueuePath,
    JSON.stringify({
      custom_id: 'chapter_test_merge_0001__retry_1',
      task_id: 'chapter_test_merge_0001__retry_1',
      source_queue_type: 'retry',
      retry_attempt: 1,
      group_id: 'chapter_test_merge_0001',
      chapter_id: 'chapter_test',
      input: {
        task_id: 'chapter_test_merge_0001__retry_1',
        group_id: 'chapter_test_merge_0001',
        retry_attempt: 1,
        chapter_id: 'chapter_test',
        previous_rejection: {
          reasons: ['low_confidence'],
          raw_result: { confidence: 0.5 },
        },
        members: [
          member('formula_1', 'N', 'Population Size'),
          member('formula_2', 'N', 'Population Size'),
        ],
      },
      prompt: 'retry prompt',
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-merge-llm-batches.mjs'),
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--retry-queue',
      retryQueuePath,
      '--queue-type',
      'retry',
      '--chapter',
      'chapter_test',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.source.queue_type, 'retry');
    assert.equal(manifest.counts.model_tasks, 1);
    assert.equal(manifest.counts.member_decisions_requested, 2);

    const batch = JSON.parse((await readFile(path.join(outputDir, 'merge_batch_0001_generic.jsonl'), 'utf8')).trim());
    assert.equal(batch.custom_id, 'chapter_test_merge_0001__retry_1');
    assert.equal(batch.source_queue_type, 'retry');
    assert.equal(batch.retry_attempt, 1);
    assert.equal(batch.input.previous_rejection.reasons[0], 'low_confidence');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-merge-llm-batches lets retry records replace unresolved records for the same group', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-merge-retry-dedupe-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const candidatesPath = path.join(inputDir, 'concept_merge_candidates.json');
  const retryQueuePath = path.join(tempDir, 'llm_merge_retry_queue.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeFixtures(inputDir, candidatesPath);
  await writeFile(
    retryQueuePath,
    JSON.stringify({
      custom_id: 'chapter_test_merge_0001__retry_1',
      task_id: 'chapter_test_merge_0001__retry_1',
      source_queue_type: 'retry',
      retry_attempt: 1,
      group_id: 'chapter_test_merge_0001',
      chapter_id: 'chapter_test',
      input: {
        task_id: 'chapter_test_merge_0001__retry_1',
        group_id: 'chapter_test_merge_0001',
        retry_attempt: 1,
        chapter_id: 'chapter_test',
        previous_rejection: { reasons: ['low_confidence'], raw_result: {} },
        members: [
          member('formula_1', 'N', 'Population Size'),
          member('formula_2', 'N', 'Population Size'),
        ],
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-merge-llm-batches.mjs'),
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--candidates',
      candidatesPath,
      '--retry-queue',
      retryQueuePath,
      '--queue-type',
      'all',
      '--chapter',
      'chapter_test',
    ]);

    const lines = (await readFile(path.join(outputDir, 'merge_batch_0001_generic.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].custom_id, 'chapter_test_merge_0001__retry_1');
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
        {
          ...concept('formula_3', 'H', 'Heterozygosity'),
          canonical_concept_id: 'canonical_heterozygosity',
          canonical_concept_name: 'Heterozygosity',
        },
        {
          ...concept('formula_4', 'H', 'Heterozygosity'),
          canonical_concept_id: 'canonical_heterozygosity',
          canonical_concept_name: 'Heterozygosity',
        },
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
            group('chapter_test_merge_0001', ['formula_1', 'formula_2'], 'N', 'canonical_population_size', 'Population Size'),
            group('chapter_test_merge_0002', ['formula_3', 'formula_4'], 'H', 'canonical_heterozygosity', 'Heterozygosity'),
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

function group(groupId: string, formulaIds: string[], symbol: string, canonicalId: string, canonicalName: string) {
  return {
    group_id: groupId,
    chapter_id: 'chapter_test',
    reasons: ['lexical_similarity'],
    score: 0.91,
    review_priority: 'medium',
    canonical_candidate: {
      concept_id: canonicalId,
      concept_name: canonicalName,
      concept_type: 'quantity_concept',
      definition: `${canonicalName} definition.`,
      confidence: 0.9,
    },
    member_keys: formulaIds.map((formulaId) => `chapter_test::${formulaId}::used::${symbol}`),
  };
}

function member(formulaId: string, symbol: string, conceptName: string) {
  return {
    stable_key: `chapter_test::${formulaId}::used::${symbol}`,
    concept_id: `concept_${formulaId}_used_${symbol}`,
    concept_name: conceptName,
    concept_type: 'quantity_concept',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role: 'used',
    definition: `${conceptName} definition.`,
    aliases: [symbol, conceptName],
    confidence: 0.88,
  };
}
