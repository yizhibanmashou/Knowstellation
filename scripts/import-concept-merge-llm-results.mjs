#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INPUT_DIR = path.resolve(ROOT, 'tmp/concept-review');
const DEFAULT_OUTPUT_DIR = path.resolve(DEFAULT_INPUT_DIR, 'auto_merge');
const DEFAULT_CANDIDATES_PATH = path.resolve(DEFAULT_INPUT_DIR, 'concept_merge_candidates.json');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const VALID_DECISIONS = new Set(['merge_all', 'merge_subset', 'split', 'reject_merge']);
const VALID_ACTIONS = new Set(['merge_to_canonical', 'keep_separate', 'needs_human_review']);
const MIN_ACCEPT_CONFIDENCE = 0.78;
const DEFAULT_MAX_MERGE_LLM_RETRY_ATTEMPTS = 2;
const RETRYABLE_REASONS = new Set([
  'result_not_object',
  'missing_model_text',
  'invalid_model_json',
  'model_text_not_object',
  'invalid_decision',
  'missing_canonical_concept_id',
  'missing_canonical_concept_name',
  'missing_member_decisions',
  'low_confidence',
  'invalid_member_action',
]);
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
  if (!options.input) throw new Error('Missing --input <jsonl>');

  const inputDir = path.resolve(ROOT, options.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(ROOT, options.outputDir || DEFAULT_OUTPUT_DIR);
  const candidatesPath = path.resolve(ROOT, options.candidates || DEFAULT_CANDIDATES_PATH);
  const inputPath = path.resolve(process.cwd(), options.input);
  const generatedAt = utcNow();
  const conceptByKey = await readConceptMaps(inputDir);
  const groupById = await readMergeGroups(candidatesPath);
  const rawItems = await readRawItems(inputPath);
  const entries = [];
  const rejected = [];
  const retryQueue = [];
  const humanQueue = [];

  for (const raw of rawItems) {
    const parsed = parseResultEnvelope(raw);
    const retryAttempt = retryAttemptFrom(raw, parsed.result, parsed.customId);
    if (parsed.error) {
      const groupId = groupIdFromTaskId(parsed.customId);
      const group = groupById.get(groupId);
      const item = rejectedItem(groupId || parsed.customId, group, [parsed.error], raw, null, retryAttempt);
      rejected.push(item);
      routeRejectedItem(item, group, conceptByKey, retryQueue, humanQueue);
      continue;
    }
    const validation = validateMergeDecision(parsed.result, parsed.customId, groupById, conceptByKey, generatedAt, retryAttempt);
    entries.push(...validation.entries);
    rejected.push(...validation.rejected);
    retryQueue.push(...validation.retryQueue);
    humanQueue.push(...validation.humanQueue);
  }

  const byChapter = new Map();
  for (const entry of entries) {
    if (!byChapter.has(entry.chapter_id)) byChapter.set(entry.chapter_id, []);
    byChapter.get(entry.chapter_id).push(entry);
  }

  await mkdir(outputDir, { recursive: true });
  const patchFiles = [];
  let appliedEntries = 0;
  for (const [chapterId, chapterEntries] of [...byChapter.entries()].sort(([a], [b]) => sortChapterId(a, b))) {
    const patch = {
      chapter_id: chapterId,
      generated_at: generatedAt,
      source: {
        method: 'validated_llm_canonical_merge',
        input: relative(inputPath),
        apply_mode: Boolean(options.apply),
      },
      entries: chapterEntries,
    };
    const patchPath = path.join(outputDir, `${chapterId}_llm_merge_patch.json`);
    await writeJson(patchPath, patch);
    patchFiles.push({ chapter_id: chapterId, path: relative(patchPath), entries: chapterEntries.length });
    if (options.apply && chapterEntries.length) {
      const mapPath = path.join(inputDir, `${chapterId}${SYMBOL_CONCEPT_MAP_SUFFIX}`);
      const mapPayload = await readJson(mapPath);
      appliedEntries += applyPatch(mapPayload, patch, generatedAt);
      await writeJson(mapPath, mapPayload);
    }
  }

  const rejectedPath = path.join(outputDir, 'llm_merge_rejected_queue.json');
  const retryPath = path.join(outputDir, 'llm_merge_retry_queue.jsonl');
  const humanPath = path.join(outputDir, 'llm_merge_human_review_queue.json');
  const summaryPath = path.join(outputDir, 'llm_merge_import_summary.json');
  await writeJson(rejectedPath, { generated_at: generatedAt, source: relative(inputPath), entries: rejected });
  await writeJsonl(retryPath, retryQueue);
  await writeJson(humanPath, { generated_at: generatedAt, source: relative(inputPath), entries: humanQueue });
  await writeJson(summaryPath, {
    generated_at: generatedAt,
    source: {
      input: relative(inputPath),
      concept_maps: `${relative(inputDir)}/*${SYMBOL_CONCEPT_MAP_SUFFIX}`,
      merge_candidates: relative(candidatesPath),
      apply_mode: Boolean(options.apply),
    },
    counts: {
      input_items: rawItems.length,
      accepted_entries: entries.length,
      rejected_results: rejected.length,
      retry_queue_entries: retryQueue.length,
      human_review_queue_entries: humanQueue.length,
      chapters: byChapter.size,
      applied_entries: appliedEntries,
    },
    patch_files: patchFiles,
    rejected_queue: relative(rejectedPath),
    retry_queue: relative(retryPath),
    human_review_queue: relative(humanPath),
  });

  console.log(`Imported ${rawItems.length} merge LLM results`);
  console.log(`  accepted entries: ${entries.length}`);
  console.log(`  rejected results: ${rejected.length}`);
  console.log(`  retry queue: ${retryQueue.length}`);
  console.log(`  human queue: ${humanQueue.length}`);
  if (options.apply) console.log(`  applied entries: ${appliedEntries}`);
  console.log(`  summary: ${relative(summaryPath)}`);
}

