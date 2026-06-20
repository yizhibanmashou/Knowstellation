import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('collect-concept-llm-results splits OpenAI-style batch outputs by chapter', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    [
      JSON.stringify(batchResult('chapter_test::formula_1::defined::P', {
        formula_id: 'formula_1',
        symbol: 'P',
        role: 'defined',
        concept_name: 'Allele-Frequency Transition Probability',
        concept_type: 'quantity_concept',
        definition: 'The probability assigned to an allele-frequency transition.',
        definition_zh: '等位基因频率状态转移的概率。',
        confidence: 0.86,
        review_status: 'edited',
      })),
      JSON.stringify({ custom_id: 'bad', response: { body: { output_text: 'not json' } } }),
    ].join('\n') + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].stable_key, 'chapter_test::formula_1::defined::P');
    assert.equal(results[0].concept_name, 'Allele-Frequency Transition Probability');

    const errors = JSON.parse(await readFile(path.join(outputDir, 'llm_result_parse_errors.json'), 'utf8'));
    assert.equal(errors.entries.length, 1);
    assert.equal(errors.entries[0].reason, 'invalid_model_json');

    const summary = JSON.parse(await readFile(path.join(outputDir, 'llm_result_collect_summary.json'), 'utf8'));
    assert.equal(summary.counts.parsed_results, 1);
    assert.equal(summary.counts.parse_errors, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results expands cohort outputs through a manifest', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-cohort-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const manifestPath = path.join(tempDir, 'manifest.json');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      cohorts: [
        {
          cohort_id: 'cohort_00001',
          members: [
            { stable_key: 'chapter_test::formula_1::defined::P', chapter_id: 'chapter_test', formula_id: 'formula_1', symbol: 'P', role: 'defined', retry_attempt: 1 },
            { stable_key: 'chapter_test::formula_2::defined::P', chapter_id: 'chapter_test', formula_id: 'formula_2', symbol: 'P', role: 'defined', retry_attempt: 2 },
          ],
        },
      ],
    }),
    'utf8',
  );
  await writeFile(
    inputPath,
    JSON.stringify(batchResult('cohort_00001', {
      formula_id: 'formula_1',
      symbol: 'P',
      role: 'defined',
      concept_name: 'Allele-Frequency Transition Probability',
      concept_type: 'quantity_concept',
      definition: 'The probability assigned to an allele-frequency transition.',
      confidence: 0.86,
      review_status: 'edited',
    })) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--manifest',
      manifestPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 2);
    assert.equal(results[0].stable_key, 'chapter_test::formula_1::defined::P');
    assert.equal(results[1].stable_key, 'chapter_test::formula_2::defined::P');
    assert.equal(results[1].formula_id, 'formula_2');
    assert.equal(results[0].retry_attempt, 1);
    assert.equal(results[1].retry_attempt, 2);
    assert.match(results[0].review_notes, /Expanded from LLM cohort cohort_00001/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results normalizes wrapped DeepSeek repair payloads', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-deepseek-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const manifestPath = path.join(tempDir, 'manifest.json');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      cohorts: [
        {
          cohort_id: 'cohort_00001',
          members: [
            { stable_key: 'chapter_test::formula_2::defined::p_{f}', chapter_id: 'chapter_test', formula_id: 'formula_2', symbol: 'p_{f}', role: 'defined', retry_attempt: 0 },
          ],
        },
      ],
    }),
    'utf8',
  );
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'cohort_00001',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'cohort_00001',
                task: 'repair_symbol_concept',
                output: {
                  stable_key: 'chapter_test::formula_2::defined::p_{f}',
                  status: 'edited',
                  edited_concept: {
                    concept_name: 'Fixation Probability',
                    concept_type: 'quantity_concept',
                    definition: 'The probability that an allele eventually becomes fixed.',
                    confidence: 0.9,
                    review_flags: [],
                  },
                  reasoning: 'The local evidence says this is a fixation probability.',
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--manifest',
      manifestPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].stable_key, 'chapter_test::formula_2::defined::p_{f}');
    assert.equal(results[0].concept_name, 'Fixation Probability');
    assert.equal(results[0].review_status, 'edited');
    assert.match(results[0].review_notes, /fixation probability/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results accepts DeepSeek output as the repair payload', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-deepseek-output-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'chapter_test::formula_3::defined::r^{2}',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'chapter_test::formula_3::defined::r^{2}',
                task: 'repair_symbol_concept',
                output: {
                  concept_id: 'concept_chapter_test_formula_3_defined_r_2',
                  concept_name: 'Squared allele-frequency correlation',
                  concept_type: 'quantity_concept',
                  definition: 'A squared correlation measure between allele frequencies at two loci.',
                  confidence: 0.93,
                  review_flags: [],
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].stable_key, 'chapter_test::formula_3::defined::r^{2}');
    assert.equal(results[0].formula_id, 'formula_3');
    assert.equal(results[0].symbol, 'r^{2}');
    assert.equal(results[0].role, 'defined');
    assert.equal(results[0].review_status, 'edited');
    assert.equal(results[0].concept_name, 'Squared allele-frequency correlation');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results accepts DeepSeek output.concept wrappers', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-deepseek-concept-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'chapter_test::formula_4::defined::\\mu',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'chapter_test::formula_4::defined::\\mu',
                task: 'repair_symbol_concept',
                output: {
                  decision: 'edited',
                  concept: {
                    concept_id: 'concept_chapter_test_formula_4_defined_mu',
                    concept_name: 'Trait mean',
                    concept_type: 'quantity_concept',
                    definition: 'The average value of a trait in the population.',
                    confidence: 0.88,
                    review_flags: ['weak_evidence'],
                  },
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].stable_key, 'chapter_test::formula_4::defined::\\mu');
    assert.equal(results[0].formula_id, 'formula_4');
    assert.equal(results[0].symbol, '\\mu');
    assert.equal(results[0].role, 'defined');
    assert.equal(results[0].review_status, 'edited');
    assert.equal(results[0].concept_name, 'Trait mean');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results preserves DeepSeek rejected decisions', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-deepseek-rejected-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'chapter_test::formula_5::defined::f_{0}',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'chapter_test::formula_5::defined::f_{0}',
                task: 'repair_symbol_concept',
                input: {
                  chapter_id: 'chapter_test',
                  formula_id: 'formula_5',
                  symbol: 'f_{0}',
                  symbol_role: 'defined',
                  current_candidate: {
                    concept_id: 'concept_chapter_test_formula_5_defined_f_0',
                    concept_name: 'Function',
                    concept_type: 'quantity_concept',
                    definition: 'A rule that maps inputs to outputs in the model.',
                    confidence: 0.92,
                    review_flags: ['weak_evidence'],
                  },
                },
                output: {
                  decision: 'rejected',
                  reason: 'The local evidence does not define f_0 as a concept.',
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].stable_key, 'chapter_test::formula_5::defined::f_{0}');
    assert.equal(results[0].formula_id, 'formula_5');
    assert.equal(results[0].symbol, 'f_{0}');
    assert.equal(results[0].role, 'defined');
    assert.equal(results[0].concept_name, 'Function');
    assert.equal(results[0].review_status, 'rejected');
    assert.match(results[0].review_notes, /does not define/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results accepts top-level DeepSeek edited payloads', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-deepseek-edited-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'chapter_test::formula_6::defined::h_{I}^{2}',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'chapter_test::formula_6::defined::h_{I}^{2}',
                input: {
                  chapter_id: 'chapter_test',
                  formula_id: 'formula_6',
                  symbol: 'h_{I}^{2}',
                  symbol_role: 'defined',
                  current_candidate: {
                    concept_name: 'Function',
                    concept_type: 'quantity_concept',
                    definition: 'A rule that maps inputs to outputs in the model.',
                  },
                },
                edited: {
                  concept_name: 'Index heritability',
                  concept_type: 'quantity_concept',
                  definition: 'The heritability of the selection index.',
                  confidence: 0.95,
                  review_flags: [],
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].concept_name, 'Index heritability');
    assert.equal(results[0].concept_type, 'quantity_concept');
    assert.equal(results[0].review_status, 'edited');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results fills concept_type from current candidate', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-deepseek-type-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'chapter_test::formula_7::defined::\\mu',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'chapter_test::formula_7::defined::\\mu',
                input: {
                  chapter_id: 'chapter_test',
                  formula_id: 'formula_7',
                  symbol: '\\mu',
                  symbol_role: 'defined',
                  current_candidate: {
                    concept_name: 'Mean',
                    concept_type: 'quantity_concept',
                    definition: 'The average value of a quantity.',
                  },
                },
                output: {
                  status: 'edited',
                  concept_name: 'Trait mean',
                  definition: 'The expected value or average of the trait.',
                  confidence: 0.95,
                  review_flags: [],
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].concept_name, 'Trait mean');
    assert.equal(results[0].concept_type, 'quantity_concept');
    assert.equal(results[0].review_status, 'edited');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collect-concept-llm-results maps dependency anchor tasks back to source concepts', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-anchor-collect-'));
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const outputDir = path.join(tempDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    inputPath,
    JSON.stringify({
      custom_id: 'anchor::chapter_test::formula_8::defined::n',
      response: {
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                stable_key: 'anchor::chapter_test::formula_8::defined::n',
                input: {
                  chapter_id: 'chapter_test',
                  formula_id: 'formula_8',
                  symbol: 'n',
                  symbol_role: 'used',
                  current_candidate: {
                    concept_id: 'concept_chapter_test_formula_8_used_n',
                    concept_name: 'Count',
                    concept_type: 'domain_concept',
                    definition: 'A discrete count.',
                  },
                },
                output: {
                  status: 'edited',
                  concept_name: 'Sample size',
                  concept_type: 'domain_concept',
                  definition: 'The number of sampled observations or individuals.',
                  confidence: 0.9,
                  review_flags: [],
                },
              }),
            },
          }],
        },
      },
    }) + '\n',
    'utf8',
  );

  try {
    await execFileAsync(process.execPath, [
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--output-dir',
      outputDir,
    ]);

    const results = (await readFile(path.join(outputDir, 'chapter_test_llm_results.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(results.length, 1);
    assert.equal(results[0].stable_key, 'chapter_test::formula_8::used::n');
    assert.equal(results[0].chapter_id, 'chapter_test');
    assert.equal(results[0].formula_id, 'formula_8');
    assert.equal(results[0].symbol, 'n');
    assert.equal(results[0].role, 'used');
    assert.equal(results[0].concept_name, 'Sample size');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('collected cohort outputs can be imported and applied to every expanded member', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-cohort-import-'));
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  const inputPath = path.join(tempDir, 'batch-output.jsonl');
  const manifestPath = path.join(tempDir, 'manifest.json');
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(inputDir, 'chapter_test_symbol_concept_map.json'),
    JSON.stringify({
      chapter_id: 'chapter_test',
      symbol_concepts: [
        concept('formula_1', 'defined', 'P', 'Probability'),
        concept('formula_2', 'defined', 'P', 'Probability'),
      ],
    }),
    'utf8',
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      cohorts: [
        {
          cohort_id: 'cohort_00001',
          members: [
            { stable_key: 'chapter_test::formula_1::defined::P', chapter_id: 'chapter_test', formula_id: 'formula_1', symbol: 'P', role: 'defined', retry_attempt: 0 },
            { stable_key: 'chapter_test::formula_2::defined::P', chapter_id: 'chapter_test', formula_id: 'formula_2', symbol: 'P', role: 'defined', retry_attempt: 0 },
          ],
        },
      ],
    }),
    'utf8',
  );
  await writeFile(
    inputPath,
    JSON.stringify(batchResult('cohort_00001', {
      formula_id: 'formula_1',
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
      path.resolve('scripts/collect-concept-llm-results.mjs'),
      '--input',
      inputPath,
      '--manifest',
      manifestPath,
      '--output-dir',
      outputDir,
    ]);
    await execFileAsync(process.execPath, [
      path.resolve('scripts/auto-fix-concept-review.mjs'),
      'import-llm-results',
      '--chapter',
      'chapter_test',
      '--input-dir',
      inputDir,
      '--output-dir',
      outputDir,
      '--input',
      path.join(outputDir, 'chapter_test_llm_results.jsonl'),
      '--apply',
    ]);

    const report = JSON.parse(await readFile(path.join(outputDir, 'chapter_test_llm_import_report.json'), 'utf8'));
    assert.equal(report.input_items, 2);
    assert.equal(report.accepted_entries, 2);
    assert.equal(report.rejected_entries, 0);

    const updatedMap = JSON.parse(await readFile(path.join(inputDir, 'chapter_test_symbol_concept_map.json'), 'utf8'));
    assert.deepEqual(
      updatedMap.symbol_concepts.map((item: { concept_name: string; reviewed_by?: string }) => [item.concept_name, item.reviewed_by]),
      [
        ['Allele-Frequency Transition Probability', 'auto_llm_fix'],
        ['Allele-Frequency Transition Probability', 'auto_llm_fix'],
      ],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

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

function concept(
  formulaId: string,
  role: 'defined' | 'used',
  symbol: string,
  conceptName: string,
) {
  return {
    chapter_id: 'chapter_test',
    formula_id: formulaId,
    formula_label: formulaId.replace('_', ' '),
    symbol,
    role,
    concept_id: `concept_${formulaId}_${role}_${symbol}`,
    concept_name: conceptName,
    concept_type: 'quantity_concept',
    definition: `${conceptName} definition.`,
    definition_zh: `${conceptName} definition.`,
    aliases: [],
    evidence: [],
    confidence: 0.65,
    review_status: 'unreviewed',
    review_flags: ['generic_defined_concept_name'],
    extraction_model: 'test',
  };
}
