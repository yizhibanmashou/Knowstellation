#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_DIR = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix', 'llm_batches');
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_MODEL = 'gpt-5-mini';
const QUEUE_SUFFIXES = {
  initial: ['_llm_queue.jsonl'],
  retry: ['_llm_retry_queue.jsonl'],
  all: ['_llm_queue.jsonl', '_llm_retry_queue.jsonl'],
};
const REPAIR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'stable_key',
    'formula_id',
    'symbol',
    'role',
    'concept_name',
    'concept_type',
    'definition',
    'confidence',
    'review_status',
  ],
  properties: {
    stable_key: { type: 'string' },
    formula_id: { type: 'string' },
    symbol: { type: 'string' },
    role: { enum: ['defined', 'used'] },
    concept_name: { type: 'string' },
    concept_type: {
      enum: [
        'quantity_concept',
        'math_concept',
        'domain_concept',
        'theorem_or_principle',
        'operator_or_function',
        'unknown',
      ],
    },
    definition: { type: 'string' },
    definition_zh: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'object' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    review_status: { enum: ['edited', 'rejected', 'ambiguous', 'needs_revision'] },
    review_flags: { type: 'array', items: { type: 'string' } },
    review_notes: { type: 'string' },
  },
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(process.cwd(), options.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);
  const queueType = options.queueType || 'initial';
  const chapters = options.chapter ? [options.chapter] : await listQueueChapters(inputDir, queueType);
  const selectedChapters = options.all ? chapters : chapters.slice(0, 1);
  if (!selectedChapters.length) throw new Error(`No LLM queue files found in ${relative(inputDir)}`);

  const records = [];
  const inputFiles = [];
  for (const chapterId of selectedChapters) {
    const queuePaths = await queuePathsForChapter(inputDir, chapterId, queueType);
    if (!queuePaths.length) {
      throw new Error(`Missing ${queueType} queue file for ${chapterId} in ${relative(inputDir)}`);
    }
    for (const queuePath of queuePaths) {
      inputFiles.push(relative(queuePath));
      const sourceQueueType = queueTypeForPath(queuePath);
      for (const item of await readJsonl(queuePath)) {
        records.push(normalizeQueueItem(chapterId, item, sourceQueueType));
        if (options.maxItems && records.length >= options.maxItems) break;
      }
      if (options.maxItems && records.length >= options.maxItems) break;
    }
    if (options.maxItems && records.length >= options.maxItems) break;
  }

  await mkdir(outputDir, { recursive: true });
  const format = options.format || 'generic';
  const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, '--batch-size');
  const dedupedRecords = dedupeRecords(records);
  const tasks = options.cohort ? cohortRecords(dedupedRecords) : dedupedRecords;
  const batches = chunk(tasks, batchSize);
  const batchFiles = [];
  for (let index = 0; index < batches.length; index += 1) {
    const batchId = `batch_${String(index + 1).padStart(4, '0')}`;
    const filePath = path.join(outputDir, `${batchId}_${format}.jsonl`);
    const lines = batches[index].map((record) => serializeBatchLine(record, { ...options, format }));
    await writeFile(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    batchFiles.push({
      batch_id: batchId,
      path: relative(filePath),
      entries: batches[index].length,
    });
  }

  const manifest = {
    generated_at: utcNow(),
    source: {
      input_dir: relative(inputDir),
      input_files: inputFiles,
      queue_type: queueType,
      output_dir: relative(outputDir),
      chapters: selectedChapters,
      format,
      model: format === 'openai-responses' ? (options.model || DEFAULT_MODEL) : null,
      batch_size: batchSize,
      max_items: options.maxItems || null,
    },
    counts: {
      chapters: selectedChapters.length,
      queue_items: dedupedRecords.length,
      raw_queue_items: records.length,
      deduped_queue_items: records.length - dedupedRecords.length,
      model_tasks: tasks.length,
      batches: batchFiles.length,
      cohorts: new Set(dedupedRecords.map((record) => record.cohort_key)).size,
      cohort_mode: Boolean(options.cohort),
    },
    cohorts: options.cohort ? tasks.map(cohortManifestItem) : [],
    files: batchFiles,
    import_contract: {
      expected_result_name: '<chapter_id>_llm_results.jsonl',
      result_object_key: 'stable_key',
      importer: 'npm run concept:review:import-llm -- --all --apply',
      note: 'Each model output must be one repair JSON object; validation happens during import.',
    },
  };
  await writeJson(path.join(outputDir, 'manifest.json'), manifest);

  console.log(`Prepared ${tasks.length} concept LLM repair tasks`);
  console.log(`  chapters: ${selectedChapters.length}`);
  console.log(`  queue type: ${queueType}`);
  console.log(`  cohorts: ${manifest.counts.cohorts}`);
  if (options.cohort) console.log(`  expanded queue items: ${dedupedRecords.length}`);
  if (records.length !== dedupedRecords.length) console.log(`  deduped queue items: ${records.length - dedupedRecords.length}`);
  console.log(`  batches: ${batchFiles.length}`);
  console.log(`  manifest: ${relative(path.join(outputDir, 'manifest.json'))}`);
}