function validateMergeDecision(raw, customId, groupById, conceptByKey, generatedAt, retryAttempt = 0) {
  const rejected = [];
  const retryQueue = [];
  const humanQueue = [];
  const entries = [];
  const groupId = clean(raw?.group_id || groupIdFromTaskId(customId));
  const group = groupById.get(groupId);
  const issues = [];
  if (!isRecord(raw)) issues.push('result_not_object');
  if (!group) issues.push('unknown_group_id');
  if (!VALID_DECISIONS.has(clean(raw?.decision))) issues.push('invalid_decision');
  if (!clean(raw?.canonical_concept_id)) issues.push('missing_canonical_concept_id');
  if (!clean(raw?.canonical_concept_name)) issues.push('missing_canonical_concept_name');
  if (!Array.isArray(raw?.member_decisions)) issues.push('missing_member_decisions');
  const confidence = clampConfidence(raw?.confidence);
  if (confidence < MIN_ACCEPT_CONFIDENCE && clean(raw?.decision) !== 'reject_merge') issues.push('low_confidence');

  if (issues.length) {
    const item = rejectedItem(groupId || customId, group, issues, raw, null, retryAttempt);
    rejected.push(item);
    routeRejectedItem(item, group, conceptByKey, retryQueue, humanQueue);
    return { entries, rejected, retryQueue, humanQueue };
  }

  const candidateKeys = new Set(group.member_keys || []);
  const canonicalId = clean(raw.canonical_concept_id);
  const canonicalName = clean(raw.canonical_concept_name);
  const decision = clean(raw.decision);
  if (decision === 'reject_merge' || decision === 'split') {
    return { entries, rejected, retryQueue, humanQueue };
  }

  const seen = new Set();
  for (const memberDecision of raw.member_decisions) {
    const stableKeyValue = clean(memberDecision?.stable_key);
    const action = clean(memberDecision?.action);
    if (!stableKeyValue || seen.has(stableKeyValue)) continue;
    seen.add(stableKeyValue);
    const concept = conceptByKey.get(stableKeyValue);
    const memberIssues = [];
    if (!candidateKeys.has(stableKeyValue)) memberIssues.push('stable_key_not_in_group');
    if (!concept) memberIssues.push('unknown_stable_key');
    if (!VALID_ACTIONS.has(action)) memberIssues.push('invalid_member_action');
    if (memberIssues.length) {
      const item = rejectedItem(groupId, group, memberIssues, memberDecision, null, retryAttempt);
      rejected.push(item);
      routeRejectedItem(item, group, conceptByKey, retryQueue, humanQueue);
      continue;
    }
    if (action === 'needs_human_review') {
      const item = rejectedItem(groupId, group, ['member_needs_human_review'], memberDecision, concept, retryAttempt);
      rejected.push(item);
      routeRejectedItem(item, group, conceptByKey, retryQueue, humanQueue);
      continue;
    }
    if (action !== 'merge_to_canonical') continue;
    entries.push({
      stable_key: stableKeyValue,
      chapter_id: concept.chapter_id,
      formula_id: concept.formula_id,
      symbol: concept.symbol,
      role: concept.role,
      canonical_concept_id: canonicalId,
      canonical_concept_name: canonicalName,
      review_flags: unique([...(concept.review_flags || []), 'llm_canonical_merge']),
      review_notes: appendReviewNote(
        concept.review_notes,
        `Validated LLM canonical merge: ${groupId} -> ${canonicalName}. ${clean(raw.review_notes)}`,
      ),
      reviewed_by: concept.reviewed_by || 'auto_llm_merge',
      reviewed_at: concept.reviewed_at || generatedAt,
    });
  }

  return { entries, rejected, retryQueue, humanQueue };
}

