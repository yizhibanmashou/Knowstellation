#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INPUT_DIR = path.resolve(ROOT, 'tmp/concept-review');
const DEFAULT_CANDIDATES_PATH = path.resolve(DEFAULT_INPUT_DIR, 'concept_merge_candidates.json');
const DEFAULT_OUTPUT_DIR = path.resolve(DEFAULT_INPUT_DIR, 'auto_merge', 'llm_batches');
const DEFAULT_RETRY_QUEUE_PATH = path.resolve(DEFAULT_INPUT_DIR, 'auto_merge', 'llm_merge_retry_queue.jsonl');
const DEFAULT_BATCH_SIZE = 120;
const DEFAULT_MODEL = 'gpt-5-mini';
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const MAX_MEMBERS_PER_TASK = 32;
const QUEUE_TYPES = new Set(['unresolved', 'retry', 'all']);

const MERGE_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'group_id',
    'decision',
    'canonical_concept_id',
    'canonical_concept_name',
    'member_decisions',
    'confidence',
    'review_notes',
  ],
  properties: {
    group_id: { type: 'string' },
    decision: { enum: ['merge_all', 'merge_subset', 'split', 'reject_merge'] },
    canonical_concept_id: { type: 'string' },
    canonical_concept_name: { type: 'string' },
    member_decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stable_key', 'action'],
        properties: {
          stable_key: { type: 'string' },
          action: { enum: ['merge_to_canonical', 'keep_separate', 'needs_human_review'] },
          reason: { type: 'string' },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    review_notes: { type: 'string' },
  },
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(ROOT, options.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(ROOT, options.outputDir || DEFAULT_OUTPUT_DIR);
  const candidatesPath = path.resolve(ROOT, options.candidates || DEFAULT_CANDIDATES_PATH);
  const format = options.format || 'generic';
  const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, '--batch-size');
  const candidates = await readJson(candidatesPath);
  const conceptByKey = await readConceptMaps(inputDir);
  const queueType = options.queueType || 'unresolved';
  const chapterIds = options.chapter ? [options.chapter] : Object.keys(candidates.chapters || {}).sort(sortChapterId);
  const records = [];
  const retryQueuePath = path.resolve(ROOT, options.retryQueue || DEFAULT_RETRY_QUEUE_PATH);

  if (queueType === 'unresolved' || queueType === 'all') {
    for (const chapterId of chapterIds) {
      const chapter = candidates.chapters?.[chapterId];
      if (!chapter) continue;
      for (const group of chapter.groups || []) {
        const groupRecords = mergeGroupRecords(group, conceptByKey, options);
        records.push(...groupRecords);
        if (options.maxItems && records.length >= options.maxItems) break;
      }
      if (options.maxItems && records.length >= options.maxItems) break;
    }
  }

  if ((!options.maxItems || records.length < options.maxItems) && (queueType === 'retry' || queueType === 'all')) {
    const retryRecords = await readRetryRecords(retryQueuePath, options, records.length);
    records.push(...retryRecords);
  }
  const dedupedRecords = dedupeRecords(records).slice(0, options.maxItems || records.length);

  await mkdir(outputDir, { recursive: true });
  const batches = chunk(dedupedRecords, batchSize);
  const batchFiles = [];
  for (let index = 0; index < batches.length; index += 1) {
    const batchId = `merge_batch_${String(index + 1).padStart(4, '0')}`;
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
      merge_candidates: relative(candidatesPath),
      output_dir: relative(outputDir),
      chapters: chapterIds,
      format,
      model: format === 'openai-responses' ? (options.model || DEFAULT_MODEL) : null,
      batch_size: batchSize,
      max_items: options.maxItems || null,
      queue_type: queueType,
      retry_queue: queueType === 'retry' || queueType === 'all' ? relative(retryQueuePath) : null,
    },
    counts: {
      chapters: chapterIds.length,
      merge_group_tasks: new Set(dedupedRecords.map((record) => record.input.group_id)).size,
      raw_model_tasks: records.length,
      deduped_model_tasks: records.length - dedupedRecords.length,
      model_tasks: dedupedRecords.length,
      batches: batchFiles.length,
      member_decisions_requested: countUniqueMemberKeys(dedupedRecords),
    },
    files: batchFiles,
    import_contract: {
      result_object_key: 'group_id',
      note: 'Each model output is a group-level canonical merge decision. Import must validate stable keys and only apply safe member actions.',
    },
  };
  await writeJson(path.join(outputDir, 'manifest.json'), manifest);

  console.log(`Prepared ${dedupedRecords.length} concept merge LLM tasks`);
  console.log(`  chapters: ${chapterIds.length}`);
  console.log(`  queue type: ${queueType}`);
  console.log(`  member decisions: ${manifest.counts.member_decisions_requested}`);
  if (records.length !== dedupedRecords.length) console.log(`  deduped tasks: ${records.length - dedupedRecords.length}`);
  console.log(`  batches: ${batchFiles.length}`);
  console.log(`  manifest: ${relative(path.join(outputDir, 'manifest.json'))}`);
}