function normalizeQueueItem(chapterId, item, sourceQueueType = 'initial') {
  const input = item.input || {};
  const taskId = clean(item.task_id || input.task_id || stableKey(input));
  return {
    custom_id: taskId,
    task_id: taskId,
    source_queue_type: sourceQueueType,
    chapter_id: clean(input.chapter_id || chapterId),
    formula_id: clean(input.formula_id),
    symbol: clean(input.symbol),
    role: clean(input.symbol_role || input.role),
    input,
    prompt: item.prompt || buildPromptText(input),
    output_schema: REPAIR_SCHEMA,
    cohort_key: cohortKey(input),
    cohort_members: null,
  };
}

function dedupeRecords(records) {
  const byTaskId = new Map();
  for (const record of records) {
    const current = byTaskId.get(record.task_id);
    if (!current || queuePriority(record.source_queue_type) >= queuePriority(current.source_queue_type)) {
      byTaskId.set(record.task_id, record);
    }
  }
  return [...byTaskId.values()];
}

function queuePriority(queueType) {
  if (queueType === 'retry') return 2;
  return 1;
}

function cohortRecords(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.cohort_key)) groups.set(record.cohort_key, []);
    groups.get(record.cohort_key).push(record);
  }
  return [...groups.values()].map((members, index) => {
    const representative = members[0];
    const cohortId = `cohort_${String(index + 1).padStart(5, '0')}`;
    const examples = members.slice(0, 8).map((member) => ({
      stable_key: member.task_id,
      chapter_id: member.chapter_id,
      formula_id: member.formula_id,
      formula_label: member.input.formula_label,
      source_sentence: member.input.source_sentence || '',
      evidence: member.input.evidence || [],
    }));
    return {
      ...representative,
      custom_id: cohortId,
      task_id: cohortId,
      input: {
        ...representative.input,
        cohort_id: cohortId,
        cohort_size: members.length,
        representative_stable_key: representative.task_id,
        representative_examples: examples,
      },
      prompt: buildPromptText({
        ...representative.input,
        cohort_id: cohortId,
        cohort_size: members.length,
        representative_stable_key: representative.task_id,
        representative_examples: examples,
      }),
      cohort_members: members.map((member) => ({
        stable_key: member.task_id,
        chapter_id: member.chapter_id,
        formula_id: member.formula_id,
        symbol: member.symbol,
        role: member.role,
        retry_attempt: nonNegativeInteger(member.input.retry_attempt, 0),
      })),
    };
  });
}

function cohortManifestItem(record) {
  return {
    cohort_id: record.task_id,
    cohort_key: record.cohort_key,
    representative_stable_key: record.input.representative_stable_key,
    entries: record.cohort_members.length,
    members: record.cohort_members,
  };
}