function parseResultEnvelope(envelope) {
  if (!isRecord(envelope)) return { error: 'result_not_object', customId: '' };
  const customId = clean(envelope.custom_id || envelope.task_id || envelope.group_id);
  if (envelope.error) return { error: 'batch_item_error', customId };
  if (isMergeResult(envelope)) return { result: { ...envelope }, customId };
  const body = envelope.response?.body || envelope.body || envelope.result || null;
  if (isRecord(body) && isMergeResult(body)) return { result: { ...body }, customId };
  const text = extractText(body || envelope.response || envelope);
  if (!text) return { error: 'missing_model_text', customId };
  try {
    const parsed = JSON.parse(stripJsonFence(text));
    if (!isRecord(parsed)) return { error: 'model_text_not_object', customId };
    return { result: parsed, customId };
  } catch {
    return { error: 'invalid_model_json', customId };
  }
}

function isMergeResult(value) {
  return isRecord(value)
    && typeof value.group_id === 'string'
    && typeof value.decision === 'string'
    && Array.isArray(value.member_decisions);
}

function rejectedItem(identifier, group, reasons, raw, concept = null, retryAttempt = 0) {
  const normalizedRetryAttempt = nonNegativeInteger(retryAttempt, 0);
  const resolution = shouldRetry(reasons, group, normalizedRetryAttempt) ? 'retry' : 'human_review';
  return {
    group_id: group?.group_id || groupIdFromTaskId(identifier),
    stable_key: concept ? stableKey(concept) : clean(raw?.stable_key),
    chapter_id: concept?.chapter_id || group?.chapter_id || '',
    concept_id: concept?.concept_id || '',
    concept_name: concept?.concept_name || '',
    reasons,
    retry_attempt: normalizedRetryAttempt,
    max_retry_attempts: DEFAULT_MAX_MERGE_LLM_RETRY_ATTEMPTS,
    resolution,
    raw_result: raw,
    priority_score: 80 + reasons.length * 10,
  };
}

function routeRejectedItem(item, group, conceptByKey, retryQueue, humanQueue) {
  if (item.resolution === 'retry') {
    const retryRecord = retryQueueRecord(item, group, conceptByKey);
    if (retryRecord) {
      retryQueue.push(retryRecord);
      return;
    }
  }
  item.resolution = 'human_review';
  humanQueue.push(humanItem(item));
}

function shouldRetry(reasons, group, retryAttempt) {
  return Boolean(group?.group_id)
    && retryAttempt < DEFAULT_MAX_MERGE_LLM_RETRY_ATTEMPTS
    && reasons.length > 0
    && reasons.every((reason) => RETRYABLE_REASONS.has(reason));
}

function retryQueueRecord(rejected, group, conceptByKey) {
  const nextAttempt = rejected.retry_attempt + 1;
  const members = (group.member_keys || [])
    .map((key) => conceptByKey.get(key))
    .filter(Boolean)
    .map(memberForRetryPrompt);
  if (members.length < 2) return null;
  const taskId = `${group.group_id}__retry_${nextAttempt}`;
  const input = {
    task_id: taskId,
    group_id: group.group_id,
    retry_attempt: nextAttempt,
    max_retry_attempts: DEFAULT_MAX_MERGE_LLM_RETRY_ATTEMPTS,
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
    previous_rejection: {
      reasons: rejected.reasons,
      raw_result: rejected.raw_result,
    },
    members,
  };
  return {
    custom_id: taskId,
    task_id: taskId,
    source_queue_type: 'retry',
    retry_attempt: nextAttempt,
    group_id: group.group_id,
    chapter_id: group.chapter_id,
    input,
    output_schema: MERGE_DECISION_SCHEMA,
    prompt: buildRetryPromptText(input),
  };
}

