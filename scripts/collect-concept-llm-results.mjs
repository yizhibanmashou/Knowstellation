#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.input) throw new Error('Missing --input <jsonl>');

  const inputPath = path.resolve(process.cwd(), options.input);
  const outputDir = path.resolve(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);
  const cohortMap = options.manifest
    ? await readCohortMap(path.resolve(process.cwd(), options.manifest))
    : new Map();
  const lines = stripBom(await readFile(inputPath, 'utf8')).split(/\r?\n/).filter(Boolean);
  const byChapter = new Map();
  const parseErrors = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    let envelope;
    try {
      envelope = JSON.parse(lines[index]);
    } catch (error) {
      parseErrors.push(errorItem(lineNumber, 'invalid_json_line', lines[index], error));
      continue;
    }

    const parsed = parseResultEnvelope(envelope);
    if (parsed.error) {
      parseErrors.push(errorItem(lineNumber, parsed.error, envelope));
      continue;
    }

    const normalizedResult = normalizeRepairResult(parsed.result, parsed.customId);
    if (!normalizedResult) {
      parseErrors.push(errorItem(lineNumber, 'missing_repair_payload', envelope));
      continue;
    }
    const results = expandCohortResult(normalizedResult, parsed.customId, cohortMap);
    for (const result of results) {
      if (!result.stable_key && parsed.customId) result.stable_key = parsed.customId;
      if (!result.task_id && result.stable_key) result.task_id = result.stable_key;
      const chapterId = chapterFromResult(result);
      if (!chapterId) {
        parseErrors.push(errorItem(lineNumber, 'missing_chapter_id_or_stable_key', envelope));
        continue;
      }

      if (!byChapter.has(chapterId)) byChapter.set(chapterId, []);
      byChapter.get(chapterId).push(result);
    }
  }

  await mkdir(outputDir, { recursive: true });
  const files = [];
  for (const [chapterId, results] of [...byChapter.entries()].sort(([a], [b]) => sortChapterId(a, b))) {
    const outputPath = path.join(outputDir, `${chapterId}_llm_results.jsonl`);
    await writeFile(outputPath, results.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
    files.push({ chapter_id: chapterId, path: relative(outputPath), entries: results.length });
  }

  const errorPath = path.join(outputDir, 'llm_result_parse_errors.json');
  await writeJson(errorPath, {
    generated_at: utcNow(),
    source: relative(inputPath),
    entries: parseErrors,
  });

  const summaryPath = path.join(outputDir, 'llm_result_collect_summary.json');
  await writeJson(summaryPath, {
    generated_at: utcNow(),
    source: relative(inputPath),
    counts: {
      input_lines: lines.length,
      parsed_results: [...byChapter.values()].reduce((sum, values) => sum + values.length, 0),
      chapters: byChapter.size,
      parse_errors: parseErrors.length,
      cohort_expansion_enabled: cohortMap.size > 0,
    },
    files,
    parse_errors: relative(errorPath),
    next_step: 'npm run concept:review:import-llm -- --all --apply',
  });

  console.log(`Collected ${files.reduce((sum, file) => sum + file.entries, 0)} LLM results`);
  console.log(`  chapters: ${files.length}`);
  console.log(`  parse errors: ${parseErrors.length}`);
  console.log(`  summary: ${relative(summaryPath)}`);
}

function parseResultEnvelope(envelope) {
  if (!isRecord(envelope)) return { error: 'result_not_object' };

  const customId = clean(envelope.custom_id || envelope.task_id || envelope.stable_key);
  if (envelope.error) return { error: 'batch_item_error' };

  if (isRepairResult(envelope)) {
    return { result: { ...envelope }, customId };
  }

  const body = envelope.response?.body || envelope.body || envelope.result || null;
  if (isRecord(body) && isRepairResult(body)) {
    return { result: { ...body }, customId };
  }

  const text = extractText(body || envelope.response || envelope);
  if (!text) return { error: 'missing_model_text' };

  try {
    const parsed = JSON.parse(stripJsonFence(text));
    if (!isRecord(parsed)) return { error: 'model_text_not_object' };
    return { result: parsed, customId };
  } catch {
    return { error: 'invalid_model_json' };
  }
}