function mergeGroupRecords(group, conceptByKey, options) {
  const members = (group.member_keys || [])
    .map((key) => conceptByKey.get(key))
    .filter(Boolean)
    .filter((concept) => !isCanonicalResolved(concept, group));
  if (members.length < 2) return [];

  const maxMembers = positiveInteger(options.maxMembersPerTask, MAX_MEMBERS_PER_TASK, '--max-members-per-task');
  const sortedMembers = members.slice().sort(compareConcepts);
  const memberChunks = chunk(sortedMembers, maxMembers);
  if (memberChunks.length > 1 && memberChunks.at(-1)?.length === 1) {
    const tail = memberChunks.at(-1);
    const tailKey = stableKey(tail[0]);
    const anchor = sortedMembers.find((member) => stableKey(member) !== tailKey) || sortedMembers[0];
    memberChunks[memberChunks.length - 1] = [anchor, ...tail];
  }
  return memberChunks
    .filter((items) => items.length >= 2)
    .map((taskMembers, index) => mergeGroupRecord(group, taskMembers, members.length, index, memberChunks.length));
}

function mergeGroupRecord(group, taskMembers, totalMembers, partIndex, totalParts) {
  const partSuffix = totalParts > 1 ? `__part_${String(partIndex + 1).padStart(4, '0')}` : '';
  const input = {
    group_id: group.group_id,
    task_id: `${group.group_id}${partSuffix}`,
    part_index: partIndex + 1,
    part_count: totalParts,
    total_unresolved_members: totalMembers,
    chapter_id: group.chapter_id,
    candidate_reasons: group.reasons || [],
    candidate_score: Number(group.score || 0),
    review_priority: group.review_priority || 'medium',
    proposed_canonical: {
      concept_id: group.canonical_candidate?.concept_id || '',
      concept_name: group.canonical_candidate?.concept_name || '',
      concept_type: group.canonical_candidate?.concept_type || '',
      definition: group.canonical_candidate?.definition || '',
      confidence: Number(group.canonical_candidate?.confidence || 0),
    },
    members: taskMembers.map(memberForPrompt),
  };
  return {
    custom_id: input.task_id,
    task_id: input.task_id,
    chapter_id: group.chapter_id,
    source_queue_type: 'unresolved',
    input,
    output_schema: MERGE_DECISION_SCHEMA,
    prompt: buildPromptText(input),
  };
}

async function readRetryRecords(retryQueuePath, options, existingRecordCount) {
  if (!await fileExists(retryQueuePath)) return [];
  const records = [];
  for (const item of await readJsonl(retryQueuePath)) {
    const record = normalizeRetryRecord(item);
    if (!record) continue;
    if (options.chapter && record.chapter_id !== options.chapter) continue;
    records.push(record);
    if (options.maxItems && existingRecordCount + records.length >= options.maxItems) break;
  }
  return records;
}

function normalizeRetryRecord(item) {
  const input = item.input || {};
  const groupId = clean(item.group_id || input.group_id);
  const taskId = clean(item.task_id || item.custom_id || input.task_id || `${groupId}__retry_${nonNegativeInteger(item.retry_attempt || input.retry_attempt, 1)}`);
  if (!groupId || !taskId || !Array.isArray(input.members) || input.members.length < 2) return null;
  return {
    custom_id: taskId,
    task_id: taskId,
    chapter_id: clean(item.chapter_id || input.chapter_id),
    source_queue_type: 'retry',
    retry_attempt: nonNegativeInteger(item.retry_attempt || input.retry_attempt, 1),
    input,
    output_schema: item.output_schema || MERGE_DECISION_SCHEMA,
    prompt: item.prompt || buildRetryPromptText(input),
  };
}

function dedupeRecords(records) {
  const retryGroupIds = new Set(
    records
      .filter((record) => record.source_queue_type === 'retry')
      .map((record) => clean(record.input.group_id)),
  );
  const byTaskId = new Map();
  for (const record of records) {
    if (record.source_queue_type !== 'retry' && retryGroupIds.has(clean(record.input.group_id))) continue;
    const current = byTaskId.get(record.task_id);
    if (!current || queuePriority(record.source_queue_type) >= queuePriority(current.source_queue_type)) {
      byTaskId.set(record.task_id, record);
    }
  }
  return [...byTaskId.values()];
}

function queuePriority(queueType) {
  return queueType === 'retry' ? 2 : 1;
}

function memberForPrompt(concept) {
  return {
    stable_key: stableKey(concept),
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    symbol: concept.symbol,
    role: concept.role,
    definition: concept.definition || '',
    aliases: concept.aliases || [],
    confidence: Number(concept.confidence || 0),
    review_status: concept.review_status || 'unreviewed',
    review_flags: concept.review_flags || [],
  };
}

