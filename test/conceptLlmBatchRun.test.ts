import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('run-concept-llm-batches validates OpenAI Responses JSONL in dry-run mode', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-run-dry-'));
  const batchPath = path.join(tempDir, 'batch_0001_openai-responses.jsonl');
  await writeFile(batchPath, JSON.stringify(openAiBatchTask('chapter_test::formula_1::defined::P')) + '\n', 'utf8');

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.resolve('scripts/run-concept-llm-batches.mjs'),
      '--batch-file',
      batchPath,
      '--dry-run',
    ]);

    assert.match(stdout, /Validated 1 OpenAI Responses tasks/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('run-concept-llm-batches writes batch-style output from a Responses API', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-run-'));
  const batchDir = path.join(tempDir, 'batches');
  const outputPath = path.join(tempDir, 'llm-output.jsonl');
  const batchPath = path.join(batchDir, 'batch_0001_openai-responses.jsonl');
  await mkdir(batchDir, { recursive: true });
  await writeFile(batchPath, JSON.stringify(openAiBatchTask('chapter_test::formula_1::defined::P')) + '\n', 'utf8');

  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      output_text: JSON.stringify({
        stable_key: 'chapter_test::formula_1::defined::P',
        formula_id: 'formula_1',
        symbol: 'P',
        role: 'defined',
        concept_name: 'Allele-Frequency Transition Probability',
        concept_type: 'quantity_concept',
        definition: 'The probability assigned to an allele-frequency transition.',
        confidence: 0.86,
        review_status: 'edited',
      }),
    }));
  });

  try {
    const apiUrl = await listen(server);
    await execFileAsync(process.execPath, [
      path.resolve('scripts/run-concept-llm-batches.mjs'),
      '--batch-file',
      batchPath,
      '--output',
      outputPath,
      '--api-url',
      apiUrl,
      '--api-key-env',
      'CONCEPT_TEST_API_KEY',
    ], {
      env: { ...process.env, CONCEPT_TEST_API_KEY: 'test-key' },
    });

    assert.equal(requests.length, 1);
    const output = JSON.parse((await readFile(outputPath, 'utf8')).trim());
    assert.equal(output.custom_id, 'chapter_test::formula_1::defined::P');
    assert.equal(output.response.status_code, 200);
    assert.match(output.response.body.output_text, /Allele-Frequency Transition Probability/);

    const summary = JSON.parse(await readFile(outputPath.replace(/\.jsonl$/i, '_summary.json'), 'utf8'));
    assert.equal(summary.counts.tasks, 1);
    assert.equal(summary.counts.succeeded, 1);
    assert.equal(summary.counts.failed, 0);
  } finally {
    await close(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('run-concept-llm-batches can call a chat-completions compatible API', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-run-chat-'));
  const outputPath = path.join(tempDir, 'llm-output.jsonl');
  const batchPath = path.join(tempDir, 'batch_0001_openai-responses.jsonl');
  await writeFile(batchPath, JSON.stringify(openAiBatchTask('chapter_test::formula_2::used::f_0')) + '\n', 'utf8');

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
            stable_key: 'chapter_test::formula_2::used::f_0',
            formula_id: 'formula_2',
            symbol: 'f_0',
            role: 'used',
            concept_name: 'Base-Population Inbreeding Coefficient',
            concept_type: 'quantity_concept',
            definition: 'The inbreeding coefficient assigned to the base population.',
            confidence: 0.84,
            review_status: 'edited',
          }),
        },
      }],
    }));
  });

  try {
    const apiUrl = await listen(server);
    await execFileAsync(process.execPath, [
      path.resolve('scripts/run-concept-llm-batches.mjs'),
      '--batch-file',
      batchPath,
      '--output',
      outputPath,
      '--api-url',
      apiUrl,
      '--api-key-env',
      'CONCEPT_TEST_API_KEY',
      '--api-format',
      'chat-completions',
      '--model',
      'deepseek-chat',
    ], {
      env: { ...process.env, CONCEPT_TEST_API_KEY: 'test-key' },
    });

    assert.equal(requests.length, 1);
    const request = requests[0] as { model?: string; messages?: Array<{ role: string; content: string }>; response_format?: { type?: string } };
    assert.equal(request.model, 'deepseek-chat');
    assert.equal(request.response_format?.type, 'json_object');
    assert.ok(request.messages?.some((message) => message.role === 'system'));
    assert.ok(request.messages?.some((message) => message.content.includes('chapter_test::formula_2::used::f_0')));

    const output = JSON.parse((await readFile(outputPath, 'utf8')).trim());
    assert.equal(output.custom_id, 'chapter_test::formula_2::used::f_0');
    assert.equal(output.response.status_code, 200);
    assert.equal(output.response.body.choices[0].message.content.includes('Base-Population Inbreeding Coefficient'), true);
  } finally {
    await close(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('run-concept-llm-batches can run requests concurrently while preserving output order', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'concept-llm-run-concurrent-'));
  const outputPath = path.join(tempDir, 'llm-output.jsonl');
  const batchPath = path.join(tempDir, 'batch_0001_openai-responses.jsonl');
  await writeFile(
    batchPath,
    [
      openAiBatchTask('chapter_test::formula_1::defined::P'),
      openAiBatchTask('chapter_test::formula_2::defined::P'),
      openAiBatchTask('chapter_test::formula_3::defined::P'),
    ].map((item) => JSON.stringify(item)).join('\n') + '\n',
    'utf8',
  );

  let inFlight = 0;
  let maxInFlight = 0;
  const server = createServer(async (request, response) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await new Promise((resolve) => setTimeout(resolve, 75));
    inFlight -= 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      output_text: JSON.stringify({
        stable_key: body.input?.[1]?.content?.match(/chapter_test::formula_\d::defined::P/)?.[0] || '',
        formula_id: 'formula_1',
        symbol: 'P',
        role: 'defined',
        concept_name: 'Allele-Frequency Transition Probability',
        concept_type: 'quantity_concept',
        definition: 'The probability assigned to an allele-frequency transition.',
        confidence: 0.86,
        review_status: 'edited',
      }),
    }));
  });

  try {
    const apiUrl = await listen(server);
    await execFileAsync(process.execPath, [
      path.resolve('scripts/run-concept-llm-batches.mjs'),
      '--batch-file',
      batchPath,
      '--output',
      outputPath,
      '--api-url',
      apiUrl,
      '--api-key-env',
      'CONCEPT_TEST_API_KEY',
      '--concurrency',
      '3',
    ], {
      env: { ...process.env, CONCEPT_TEST_API_KEY: 'test-key' },
    });

    assert.ok(maxInFlight > 1);
    const output = (await readFile(outputPath, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(output.map((item) => item.custom_id), [
      'chapter_test::formula_1::defined::P',
      'chapter_test::formula_2::defined::P',
      'chapter_test::formula_3::defined::P',
    ]);
  } finally {
    await close(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

function openAiBatchTask(customId: string) {
  return {
    custom_id: customId,
    method: 'POST',
    url: '/v1/responses',
    body: {
      model: 'gpt-5-mini',
      input: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: JSON.stringify({ stable_key: customId }) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'symbol_concept_repair',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['formula_id', 'symbol', 'role', 'concept_name', 'concept_type', 'definition', 'confidence', 'review_status'],
            properties: {
              formula_id: { type: 'string' },
              symbol: { type: 'string' },
              role: { enum: ['defined', 'used'] },
              concept_name: { type: 'string' },
              concept_type: { type: 'string' },
              definition: { type: 'string' },
              confidence: { type: 'number' },
              review_status: { type: 'string' },
            },
          },
        },
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
      resolve(`http://127.0.0.1:${address.port}/v1/responses`);
    });
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