function memberForRetryPrompt(concept) {
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

function buildRetryPromptText(input) {
  return [
    'You are retrying a failed duplicate-concept merge review for a mathematical biology textbook.',
    'The previous output failed validation. Fix only the validation issues listed in previous_rejection.',
    'Do not invent new stable keys. Return exactly one JSON object matching output_schema.',
    'Input:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function humanItem(rejected) {
  return {
    group_id: rejected.group_id,
    stable_key: rejected.stable_key,
    chapter_id: rejected.chapter_id,
    concept_id: rejected.concept_id,
    concept_name: rejected.concept_name,
    review_status: 'needs_revision',
    review_flags: unique(['llm_merge_rejected', ...rejected.reasons]),
    reasons: rejected.reasons,
    priority_score: rejected.priority_score,
    review_notes: 'LLM merge output could not be safely applied; route to human fallback review.',
  };
}

function applyPatch(mapPayload, patch, generatedAt) {
  const byKey = new Map((mapPayload.symbol_concepts || []).map((concept, index) => [stableKey(concept), index]));
  let applied = 0;
  for (const entry of patch.entries || []) {
    const index = byKey.get(entry.stable_key);
    if (index === undefined) continue;
    const {
      stable_key: _stableKey,
      chapter_id: _chapterId,
      formula_id: _formulaId,
      symbol: _symbol,
      role: _role,
      ...updates
    } = entry;
    mapPayload.symbol_concepts[index] = {
      ...mapPayload.symbol_concepts[index],
      ...updates,
    };
    applied += 1;
  }
  mapPayload.summary = summaryFor(mapPayload.chapter_id, mapPayload.symbol_concepts || []);
  mapPayload.review_updated_at = generatedAt;
  return applied;
}

function summaryFor(chapterId, concepts) {
  const status_counts = {};
  for (const concept of concepts) {
    const status = concept.review_status || 'unreviewed';
    status_counts[status] = (status_counts[status] || 0) + 1;
  }
  const reviewed_entries = concepts.filter((concept) => (concept.review_status || 'unreviewed') !== 'unreviewed').length;
  return {
    chapter_id: chapterId,
    symbol_concept_entries: concepts.length,
    unique_concepts: new Set(concepts.map((concept) => concept.concept_id)).size,
    low_confidence_entries: concepts.filter((concept) => Number(concept.confidence || 0) < 0.72).length,
    reviewed_entries,
    unreviewed_entries: concepts.length - reviewed_entries,
    status_counts,
  };
}

async function readMergeGroups(candidatesPath) {
  const payload = await readJson(candidatesPath);
  const groups = new Map();
  for (const chapter of Object.values(payload.chapters || {})) {
    for (const group of chapter.groups || []) groups.set(group.group_id, group);
  }
  return groups;
}

async function readConceptMaps(inputDir) {
  const result = new Map();
  const files = (await readdir(inputDir)).filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX));
  for (const file of files) {
    const payload = await readJson(path.join(inputDir, file));
    for (const concept of payload.symbol_concepts || []) result.set(stableKey(concept), concept);
  }
  return result;
}

async function readRawItems(filePath) {
  const text = stripBom(await readFile(filePath, 'utf8'));
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function readJson(filePath) {
  return JSON.parse(stripBom(await readFile(filePath, 'utf8')));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, values) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf8');
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  if (typeof value.output_text === 'string') return value.output_text;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  const choiceContent = value.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;
  return value.output
    ?.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    ?.map((content) => content.text || content.value || '')
    ?.filter(Boolean)
    ?.join('\n') || '';
}

function groupIdFromTaskId(value = '') {
  return clean(value).replace(/__retry_\d+$/i, '').replace(/__part_\d+$/i, '');
}

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].map(clean).join('::');
}

function appendReviewNote(existing, note) {
  return [existing, note].filter(Boolean).join('\n');
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const next = clean(value);
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    result.push(next);
  }
  return result;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Number(number.toFixed(2))));
}

function retryAttemptFrom(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string') {
      const match = /__retry_(\d+)$/i.exec(value);
      if (match) return Number(match[1]);
      continue;
    }
    if (!isRecord(value)) continue;
    const direct = nonNegativeInteger(value.retry_attempt, null);
    if (direct !== null) return direct;
    const input = nonNegativeInteger(value.input?.retry_attempt, null);
    if (input !== null) return input;
    const body = nonNegativeInteger(value.body?.retry_attempt, null);
    if (body !== null) return body;
    const responseBody = nonNegativeInteger(value.response?.body?.retry_attempt, null);
    if (responseBody !== null) return responseBody;
    const customId = clean(value.custom_id || value.task_id);
    const match = /__retry_(\d+)$/i.exec(customId);
    if (match) return Number(match[1]);
  }
  return 0;
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

function stripJsonFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--input') options.input = args[++index];
    else if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output-dir') options.outputDir = args[++index];
    else if (arg === '--candidates') options.candidates = args[++index];
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`Unknown option: ${arg}`);
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
  console.log(`Import validated concept merge LLM results

Usage:
  node scripts/import-concept-merge-llm-results.mjs --input tmp/merge_llm_output.jsonl
  node scripts/import-concept-merge-llm-results.mjs --input tmp/merge_llm_output.jsonl --apply

Inputs:
  JSONL output from run-concept-llm-batches over prepare-concept-merge-llm-batches output.

Outputs:
  tmp/concept-review/auto_merge/*_llm_merge_patch.json
  tmp/concept-review/auto_merge/llm_merge_import_summary.json
  tmp/concept-review/auto_merge/llm_merge_retry_queue.jsonl
  tmp/concept-review/auto_merge/llm_merge_human_review_queue.json
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
