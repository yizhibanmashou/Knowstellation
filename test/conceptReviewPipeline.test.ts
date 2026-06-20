import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('concept-review-pipeline prepares rule patches and LLM batches without applying by default', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-review-pipeline-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const reportPath = path.join(tempDir, 'report.json');
  await mkdir(inputDir, { recursive: true });
  await writeConceptMap(inputDir, [
    concept('formula_1', 'defined', 'i', 'Index', ['index_like_defined_symbol']),
    concept('formula_2', 'defined', 'P', 'Probability', ['generic_defined_concept_name']),
  ]);

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/concept-review-pipeline.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--report',
      reportPath,
      '--batch-size',
      '1',
      '--no-cohort',
    ]);

    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.status, 'awaiting_llm_results');
    assert.equal(report.counts.rule_patch_entries, 1);
    assert.equal(report.counts.llm_initial_queue_entries, 1);
    assert.equal(report.automation_metrics.coverage.active_review_work_items, 2);
    assert.equal(report.automation_metrics.coverage.rules_first_resolution_rate, 0.5);
    assert.equal(report.automation_metrics.rule_patches.by_action.rule_rejected, 1);
    assert.equal(report.automation_metrics.llm_queue.by_flag.generic_defined_concept_name, 1);
    assert.match(report.next_step, /concept:review:run-llm/);

    const patch = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_auto_fix_patch.json'), 'utf8'));
    assert.equal(patch.entries.length, 1);
    assert.equal(patch.entries[0].review_status, 'rejected');

    const manifest = JSON.parse(await readFile(path.join(outputDir, 'llm_batches', 'manifest.json'), 'utf8'));
    assert.equal(manifest.counts.queue_items, 1);
    assert.equal(manifest.counts.batches, 1);

    const map = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    const indexConcept = map.symbol_concepts.find((item: { symbol: string }) => item.symbol === 'i');
    assert.equal(indexConcept.review_status, 'unreviewed');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('concept-review-pipeline imports validated LLM output and applies when requested', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-review-pipeline-apply-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const reportPath = path.join(tempDir, 'report.json');
  const llmOutput = path.join(tempDir, 'llm-output.jsonl');
  await mkdir(inputDir, { recursive: true });
  await writeConceptMap(inputDir, [
    concept('formula_1', 'defined', 'i', 'Index', ['index_like_defined_symbol']),
    concept('formula_2', 'defined', 'P', 'Probability', ['generic_defined_concept_name']),
  ]);
  await writeFile(
    llmOutput,
    JSON.stringify(batchResult('chapter_test::formula_2::defined::P', {
      formula_id: 'formula_2',
      symbol: 'P',
      role: 'defined',
      concept_name: 'Allele-Frequency Transition Probability',
      concept_type: 'quantity_concept',
      definition: 'The probability assigned to a transition between allele-frequency states.',
      definition_zh: 'The probability assigned to a transition between allele-frequency states.',
      confidence: 0.86,
      review_status: 'edited',
      review_flags: [],
      review_notes: 'LLM repaired a generic probability label.',
    })) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/concept-review-pipeline.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--report',
      reportPath,
      '--llm-output',
      llmOutput,
      '--apply',
      '--max-retry-cycles',
      '0',
    ]);

    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.status, 'llm_import_complete');
    assert.equal(report.counts.rule_patch_entries, 1);
    assert.equal(report.counts.llm_accepted_entries, 1);
    assert.equal(report.counts.llm_retry_queue_entries, 0);
    assert.equal(report.automation_metrics.coverage.automatically_resolved_items, 2);
    assert.equal(report.automation_metrics.coverage.automation_resolution_rate, 1);
    assert.equal(report.automation_metrics.rule_patches.by_action.llm_accepted, 1);
    assert.equal(report.automation_metrics.llm_rejected.total, 0);

    const map = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    const indexConcept = map.symbol_concepts.find((item: { symbol: string }) => item.symbol === 'i');
    const probability = map.symbol_concepts.find((item: { symbol: string }) => item.symbol === 'P');
    assert.equal(indexConcept.review_status, 'rejected');
    assert.equal(indexConcept.reviewed_by, 'auto_rule_fix');
    assert.equal(probability.concept_name, 'Allele-Frequency Transition Probability');
    assert.equal(probability.reviewed_by, 'auto_llm_fix');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('concept-review-pipeline can run repair batches through DeepSeek-compatible chat completions', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-review-pipeline-deepseek-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const reportPath = path.join(tempDir, 'report.json');
  await mkdir(inputDir, { recursive: true });
  await writeConceptMap(inputDir, [
    concept('formula_2', 'defined', 'P', 'Probability', ['generic_defined_concept_name']),
  ]);

  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            stable_key: 'chapter_test::formula_2::defined::P',
            formula_id: 'formula_2',
            symbol: 'P',
            role: 'defined',
            concept_name: 'allele-frequency transition probability',
            concept_type: 'quantity_concept',
            definition: 'The probability assigned to a transition between allele-frequency states.',
            definition_zh: 'The probability assigned to a transition between allele-frequency states.',
            confidence: 0.86,
            review_status: 'edited',
            review_flags: [],
            review_notes: 'DeepSeek repaired a generic probability label.',
          }),
        },
      }],
    }));
  });

  try {
    const apiUrl = await listen(server);
    await execFileAsync(process.execPath, [
      path.resolve('scripts/concept-review-pipeline.mjs'),
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--report',
      reportPath,
      '--run-llm',
      '--apply',
      '--max-retry-cycles',
      '0',
      '--api-format',
      'chat-completions',
      '--api-url',
      apiUrl,
      '--api-key-env',
      'CONCEPT_TEST_API_KEY',
    ], {
      env: { ...process.env, CONCEPT_TEST_API_KEY: 'test-key' },
    });

    const request = requests[0] as { model?: string; response_format?: { type?: string } };
    assert.equal(request.model, 'deepseek-chat');
    assert.equal(request.response_format?.type, 'json_object');

    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.source.llm_api_format, 'chat-completions');
    assert.equal(report.source.llm_model, 'deepseek-chat');
    assert.equal(report.counts.llm_accepted_entries, 1);
    assert.ok(report.stages.some((stage: { command?: string }) => stage.command?.includes('--api-format chat-completions')));

    const map = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    const probability = map.symbol_concepts.find((item: { symbol: string }) => item.symbol === 'P');
    assert.equal(probability.concept_name, 'Allele-Frequency Transition Probability');
    assert.equal(probability.reviewed_by, 'auto_llm_fix');
  } finally {
    await close(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function writeConceptMap(inputDir: string, concepts: Array<Record<string, unknown>>) {
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: concepts,
    }),
    'utf8',
  );
}

function concept(
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  conceptName: string,
  reviewFlags: string[],
) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    symbol,
    role,
    concept_id: `concept_chapter_test_${formulaId}_${role}_${symbol.replace(/[^a-z0-9]+/gi, '_')}`,
    concept_name: conceptName,
    concept_type: 'quantity_concept',
    definition: `${conceptName} is a local mathematical quantity.`,
    definition_zh: `${conceptName} 是由当前支撑公式引入的局部数学量。`,
    confidence: 0.6,
    review_status: 'unreviewed',
    review_flags: reviewFlags,
    evidence: [{ source: 'test' }],
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

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/chat/completions`);
    });
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
