import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('prepare-concept-llm-batches writes generic task files and manifest', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-batches-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    [
      JSON.stringify(queueItem('formula_1', 'P', 'Probability')),
      JSON.stringify(queueItem('formula_2', 'N', 'Population Size')),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--batch-size',
      '1',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.queue_items, 2);
    assert.equal(manifest.counts.batches, 2);
    assert.equal(manifest.source.format, 'generic');

    const firstBatch = await readFile(path.join(outputDir, 'batch_0001_generic.jsonl'), 'utf8');
    const firstTask = JSON.parse(firstBatch.trim());
    assert.equal(firstTask.custom_id, 'chapter_test::formula_1::defined::P');
    assert.equal(firstTask.chapter_id, 'chapter_test');
    assert.equal(firstTask.output_schema.required.includes('concept_name'), true);
    assert.match(firstTask.prompt, /repairing a symbol-to-concept map/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches can emit OpenAI Responses batch lines', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-openai-batch-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    JSON.stringify(queueItem('formula_1', 'P', 'Probability')) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--format',
      'openai-responses',
      '--model',
      'gpt-5-mini',
    ]);

    const batch = JSON.parse((await readFile(path.join(outputDir, 'batch_0001_openai-responses.jsonl'), 'utf8')).trim());
    assert.equal(batch.method, 'POST');
    assert.equal(batch.url, '/v1/responses');
    assert.equal(batch.body.model, 'gpt-5-mini');
    assert.equal(batch.body.text.format.type, 'json_schema');
    assert.equal(batch.body.text.format.strict, true);
    assert.match(batch.body.input[1].content, /chapter_test::formula_1::defined::P/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches can collapse repeated work into cohort tasks', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-cohort-batches-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    [
      JSON.stringify(queueItem('formula_1', 'P', 'Probability')),
      JSON.stringify(queueItem('formula_2', 'P', 'Probability')),
      JSON.stringify(queueItem('formula_3', 'N', 'Population Size')),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--cohort',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.queue_items, 3);
    assert.equal(manifest.counts.model_tasks, 2);
    assert.equal(manifest.counts.cohort_mode, true);
    assert.equal(manifest.cohorts.some((cohort: { entries: number }) => cohort.entries === 2), true);

    const batchLines = (await readFile(path.join(outputDir, 'batch_0001_generic.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(batchLines.length, 2);
    assert.equal(batchLines[0].custom_id.startsWith('cohort_'), true);
    assert.equal(batchLines[0].cohort_members.length, 2);
    assert.equal(batchLines[0].cohort_members[0].retry_attempt, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches keeps generic defined concepts context-sensitive in cohort mode', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-context-cohort-batches-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    [
      JSON.stringify(queueItem('formula_1', 'P', 'Probability', 0, 'Allele frequency changes under selection.')),
      JSON.stringify(queueItem('formula_2', 'P', 'Probability', 0, 'Allele frequency changes under selection.')),
      JSON.stringify(queueItem('formula_3', 'P', 'Probability', 0, 'Bayes posterior probability conditions on observed data.')),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--cohort',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.queue_items, 3);
    assert.equal(manifest.counts.model_tasks, 2);
    assert.equal(manifest.cohorts.some((cohort: { entries: number }) => cohort.entries === 2), true);
    assert.equal(manifest.cohorts.some((cohort: { cohort_key: string }) => cohort.cohort_key.includes('context:allele-frequency-changes-under-selection')), true);
    assert.equal(manifest.cohorts.some((cohort: { cohort_key: string }) => cohort.cohort_key.includes('context:bayes-posterior-probability-conditions-observed-data')), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches cohorts equivalent LaTeX symbol spellings', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-symbol-normalized-cohort-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    [
      JSON.stringify(queueItem('formula_1', 'x_i', 'State Probability', 0, 'State probability in a Markov chain.')),
      JSON.stringify(queueItem('formula_2', 'x_{i}', 'State Probability', 0, 'State probability in a Markov chain.')),
      JSON.stringify(queueItem('formula_3', '\\bar{\\imath}', 'Imath-bar', 0, 'Mean index term.')),
      JSON.stringify(queueItem('formula_4', '\\overline{\\imath}', 'Imath-bar', 0, 'Mean index term.')),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--cohort',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.queue_items, 4);
    assert.equal(manifest.counts.model_tasks, 2);
    assert.equal(manifest.cohorts.filter((cohort: { entries: number }) => cohort.entries === 2).length, 2);
    assert.equal(manifest.cohorts.some((cohort: { cohort_key: string }) => cohort.cohort_key.includes('x_i')), true);
    assert.equal(manifest.cohorts.some((cohort: { cohort_key: string }) => cohort.cohort_key.includes('\\overline{\\imath}')), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches can prepare retry queue files', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-retry-batches-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    JSON.stringify(queueItem('formula_1', 'P', 'Probability')) + '\n',
    'utf8',
  );
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_retry_queue.jsonl'),
    JSON.stringify(queueItem('formula_retry', 'X', 'X', 1)) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--queue-type',
      'retry',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.source.queue_type, 'retry');
    assert.equal(manifest.counts.queue_items, 1);
    assert.equal(manifest.source.input_files.some((file: string) => file.endsWith('chapter_test_llm_retry_queue.jsonl')), true);

    const batch = JSON.parse((await readFile(path.join(outputDir, 'batch_0001_generic.jsonl'), 'utf8')).trim());
    assert.equal(batch.custom_id, 'chapter_test::formula_retry::defined::X');
    assert.equal(batch.input.retry_attempt, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches keeps retry attempts in cohort members', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-retry-cohort-batches-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_retry_queue.jsonl'),
    [
      JSON.stringify(queueItem('formula_retry_1', 'X', 'X', 1)),
      JSON.stringify(queueItem('formula_retry_2', 'X', 'X', 2)),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--queue-type',
      'retry',
      '--cohort',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.queue_items, 2);
    assert.equal(manifest.counts.model_tasks, 1);
    assert.deepEqual(
      manifest.cohorts[0].members.map((member: { retry_attempt: number }) => member.retry_attempt),
      [1, 2],
    );

    const batch = JSON.parse((await readFile(path.join(outputDir, 'batch_0001_generic.jsonl'), 'utf8')).trim());
    assert.deepEqual(
      batch.cohort_members.map((member: { retry_attempt: number }) => member.retry_attempt),
      [1, 2],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-concept-llm-batches dedupes all queues with retry taking precedence', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-all-queue-batches-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_queue.jsonl'),
    [
      JSON.stringify(queueItem('formula_1', 'P', 'Initial Probability')),
      JSON.stringify(queueItem('formula_2', 'N', 'Population Size')),
    ].join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(inputDir, 'chapter_test_llm_retry_queue.jsonl'),
    JSON.stringify(queueItem('formula_1', 'P', 'Retry Probability')) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/prepare-concept-llm-batches.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--queue-type',
      'all',
    ]);

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.source.queue_type, 'all');
    assert.equal(manifest.counts.raw_queue_items, 3);
    assert.equal(manifest.counts.queue_items, 2);
    assert.equal(manifest.counts.deduped_queue_items, 1);

    const batchLines = (await readFile(path.join(outputDir, 'batch_0001_generic.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const pTask = batchLines.find((line) => line.custom_id === 'chapter_test::formula_1::defined::P');
    assert.equal(pTask.source_queue_type, 'retry');
    assert.equal(pTask.input.current_candidate.concept_name, 'Retry Probability');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function queueItem(formulaId: string, symbol: string, conceptName: string, retryAttempt = 0, sourceSentence = '') {
  return {
    task_id: `chapter_test::${formulaId}::defined::${symbol}`,
    input: {
      chapter_id: 'chapter_test',
      formula_id: formulaId,
      formula_label: formulaId.replace('_', ' '),
      symbol,
      symbol_role: 'defined',
      current_candidate: {
        concept_id: `concept_${formulaId}_${symbol}`,
        concept_name: conceptName,
        concept_type: 'quantity_concept',
        definition: `${conceptName} is a local formula quantity.`,
        definition_zh: `${conceptName} 的中文定义。`,
        confidence: 0.68,
        review_flags: ['generic_defined_concept_name'],
      },
      evidence: [],
      source_sentence: sourceSentence,
      auto_fix_reasons: ['generic_defined_concept_name'],
      retry_attempt: retryAttempt,
      proposed_rule_patch: null,
    },
    output_schema: {
      type: 'object',
      required: ['formula_id', 'symbol', 'role', 'concept_name', 'concept_type', 'definition', 'confidence', 'review_status'],
      properties: {
        concept_name: { type: 'string' },
      },
    },
    prompt: 'You are repairing a symbol-to-concept map.',
  };
}