function buildPromptText(input) {
  return [
    'You are reviewing candidate duplicate concepts from a mathematical biology textbook.',
    'Decide whether the listed symbol-concept entries mean the same learner-facing concept.',
    'Prefer merge_all only when all members should share one canonical concept. Use merge_subset when only some members match. Use reject_merge for unsafe or generic matches.',
    'Do not invent new stable keys. Return exactly one JSON object matching output_schema.',
    'Input:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function buildRetryPromptText(input) {
  return [
    'You are retrying a failed duplicate-concept merge review for a mathematical biology textbook.',
    'The previous output failed validation. Fix only the validation issues listed in previous_rejection.',
    'Do not invent new stable keys. Return exactly one JSON object matching output_schema.',
    'Input:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function serializeBatchLine(record, options) {
  if (options.format === 'generic') {
    return JSON.stringify({
      custom_id: record.custom_id,
      task_id: record.task_id,
      chapter_id: record.chapter_id,
      source_queue_type: record.source_queue_type,
      retry_attempt: record.retry_attempt || undefined,
      input: record.input,
      output_schema: record.output_schema,
      prompt: record.prompt,
    });
  }

  if (options.format === 'openai-responses') {
    return JSON.stringify({
      custom_id: record.custom_id,
      method: 'POST',
      url: '/v1/responses',
      body: {
        model: options.model || DEFAULT_MODEL,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0.1,
        input: [
          {
            role: 'system',
            content: [
              'You review duplicate concept candidates for a mathematical biology textbook.',
              'Return a strict JSON merge decision. Prefer caution: keep generic or mixed-type concepts separate unless evidence is clear.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: 'review_canonical_concept_merge',
              source_queue_type: record.source_queue_type,
              retry_attempt: record.retry_attempt || undefined,
              input: record.input,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'concept_merge_decision',
            strict: true,
            schema: record.output_schema,
          },
        },
      },
    });
  }

  throw new Error(`Unknown format: ${options.format}`);
}

function countUniqueMemberKeys(records) {
  const keys = new Set();
  for (const record of records) {
    for (const member of record.input.members || []) keys.add(member.stable_key);
  }
  return keys.size;
}

async function readConceptMaps(inputDir) {
  const result = new Map();
  const files = (await readdir(inputDir)).filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX));
  for (const file of files) {
    const payload = await readJson(path.join(inputDir, file));
    for (const concept of payload.symbol_concepts || []) {
      result.set(stableKey(concept), concept);
    }
  }
  return result;
}

function isCanonicalResolved(concept, group) {
  const canonicalId = clean(group.canonical_candidate?.concept_id);
  const canonicalName = clean(group.canonical_candidate?.concept_name).toLowerCase();
  return Boolean(canonicalId && clean(concept.canonical_concept_id) === canonicalId)
    || Boolean(canonicalName && clean(concept.canonical_concept_name).toLowerCase() === canonicalName);
}

function compareConcepts(left, right) {
  return formulaSortValue(left.formula_id) - formulaSortValue(right.formula_id)
    || String(left.role || '').localeCompare(String(right.role || ''))
    || String(left.symbol || '').localeCompare(String(right.symbol || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function formulaSortValue(value = '') {
  const match = String(value).match(/formula_([A-Za-z]?)(\d+)\.(\d+)([a-z]?)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const appendixOffset = match[1] ? 10_000 : 0;
  return appendixOffset + Number(match[2]) * 1000 + Number(match[3]) + (match[4] ? match[4].charCodeAt(0) / 1000 : 0);
}

async function readJson(filePath) {
  return JSON.parse(stripBom(await readFile(filePath, 'utf8')));
}

async function readJsonl(filePath) {
  const text = stripBom(await readFile(filePath, 'utf8'));
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
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].map(clean).join('::');
}

function positiveInteger(value, fallback, optionName) {
  if (value === undefined || value === null) return fallback;
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

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output-dir') options.outputDir = args[++index];
    else if (arg === '--candidates') options.candidates = args[++index];
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--queue-type') options.queueType = args[++index];
    else if (arg === '--retry-queue') options.retryQueue = args[++index];
    else if (arg === '--format') options.format = args[++index];
    else if (arg === '--model') options.model = args[++index];
    else if (arg === '--batch-size') options.batchSize = args[++index];
    else if (arg === '--max-items') options.maxItems = positiveInteger(args[++index], undefined, '--max-items');
    else if (arg === '--max-members-per-task') options.maxMembersPerTask = args[++index];
    else if (arg === '--temperature') options.temperature = Number(args[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.format && !['generic', 'openai-responses'].includes(options.format)) {
    throw new Error('--format must be generic or openai-responses');
  }
  if (options.queueType && !QUEUE_TYPES.has(options.queueType)) {
    throw new Error('--queue-type must be unresolved, retry, or all');
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
  console.log(`Prepare concept merge LLM review batches

Usage:
  node scripts/prepare-concept-merge-llm-batches.mjs --chapter chapter3
  node scripts/prepare-concept-merge-llm-batches.mjs --format openai-responses --model gpt-5-mini
  node scripts/prepare-concept-merge-llm-batches.mjs --queue-type retry --format openai-responses

Inputs:
  tmp/concept-review/concept_merge_candidates.json
  tmp/concept-review/*_symbol_concept_map.json
  tmp/concept-review/auto_merge/llm_merge_retry_queue.jsonl when --queue-type retry or all is used

Outputs:
  tmp/concept-review/auto_merge/llm_batches/manifest.json
  tmp/concept-review/auto_merge/llm_batches/merge_batch_0001_<format>.jsonl
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