function serializeBatchLine(record, options) {
  if (options.format === 'generic') {
    return JSON.stringify({
      custom_id: record.custom_id,
      task_id: record.task_id,
      chapter_id: record.chapter_id,
      formula_id: record.formula_id,
      symbol: record.symbol,
      role: record.role,
      source_queue_type: record.source_queue_type,
      cohort_key: record.cohort_key,
      input: record.input,
      output_schema: record.output_schema,
      prompt: record.prompt,
      cohort_members: record.cohort_members || undefined,
    });
  }

  if (options.format === 'openai-responses') {
    return JSON.stringify({
      custom_id: record.custom_id,
      method: 'POST',
      url: '/v1/responses',
      body: {
        model: options.model || DEFAULT_MODEL,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0.15,
        input: [
          {
            role: 'system',
            content: [
              'You repair symbol-to-concept mappings for a mathematical biology textbook.',
              'Return exactly one JSON object matching the schema.',
              'Use edited for a repaired concept and rejected for parser artifacts or pure indices.',
              'Do not use approved; downstream validation is responsible for approval.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              stable_key: record.task_id,
              task: 'repair_symbol_concept',
              cohort_members: record.cohort_members || undefined,
              input: record.input,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'symbol_concept_repair',
            strict: true,
            schema: record.output_schema,
          },
        },
      },
    });
  }

  throw new Error(`Unknown format: ${options.format}`);
}

function buildPromptText(input) {
  return [
    'You are repairing a symbol-to-concept map for a mathematical biology textbook.',
    'Use only the formula label, symbol, local evidence, and current candidate.',
    'Return one JSON object matching output_schema.',
    'Do not use generic public names such as Mean, Function, Variable, Count, Distance, Coefficient, Index, Parameter, or Rate.',
    'Do not wrap a symbol in a generic label such as "Mean of x", "Variable x", or "Function f"; name the biological/statistical quantity, or reject if the evidence is insufficient.',
    'If the symbol is only an index or parser artifact, set review_status to rejected.',
    'Input:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function cohortKey(input) {
  const candidate = input.current_candidate || {};
  const role = clean(input.symbol_role || input.role).toLowerCase();
  const symbol = cohortSymbolKey(input.symbol);
  const conceptName = clean(candidate.concept_name).toLowerCase();
  const flags = Array.isArray(input.auto_fix_reasons) ? input.auto_fix_reasons.map((reason) => clean(reason).toLowerCase()) : [];
  const keyParts = [
    role,
    symbol,
    conceptName,
    clean(candidate.concept_type).toLowerCase(),
    clean(candidate.definition).toLowerCase(),
    ...flags,
  ];
  if (isContextSensitiveCohort(input, conceptName, flags)) {
    keyParts.push(`chapter:${clean(input.chapter_id).toLowerCase()}`);
    keyParts.push(`context:${contextSignature(input)}`);
  }
  return keyParts.join('|');
}

function cohortSymbolKey(symbol) {
  return clean(symbol)
    .toLowerCase()
    .replace(/\\bar\{/g, '\\overline{')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\^\{([^{}]+)\}/g, '^$1');
}

function isContextSensitiveCohort(input, conceptName, flags) {
  const role = clean(input.symbol_role || input.role).toLowerCase();
  if (role === 'defined' && flags.includes('generic_defined_concept_name')) return true;
  if ([
    'probability',
    'probability density',
    'variance',
    'expectation',
    'response',
    'frequency',
    'mean time',
    'information',
    'fitness width',
  ].includes(conceptName)) return true;
  return false;
}

function contextSignature(input) {
  const text = [
    input.formula_label,
    input.source_sentence,
    ...(Array.isArray(input.evidence) ? input.evidence.map((item) => item?.sentence || item?.chunk_id || '') : []),
  ].map(clean).join(' ').toLowerCase();
  const terms = text
    .replace(/\\[a-z]+|[_^{}$()[\],.;:]/gi, ' ')
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 4)
    .filter((term) => !CONTEXT_STOPWORDS.has(term));
  return uniqueStrings(terms).slice(0, 8).join('-') || 'none';
}

const CONTEXT_STOPWORDS = new Set([
  'formula',
  'where',
  'with',
  'from',
  'that',
  'this',
  'then',
  'than',
  'into',
  'using',
  'used',
  'given',
  'which',
  'while',
  'become',
  'becomes',
  'chapter',
  'appendix',
  'equation',
  'equations',
  'defined',
  'denote',
  'denotes',
  'follows',
  'because',
  'obtained',
  'therefore',
]);

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableKey(input) {
  return [input.chapter_id, input.formula_id, input.symbol_role || input.role, input.symbol].map(clean).join('::');
}

async function listQueueChapters(inputDir, queueType) {
  const files = await readdir(inputDir);
  const chapters = new Set();
  for (const suffix of queueSuffixes(queueType)) {
    for (const file of files) {
      if (file.endsWith(suffix)) chapters.add(file.slice(0, -suffix.length));
    }
  }
  return [...chapters].sort(sortChapterId);
}

async function queuePathsForChapter(inputDir, chapterId, queueType) {
  const paths = [];
  for (const suffix of queueSuffixes(queueType)) {
    const queuePath = path.join(inputDir, `${chapterId}${suffix}`);
    if (await fileExists(queuePath)) paths.push(queuePath);
  }
  return paths;
}

function queueTypeForPath(queuePath) {
  return queuePath.endsWith('_llm_retry_queue.jsonl') ? 'retry' : 'initial';
}

function queueSuffixes(queueType) {
  const suffixes = QUEUE_SUFFIXES[queueType];
  if (!suffixes) throw new Error(`Unknown queue type: ${queueType}`);
  return suffixes;
}

function sortChapterId(left, right) {
  const rank = (value) => {
    const chapter = /^chapter(\d+)$/i.exec(value);
    if (chapter) return Number(chapter[1]);
    const appendix = /^appendix(\d+)$/i.exec(value);
    if (appendix) return 1000 + Number(appendix[1]);
    return 9999;
  };
  return rank(left) - rank(right) || left.localeCompare(right);
}

async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function positiveInteger(value, fallback, optionName) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${optionName} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output-dir') options.outputDir = args[++index];
    else if (arg === '--queue-type') options.queueType = args[++index];
    else if (arg === '--format') options.format = args[++index];
    else if (arg === '--model') options.model = args[++index];
    else if (arg === '--batch-size') options.batchSize = args[++index];
    else if (arg === '--max-items') options.maxItems = positiveInteger(args[++index], undefined, '--max-items');
    else if (arg === '--temperature') options.temperature = Number(args[++index]);
    else if (arg === '--cohort') options.cohort = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.format && !['generic', 'openai-responses'].includes(options.format)) {
    throw new Error('--format must be generic or openai-responses');
  }
  if (options.queueType && !QUEUE_SUFFIXES[options.queueType]) {
    throw new Error('--queue-type must be initial, retry, or all');
  }
  return options;
}

function relative(targetPath) {
  return path.relative(ROOT, path.resolve(targetPath)).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Prepare concept LLM repair batches

Usage:
  node scripts/prepare-concept-llm-batches.mjs --chapter chapter2
  node scripts/prepare-concept-llm-batches.mjs --all --batch-size 250
  node scripts/prepare-concept-llm-batches.mjs --all --cohort --batch-size 250
  node scripts/prepare-concept-llm-batches.mjs --all --format openai-responses --model gpt-5-mini
  node scripts/prepare-concept-llm-batches.mjs --all --queue-type retry --format openai-responses

Inputs:
  tmp/concept-review/auto_fix/*_llm_queue.jsonl
  tmp/concept-review/auto_fix/*_llm_retry_queue.jsonl when --queue-type retry or all is used

Outputs:
  tmp/concept-review/auto_fix/llm_batches/manifest.json
  tmp/concept-review/auto_fix/llm_batches/batch_0001_<format>.jsonl
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