function normalizeRepairResult(result, customId = '') {
  if (!isRecord(result)) return null;
  if (isRepairResult(result)) return { ...result };

  const output = isRecord(result.output) ? result.output : null;
  const input = isRecord(result.input) ? result.input : null;
  const currentCandidate = firstRecord(
    result.current_candidate,
    input?.current_candidate,
    output?.current_candidate,
  );
  const stableKey = resolveStableKey(clean(result.stable_key || result.task_id || customId), input, currentCandidate);
  const keyParts = parseStableKey(stableKey);
  const status = clean(
    output?.review_status
      || output?.status
      || output?.decision
      || result.review_status
      || result.status
      || result.decision,
  );
  const edited = firstRecord(
    result.edited,
    result.edited_concept,
    result.repaired_concept,
    result.concept,
    output?.edited,
    output?.edited_concept,
    output?.repaired_concept,
    output?.concept,
  );
  const rejected = firstRecord(
    result.rejected,
    result.rejected_concept,
    output?.rejected,
    output?.rejected_concept,
  );
  const directOutput = isRepairPayload(output, currentCandidate) ? output : null;
  const directResult = isRepairPayload(result, currentCandidate) ? result : null;
  const payload = edited || rejected || directOutput || directResult;
  if (payload) {
    const payloadStableKey = resolveStableKey(clean(payload.stable_key || stableKey), input, currentCandidate);
    const payloadKeyParts = parseStableKey(payloadStableKey);
    return {
      ...payload,
      stable_key: payloadStableKey,
      task_id: clean(payload.task_id || payloadStableKey),
      chapter_id: clean(payload.chapter_id || result.chapter_id || payloadKeyParts.chapter_id || keyParts.chapter_id),
      formula_id: clean(payload.formula_id || result.formula_id || payloadKeyParts.formula_id || keyParts.formula_id),
      symbol: clean(payload.symbol || result.symbol || payloadKeyParts.symbol || keyParts.symbol),
      role: clean(payload.role || result.role || payloadKeyParts.role || keyParts.role),
      concept_type: clean(payload.concept_type || currentCandidate?.concept_type),
      review_status: clean(payload.review_status || status || (rejected ? 'rejected' : 'edited')),
      review_notes: [payload.review_notes, output?.reasoning, result.review_notes]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (isRejectedDecision(output) || isRejectedDecision(result)) {
    const payloadStableKey = stableKey;
    const payloadKeyParts = parseStableKey(payloadStableKey);
    return {
      ...(currentCandidate || {}),
      stable_key: payloadStableKey,
      task_id: clean(result.task_id || payloadStableKey),
      chapter_id: clean(result.chapter_id || input?.chapter_id || payloadKeyParts.chapter_id || keyParts.chapter_id),
      formula_id: clean(result.formula_id || input?.formula_id || payloadKeyParts.formula_id || keyParts.formula_id),
      symbol: clean(result.symbol || input?.symbol || payloadKeyParts.symbol || keyParts.symbol),
      role: clean(result.role || input?.symbol_role || payloadKeyParts.role || keyParts.role),
      concept_name: clean(currentCandidate?.concept_name || 'Rejected concept candidate'),
      concept_type: clean(currentCandidate?.concept_type || 'quantity_concept'),
      definition: clean(currentCandidate?.definition || 'Rejected because local evidence does not define this symbol as a learner-facing concept.'),
      definition_zh: clean(currentCandidate?.definition_zh || currentCandidate?.definition || 'Rejected because local evidence does not define this symbol as a learner-facing concept.'),
      confidence: Number(currentCandidate?.confidence || 0.75),
      review_flags: Array.isArray(currentCandidate?.review_flags) ? currentCandidate.review_flags : [],
      review_status: 'rejected',
      review_notes: clean(output?.reason || output?.review_notes || result.reason || result.review_notes || 'LLM rejected this concept candidate.'),
    };
  }

  const cohortMember = Array.isArray(result.cohort_members) ? result.cohort_members.find((item) => isRecord(item) && isRecord(item.edited_concept || item.repaired_concept || item.rejected_concept)) : null;
  if (cohortMember) {
    const memberPayload = firstRecord(cohortMember.edited_concept, cohortMember.repaired_concept, cohortMember.rejected_concept);
    return {
      ...memberPayload,
      stable_key: clean(memberPayload.stable_key || cohortMember.stable_key || stableKey),
      task_id: clean(memberPayload.task_id || cohortMember.stable_key || stableKey),
      chapter_id: clean(memberPayload.chapter_id || cohortMember.chapter_id),
      formula_id: clean(memberPayload.formula_id || cohortMember.formula_id),
      symbol: clean(memberPayload.symbol || cohortMember.symbol),
      role: clean(memberPayload.role || cohortMember.role),
      review_status: clean(memberPayload.review_status || cohortMember.review_status || cohortMember.status || (cohortMember.rejected_concept ? 'rejected' : 'edited')),
      review_notes: [memberPayload.review_notes, result.review_notes]
        .filter(Boolean)
        .join('\n'),
    };
  }

  return null;
}

function firstRecord(...values) {
  return values.find(isRecord) || null;
}

function isRepairPayload(value, fallback = null) {
  return isRecord(value)
    && typeof value.concept_name === 'string'
    && (typeof value.concept_type === 'string' || typeof fallback?.concept_type === 'string')
    && typeof value.definition === 'string';
}

function isRejectedDecision(value) {
  if (!isRecord(value)) return false;
  const decision = clean(value.review_status || value.status || value.decision).toLowerCase();
  return decision === 'rejected' || decision === 'reject';
}

function parseStableKey(stableKey = '') {
  const parts = clean(stableKey).split('::');
  if (parts.length < 4) return {};
  const [chapterId, formulaId, role, ...symbolParts] = parts;
  return {
    chapter_id: clean(chapterId),
    formula_id: clean(formulaId),
    role: clean(role),
    symbol: clean(symbolParts.join('::')),
  };
}

function resolveStableKey(stableKey = '', input = null, currentCandidate = null) {
  const key = clean(stableKey);
  if (!key.startsWith('anchor::')) return key;
  return stableKeyFromInput(input) || stableKeyFromConcept(currentCandidate) || key;
}

function stableKeyFromInput(input) {
  if (!isRecord(input)) return '';
  const chapterId = clean(input.chapter_id);
  const formulaId = clean(input.formula_id);
  const role = clean(input.symbol_role || input.role);
  const symbol = clean(input.symbol);
  if (!chapterId || !formulaId || !role || !symbol) return '';
  return [chapterId, formulaId, role, symbol].join('::');
}

function stableKeyFromConcept(concept) {
  if (!isRecord(concept)) return '';
  const chapterId = clean(concept.chapter_id);
  const formulaId = clean(concept.formula_id);
  const role = clean(concept.symbol_role || concept.role);
  const symbol = clean(concept.symbol);
  if (!chapterId || !formulaId || !role || !symbol) return '';
  return [chapterId, formulaId, role, symbol].join('::');
}

async function readCohortMap(manifestPath) {
  const manifest = JSON.parse(stripBom(await readFile(manifestPath, 'utf8')));
  const map = new Map();
  for (const cohort of manifest.cohorts || []) {
    if (!cohort.cohort_id || !Array.isArray(cohort.members)) continue;
    map.set(cohort.cohort_id, cohort.members.filter(isRecord));
  }
  return map;
}

function expandCohortResult(result, customId, cohortMap) {
  const members = cohortMap.get(clean(customId));
  if (!members?.length) return [{ ...result }];
  return members.map((member) => ({
    ...result,
    stable_key: member.stable_key,
    task_id: member.stable_key,
    chapter_id: member.chapter_id || chapterFromResult(member),
    formula_id: member.formula_id || result.formula_id,
    symbol: member.symbol || result.symbol,
    role: member.role || result.role,
    retry_attempt: nonNegativeInteger(member.retry_attempt, nonNegativeInteger(result.retry_attempt, 0)),
    review_notes: [result.review_notes, `Expanded from LLM cohort ${customId}.`].filter(Boolean).join('\n'),
  }));
}

function extractText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  if (typeof value.output_text === 'string') return value.output_text;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  const choiceContent = value.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;
  const outputText = value.output
    ?.flatMap((item) => Array.isArray(item.content) ? item.content : [])
    ?.map((content) => content.text || content.value || '')
    ?.filter(Boolean)
    ?.join('\n');
  return outputText || '';
}

function stripJsonFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function isRepairResult(value) {
  return isRecord(value)
    && typeof value.formula_id === 'string'
    && typeof value.symbol === 'string'
    && typeof value.concept_name === 'string'
    && typeof value.review_status === 'string';
}

function chapterFromResult(result) {
  const explicit = clean(result.chapter_id);
  if (explicit) return explicit;
  const key = clean(result.stable_key || result.task_id);
  const [chapterId] = key.split('::');
  return chapterId || '';
}

function errorItem(lineNumber, reason, raw, error = null) {
  return {
    line: lineNumber,
    reason,
    error: error instanceof Error ? error.message : '',
    raw,
  };
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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
    else if (arg === '--output-dir') options.outputDir = args[++index];
    else if (arg === '--manifest') options.manifest = args[++index];
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
  console.log(`Collect concept LLM repair results

Usage:
  node scripts/collect-concept-llm-results.mjs --input tmp/batch_output.jsonl
  node scripts/collect-concept-llm-results.mjs --input tmp/batch_output.jsonl --manifest tmp/concept-review/auto_fix/llm_batches/manifest.json

Outputs:
  tmp/concept-review/auto_fix/<chapter_id>_llm_results.jsonl
  tmp/concept-review/auto_fix/llm_result_collect_summary.json
  tmp/concept-review/auto_fix/llm_result_parse_errors.json
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
