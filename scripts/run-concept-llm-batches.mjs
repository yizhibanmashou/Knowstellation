#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_DIR = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix', 'llm_batches');
const DEFAULT_OUTPUT = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix', 'llm_batch_output.jsonl');
const DEFAULT_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY';
const DEFAULT_CHAT_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_CHAT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
const DEFAULT_CHAT_MODEL = 'deepseek-chat';
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 750;

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const apiFormat = options.apiFormat || 'responses';
  const apiKeyEnv = options.apiKeyEnv || (apiFormat === 'chat-completions' ? DEFAULT_CHAT_API_KEY_ENV : DEFAULT_API_KEY_ENV);
  const apiKey = process.env[apiKeyEnv] || '';
  const apiUrl = options.apiUrl || defaultApiUrl(apiFormat);
  if (!apiKey && !options.dryRun) {
    throw new Error(`Missing API key. Set ${apiKeyEnv}, or use --dry-run to validate inputs only.`);
  }

  const batchFiles = await resolveBatchFiles(options);
  if (!batchFiles.length) throw new Error('No OpenAI Responses batch files found.');

  const tasks = [];
  for (const filePath of batchFiles) {
    for (const task of await readJsonl(filePath)) {
      tasks.push(validateTask(task, filePath));
      if (options.maxItems && tasks.length >= options.maxItems) break;
    }
    if (options.maxItems && tasks.length >= options.maxItems) break;
  }

  if (options.dryRun) {
    console.log(`Validated ${tasks.length} ${apiFormatLabel(apiFormat)} tasks`);
    console.log(`  files: ${batchFiles.length}`);
    return;
  }

  const outputPath = path.resolve(process.cwd(), options.output || DEFAULT_OUTPUT);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const concurrency = positiveInteger(options.concurrency, 1, '--concurrency');
  const results = new Array(tasks.length);
  let succeeded = 0;
  let failed = 0;
  let completed = 0;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      const result = await runTask(task, {
        apiKey,
        apiUrl,
        apiFormat,
        model: options.model,
        retries: positiveInteger(options.retries, DEFAULT_RETRIES, '--retries'),
        retryDelayMs: positiveInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS, '--retry-delay-ms'),
      });
      if (result.error) failed += 1;
      else succeeded += 1;
      results[index] = JSON.stringify(result);
      completed += 1;
      if (options.progress && (completed % options.progress === 0 || completed === tasks.length)) {
        console.log(`  progress: ${completed}/${tasks.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

  await writeFile(outputPath, results.join('\n') + (results.length ? '\n' : ''), 'utf8');
  const summaryPath = outputPath.replace(/\.jsonl$/i, '_summary.json');
  await writeJson(summaryPath, {
    generated_at: utcNow(),
    source: {
      batch_files: batchFiles.map(relative),
      output: relative(outputPath),
      api_url: redactedApiUrl(apiUrl),
      api_format: apiFormat,
      api_key_env: apiKeyEnv,
      concurrency,
    },
    counts: {
      tasks: tasks.length,
      succeeded,
      failed,
    },
    next_step: 'npm run concept:review:collect-llm -- --input <this output jsonl> --manifest <batch manifest>',
  });

  console.log(`Ran ${tasks.length} concept LLM repair tasks`);
  console.log(`  succeeded: ${succeeded}`);
  console.log(`  failed: ${failed}`);
  console.log(`  output: ${relative(outputPath)}`);
  console.log(`  summary: ${relative(summaryPath)}`);
}

async function resolveBatchFiles(options) {
  if (options.batchFile?.length) {
    return options.batchFile.map((value) => path.resolve(process.cwd(), value));
  }

  if (options.manifest) {
    const manifestPath = path.resolve(process.cwd(), options.manifest);
    const manifest = JSON.parse(stripBom(await readFile(manifestPath, 'utf8')));
    return (manifest.files || [])
      .map((file) => file.path)
      .filter(Boolean)
      .filter((file) => /openai-responses\.jsonl$/i.test(file))
      .map(resolveManifestPath);
  }

  const inputDir = path.resolve(process.cwd(), options.inputDir || DEFAULT_INPUT_DIR);
  const files = await readdir(inputDir);
  return files
    .filter((file) => /openai-responses\.jsonl$/i.test(file))
    .sort()
    .map((file) => path.join(inputDir, file));
}

function resolveManifestPath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(ROOT, filePath);
}

function validateTask(task, filePath) {
  if (!isRecord(task)) throw new Error(`Invalid JSONL task in ${relative(filePath)}: task is not an object`);
  if (!task.custom_id) throw new Error(`Invalid JSONL task in ${relative(filePath)}: missing custom_id`);
  if (task.method !== 'POST') throw new Error(`Invalid task ${task.custom_id}: method must be POST`);
  if (task.url !== '/v1/responses') throw new Error(`Invalid task ${task.custom_id}: only /v1/responses is supported`);
  if (!isRecord(task.body)) throw new Error(`Invalid task ${task.custom_id}: missing body`);
  return task;
}

async function runTask(task, options) {
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(options.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(requestBodyForTask(task, options)),
      });
      const body = await parseResponseBody(response);
      if (response.ok) {
        return {
          custom_id: task.custom_id,
          response: {
            status_code: response.status,
            body,
          },
        };
      }

      if (!shouldRetryStatus(response.status) || attempt >= options.retries) {
        return {
          custom_id: task.custom_id,
          error: {
            type: 'http_error',
            status_code: response.status,
            message: errorMessageFromBody(body) || response.statusText,
            body,
          },
        };
      }
    } catch (error) {
      if (attempt >= options.retries) {
        return {
          custom_id: task.custom_id,
          error: {
            type: 'request_error',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    await sleep(options.retryDelayMs * (attempt + 1));
  }

  return {
    custom_id: task.custom_id,
    error: {
      type: 'unknown_error',
      message: 'Request failed without a terminal result.',
    },
  };
}

function requestBodyForTask(task, options) {
  if (options.apiFormat === 'chat-completions') return chatCompletionBodyForResponsesTask(task, options);
  return task.body;
}

function chatCompletionBodyForResponsesTask(task, options) {
  const messages = (task.body?.input || []).map((message) => ({
    role: message.role === 'system' ? 'system' : message.role === 'assistant' ? 'assistant' : 'user',
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
  }));
  return {
    model: options.model || task.body?.model || DEFAULT_CHAT_MODEL,
    temperature: Number.isFinite(task.body?.temperature) ? task.body.temperature : 0.15,
    response_format: { type: 'json_object' },
    messages: [
      ...messages,
      {
        role: 'user',
        content: 'Return only one valid JSON object matching the requested schema. Do not wrap it in Markdown.',
      },
    ],
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { output_text: text };
  }
}

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function errorMessageFromBody(body) {
  if (!isRecord(body)) return '';
  const error = body.error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (typeof body.message === 'string') return body.message;
  return '';
}

async function readJsonl(filePath) {
  await access(filePath);
  return stripBom(await readFile(filePath, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--manifest') options.manifest = args[++index];
    else if (arg === '--batch-file') {
      if (!options.batchFile) options.batchFile = [];
      options.batchFile.push(args[++index]);
    } else if (arg === '--output') options.output = args[++index];
    else if (arg === '--api-url') options.apiUrl = args[++index];
    else if (arg === '--api-key-env') options.apiKeyEnv = args[++index];
    else if (arg === '--api-format') options.apiFormat = parseApiFormat(args[++index]);
    else if (arg === '--model') options.model = args[++index];
    else if (arg === '--max-items') options.maxItems = positiveInteger(args[++index], undefined, '--max-items');
    else if (arg === '--retries') options.retries = args[++index];
    else if (arg === '--retry-delay-ms') options.retryDelayMs = args[++index];
    else if (arg === '--concurrency') options.concurrency = args[++index];
    else if (arg === '--progress') options.progress = positiveInteger(args[++index], undefined, '--progress');
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function parseApiFormat(value) {
  if (value === 'responses' || value === 'chat-completions') return value;
  throw new Error('--api-format must be responses or chat-completions');
}

function apiFormatLabel(apiFormat) {
  return apiFormat === 'responses' ? 'OpenAI Responses' : apiFormat;
}

function positiveInteger(value, fallback, optionName) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${optionName} must be a non-negative integer`);
  return number;
}

function redactedApiUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function defaultApiUrl(apiFormat) {
  if (apiFormat !== 'chat-completions') return DEFAULT_API_URL;
  const base = process.env.DEEPSEEK_API_BASE || '';
  if (!base) return DEFAULT_CHAT_API_URL;
  if (/\/chat\/completions\/?$/i.test(base)) return base;
  return `${base.replace(/\/+$/u, '')}/chat/completions`;
}

function loadEnvFile(fileName) {
  const filePath = path.join(ROOT, fileName);
  let text = '';
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/gu, '');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relative(targetPath) {
  return path.relative(ROOT, path.resolve(targetPath)).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Run prepared concept LLM repair batches through an LLM API

Usage:
  node scripts/run-concept-llm-batches.mjs --manifest tmp/concept-review/auto_fix/llm_batches/manifest.json
  node scripts/run-concept-llm-batches.mjs --batch-file tmp/concept-review/auto_fix/llm_batches/batch_0001_openai-responses.jsonl
  node scripts/run-concept-llm-batches.mjs --manifest tmp/concept-review/auto_fix/llm_batches/manifest.json --api-format chat-completions --model deepseek-chat
  node scripts/run-concept-llm-batches.mjs --manifest tmp/concept-review/auto_fix/llm_batches/manifest.json --dry-run

Inputs:
  JSONL files produced by prepare-concept-llm-batches.mjs --format openai-responses

Environment:
  OPENAI_API_KEY for responses; DEEPSEEK_API_KEY for chat-completions, or pass --api-key-env <ENV_NAME>

Options:
  --concurrency N   Number of requests to run in parallel (default: 1)

Output:
  tmp/concept-review/auto_fix/llm_batch_output.jsonl

Then:
  npm run concept:review:collect-llm -- --input tmp/concept-review/auto_fix/llm_batch_output.jsonl --manifest tmp/concept-review/auto_fix/llm_batches/manifest.json
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
