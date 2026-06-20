#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_DIR = path.join(ROOT, 'tmp', 'concept-review');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix');
const DEFAULT_REPORT = path.join(ROOT, 'tmp', 'concept-review', 'automation', 'concept_review_pipeline_report.json');
const DEFAULT_RESPONSES_MODEL = 'gpt-5-mini';
const DEFAULT_CHAT_MODEL = 'deepseek-chat';
const DEFAULT_API_FORMAT = 'chat-completions';
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_MAX_RETRY_CYCLES = 2;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(process.cwd(), options.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);
  const reportPath = path.resolve(process.cwd(), options.report || DEFAULT_REPORT);
  const maxRetryCycles = nonNegativeInteger(options.maxRetryCycles, DEFAULT_MAX_RETRY_CYCLES, '--max-retry-cycles');
  const report = {
    version: 1,
    generated_at: utcNow(),
    source: {
      input_dir: relative(inputDir),
      output_dir: relative(outputDir),
      scope: options.chapter ? { chapter: options.chapter } : { all_chapters: true },
      apply_mode: Boolean(options.apply),
      llm_execution: options.runLlm ? `run_${apiFormat(options)}` : options.llmOutput ? 'provided_output' : 'prepare_only',
      llm_api_format: apiFormat(options),
      llm_model: llmModel(options),
      max_retry_cycles: maxRetryCycles,
    },
    stages: [],
    counts: {},
    status: 'started',
    next_step: null,
  };

  await mkdir(outputDir, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });

  const scopeArgs = options.chapter ? ['--chapter', options.chapter] : ['--all'];
  const ruleArgs = [
    'scan',
    ...scopeArgs,
    '--summary',
    '--input-dir',
    inputDir,
    '--output-dir',
    outputDir,
  ];
  if (options.apply) ruleArgs.push('--apply');
  await runNodeScript('scripts/auto-fix-concept-review.mjs', ruleArgs, report, 'rules_first_scan');
  const ruleSummary = await readJson(path.join(outputDir, 'auto_fix_summary.json'));
  report.rule_scan = ruleSummary;

  let importSummary = null;
  let retryQueueEntries = 0;
  const initialLlmQueue = Number(ruleSummary?.counts?.llm_queue || 0);
  if (initialLlmQueue > 0) {
    const prepared = await prepareLlmBatch({
      cycle: 0,
      queueType: 'initial',
      inputDir: outputDir,
      outputDir: path.join(outputDir, 'llm_batches'),
      scopeArgs,
      options,
      report,
    });

    const llmOutput = await resolveLlmOutput({
      cycle: 0,
      manifestPath: prepared.manifestPath,
      providedOutput: options.llmOutput,
      options,
      report,
    });

    if (!llmOutput) {
      report.status = 'awaiting_llm_results';
      report.next_step = `Run npm run concept:review:run-llm -- --manifest ${relative(prepared.manifestPath)}, then rerun this pipeline with --llm-output <jsonl>${options.apply ? ' --apply' : ''}.`;
    } else {
      importSummary = await collectAndImport({
        cycle: 0,
        inputPath: llmOutput,
        manifestPath: prepared.manifestPath,
        inputDir,
        outputDir,
        scopeArgs,
        options,
        report,
      });
      retryQueueEntries = Number(importSummary?.counts?.retry || 0);
    }
  } else {
    report.status = 'rules_only_complete';
  }

  for (let retryCycle = 1; retryCycle <= maxRetryCycles && retryQueueEntries > 0; retryCycle += 1) {
    const prepared = await prepareLlmBatch({
      cycle: retryCycle,
      queueType: 'retry',
      inputDir: outputDir,
      outputDir: path.join(outputDir, `llm_batches_retry_${retryCycle}`),
      scopeArgs,
      options,
      report,
    });
    const retryOutput = await resolveLlmOutput({
      cycle: retryCycle,
      manifestPath: prepared.manifestPath,
      providedOutput: retryCycle === 1 ? options.retryLlmOutput : null,
      options,
      report,
    });
    if (!retryOutput) {
      report.status = 'awaiting_retry_llm_results';
      report.next_step = `Run npm run concept:review:run-llm -- --manifest ${relative(prepared.manifestPath)}, then rerun with --retry-llm-output <jsonl>${options.apply ? ' --apply' : ''}.`;
      break;
    }
    importSummary = await collectAndImport({
      cycle: retryCycle,
      inputPath: retryOutput,
      manifestPath: prepared.manifestPath,
      inputDir,
      outputDir,
      scopeArgs,
      options,
      report,
    });
    retryQueueEntries = Number(importSummary?.counts?.retry || 0);
    if (retryQueueEntries === 0) {
      report.status = 'llm_import_complete';
      report.next_step = options.apply
        ? 'Regenerate concept graphs and run release audit.'
        : 'Rerun with --apply after inspecting the rule and LLM patches.';
    }
  }

  if (retryQueueEntries > 0 && !report.status.startsWith('awaiting_')) {
    report.status = 'human_fallback_ready';
    report.next_step = `Review exhausted retry items in ${relative(outputDir)}/*_llm_human_review_queue.json.`;
  }

  const auditPath = path.join(path.dirname(reportPath), 'concept_review_audit.json');
  const auditArgs = [
    '--input-dir',
    inputDir,
    '--output',
    auditPath,
  ];
  if (options.chapter) auditArgs.push('--chapter', options.chapter);
  await runNodeScript('scripts/audit-concept-review.mjs', auditArgs, report, 'quality_audit');
  report.audit = await readJson(auditPath);

  const fallbackCounts = await countFallbackQueues(outputDir);
  report.counts = {
    rule_patch_entries: Number(ruleSummary?.counts?.patch_entries || 0),
    llm_initial_queue_entries: initialLlmQueue,
    llm_accepted_entries: Number(importSummary?.counts?.accepted || 0),
    llm_rejected_entries: Number(importSummary?.counts?.rejected || 0),
    llm_retry_queue_entries: retryQueueEntries,
    human_review_queue_entries: fallbackCounts.initialHuman + fallbackCounts.llmHuman,
    audit_human_review_queue_entries: Number(report.audit?.summary?.human_review_queue_entries || 0),
    audit_auto_fix_queue_entries: Number(report.audit?.summary?.auto_fix_queue_entries || 0),
  };
  report.fallback_queues = fallbackCounts;
  report.automation_metrics = await buildAutomationMetrics({
    outputDir,
    ruleSummary,
    importSummary,
    fallbackCounts,
    audit: report.audit,
  });

  if (report.status === 'started') {
    report.status = importSummary ? 'llm_import_complete' : 'rules_only_complete';
    report.next_step = options.apply
      ? 'Regenerate concept graphs and run release audit.'
      : 'Rerun with --apply after inspecting generated patches.';
  }

  await writeJson(reportPath, report);
  printSummary(report, reportPath);
}

async function prepareLlmBatch({ cycle, queueType, inputDir, outputDir, scopeArgs, options, report }) {
  const args = [
    ...scopeArgs,
    '--queue-type',
    queueType,
    '--input-dir',
    inputDir,
    '--output-dir',
    outputDir,
    '--batch-size',
    String(positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, '--batch-size')),
    '--format',
    'openai-responses',
    '--model',
    llmModel(options),
  ];
  if (options.cohort !== false) args.push('--cohort');
  if (options.maxItems) args.push('--max-items', String(options.maxItems));
  await runNodeScript('scripts/prepare-concept-llm-batches.mjs', args, report, `prepare_${queueType}_llm_batch_${cycle}`);
  const manifestPath = path.join(outputDir, 'manifest.json');
  const manifest = await readJson(manifestPath);
  report.stages.push({
    stage: `manifest_${queueType}_${cycle}`,
    path: relative(manifestPath),
    counts: manifest.counts,
  });
  return { manifestPath, manifest };
}

async function resolveLlmOutput({ cycle, manifestPath, providedOutput, options, report }) {
  if (providedOutput) return path.resolve(process.cwd(), providedOutput);
  if (!options.runLlm) return null;
  const outputPath = path.join(
    path.dirname(path.dirname(manifestPath)),
    cycle === 0 ? 'llm_batch_output.jsonl' : `llm_batch_output_retry_${cycle}.jsonl`,
  );
  const args = [
    '--manifest',
    manifestPath,
    '--output',
    outputPath,
    '--api-format',
    apiFormat(options),
    '--model',
    llmModel(options),
  ];
  if (options.apiUrl) args.push('--api-url', options.apiUrl);
  if (options.apiKeyEnv) args.push('--api-key-env', options.apiKeyEnv);
  if (options.concurrency) args.push('--concurrency', String(options.concurrency));
  if (options.maxItems) args.push('--max-items', String(options.maxItems));
  if (options.progress) args.push('--progress', String(options.progress));
  await runNodeScript('scripts/run-concept-llm-batches.mjs', args, report, `run_llm_cycle_${cycle}`);
  return outputPath;
}

async function collectAndImport({ cycle, inputPath, manifestPath, inputDir, outputDir, scopeArgs, options, report }) {
  await runNodeScript('scripts/collect-concept-llm-results.mjs', [
    '--input',
    inputPath,
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
  ], report, `collect_llm_results_${cycle}`);

  const importArgs = [
    'import-llm-results',
    ...scopeArgs,
    '--summary',
    '--input-dir',
    inputDir,
    '--output-dir',
    outputDir,
  ];
  if (options.apply) importArgs.push('--apply');
  await runNodeScript('scripts/auto-fix-concept-review.mjs', importArgs, report, `import_llm_results_${cycle}`);
  const summary = await readJson(path.join(outputDir, 'llm_import_summary.json'));
  report.llm_import = summary;
  return summary;
}

async function runNodeScript(script, args, report, stage) {
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(process.execPath, [path.join(ROOT, script), ...args], {
      cwd: ROOT,
      maxBuffer: 1024 * 1024 * 30,
    });
    report.stages.push({
      stage,
      command: ['node', script, ...redactArgs(args)].join(' '),
      exit_code: 0,
      duration_ms: Date.now() - startedAt,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
    });
    return result;
  } catch (error) {
    report.stages.push({
      stage,
      command: ['node', script, ...redactArgs(args)].join(' '),
      exit_code: error.code ?? 1,
      duration_ms: Date.now() - startedAt,
      stdout: trimOutput(error.stdout),
      stderr: trimOutput(error.stderr || error.message),
    });
    throw error;
  }
}

async function countFallbackQueues(outputDir) {
  const counts = {
    initialHuman: 0,
    llmHuman: 0,
    retryQueue: 0,
    files: [],
  };
  if (!await directoryExists(outputDir)) return counts;
  for (const file of await readdir(outputDir)) {
    const filePath = path.join(outputDir, file);
    if (file.endsWith('_human_review_queue.json') || file.endsWith('_llm_human_review_queue.json')) {
      const payload = await readJson(filePath);
      const entries = Array.isArray(payload.entries) ? payload.entries.length : 0;
      if (file.endsWith('_llm_human_review_queue.json')) counts.llmHuman += entries;
      else counts.initialHuman += entries;
      counts.files.push({ path: relative(filePath), entries });
    }
    if (file.endsWith('_llm_retry_queue.jsonl')) {
      const entries = await countJsonl(filePath);
      counts.retryQueue += entries;
      counts.files.push({ path: relative(filePath), entries });
    }
  }
  return counts;
}

async function buildAutomationMetrics({ outputDir, ruleSummary, importSummary, fallbackCounts, audit }) {
  const rulePatches = await summarizePatchFiles(outputDir);
  const llmQueue = await summarizeLlmQueueFiles(outputDir, '_llm_queue.jsonl');
  const retryQueue = await summarizeLlmQueueFiles(outputDir, '_llm_retry_queue.jsonl');
  const humanFallback = await summarizeHumanQueueFiles(outputDir);
  const llmRejected = await summarizeRejectedQueueFiles(outputDir);
  const ruleResolved = Number(ruleSummary?.counts?.patch_entries || 0);
  const llmQueued = Number(ruleSummary?.counts?.llm_queue || 0);
  const llmAccepted = Number(importSummary?.counts?.accepted || 0);
  const retryEntries = Number(importSummary?.counts?.retry || fallbackCounts.retryQueue || 0);
  const humanEntries = Number(fallbackCounts.initialHuman || 0) + Number(fallbackCounts.llmHuman || 0);
  const activeReviewWork = ruleResolved + llmQueued + humanEntries;
  const finishedAutomation = ruleResolved + llmAccepted;
  const terminalWork = finishedAutomation + retryEntries + humanEntries;
  return {
    coverage: {
      active_review_work_items: activeReviewWork,
      automatically_resolved_items: finishedAutomation,
      automation_resolution_rate: ratio(finishedAutomation, activeReviewWork),
      terminal_automation_resolution_rate: ratio(finishedAutomation, terminalWork),
      rules_first_resolution_rate: ratio(ruleResolved, activeReviewWork),
      llm_queue_rate: ratio(llmQueued, activeReviewWork),
      llm_acceptance_rate: ratio(llmAccepted, Number(importSummary?.counts?.accepted || 0) + Number(importSummary?.counts?.rejected || 0)),
      human_fallback_rate: ratio(humanEntries, terminalWork),
      audit_open_review_entries: Number(audit?.summary?.open_review_entries || 0),
      audit_auto_fix_queue_entries: Number(audit?.summary?.auto_fix_queue_entries || 0),
      audit_human_review_queue_entries: Number(audit?.summary?.human_review_queue_entries || 0),
    },
    rule_patches: rulePatches,
    llm_queue: llmQueue,
    retry_queue: retryQueue,
    human_fallback: humanFallback,
    llm_rejected: llmRejected,
  };
}

async function summarizePatchFiles(outputDir) {
  const summary = emptyBreakdown();
  if (!await directoryExists(outputDir)) return summary;
  for (const file of await readdir(outputDir)) {
    if (!file.endsWith('_auto_fix_patch.json') && !file.endsWith('_llm_import_patch.json')) continue;
    const payload = await readJson(path.join(outputDir, file));
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    summary.files.push({ path: relative(path.join(outputDir, file)), entries: entries.length });
    for (const entry of entries) {
      summary.total += 1;
      increment(summary.by_chapter, entry.chapter_id || payload.chapter_id || 'unknown');
      increment(summary.by_role, entry.role || 'unknown');
      increment(summary.by_status, entry.review_status || 'unknown');
      increment(summary.by_action, patchAction(entry));
      for (const flag of entry.review_flags || []) increment(summary.by_flag, flag);
    }
  }
  sortBreakdown(summary);
  return summary;
}

async function summarizeLlmQueueFiles(outputDir, suffix) {
  const summary = emptyBreakdown();
  if (!await directoryExists(outputDir)) return summary;
  for (const file of await readdir(outputDir)) {
    if (!file.endsWith(suffix)) continue;
    const filePath = path.join(outputDir, file);
    const records = await readJsonl(filePath);
    summary.files.push({ path: relative(filePath), entries: records.length });
    for (const record of records) {
      const input = record.input || record;
      const current = input.current_candidate || {};
      summary.total += 1;
      increment(summary.by_chapter, input.chapter_id || record.chapter_id || 'unknown');
      increment(summary.by_role, input.symbol_role || input.role || record.role || 'unknown');
      for (const reason of input.auto_fix_reasons || record.auto_fix_reasons || []) increment(summary.by_reason, reason);
      for (const flag of current.review_flags || input.review_flags || []) increment(summary.by_flag, flag);
    }
  }
  sortBreakdown(summary);
  return summary;
}

async function summarizeHumanQueueFiles(outputDir) {
  const summary = emptyBreakdown();
  if (!await directoryExists(outputDir)) return summary;
  for (const file of await readdir(outputDir)) {
    if (!file.endsWith('_human_review_queue.json') && !file.endsWith('_llm_human_review_queue.json')) continue;
    const filePath = path.join(outputDir, file);
    const payload = await readJson(filePath);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    summary.files.push({ path: relative(filePath), entries: entries.length });
    for (const entry of entries) {
      summary.total += 1;
      increment(summary.by_chapter, entry.chapter_id || payload.chapter_id || 'unknown');
      increment(summary.by_role, entry.role || 'unknown');
      increment(summary.by_status, entry.review_status || entry.resolution || 'unknown');
      for (const reason of entry.reasons || entry.validation_errors || []) increment(summary.by_reason, reason);
      for (const flag of entry.review_flags || []) increment(summary.by_flag, flag);
    }
  }
  sortBreakdown(summary);
  return summary;
}

async function summarizeRejectedQueueFiles(outputDir) {
  const summary = emptyBreakdown();
  if (!await directoryExists(outputDir)) return summary;
  for (const file of await readdir(outputDir)) {
    if (!file.endsWith('_llm_rejected_queue.json')) continue;
    const filePath = path.join(outputDir, file);
    const payload = await readJson(filePath);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    summary.files.push({ path: relative(filePath), entries: entries.length });
    for (const entry of entries) {
      summary.total += 1;
      increment(summary.by_chapter, entry.chapter_id || payload.chapter_id || 'unknown');
      increment(summary.by_status, entry.resolution || 'unknown');
      for (const reason of entry.validation_errors || entry.reasons || []) increment(summary.by_reason, reason);
    }
  }
  sortBreakdown(summary);
  return summary;
}

function emptyBreakdown() {
  return {
    total: 0,
    by_action: {},
    by_chapter: {},
    by_role: {},
    by_status: {},
    by_reason: {},
    by_flag: {},
    files: [],
  };
}

async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function patchAction(entry) {
  const notes = String(entry.review_notes || '').toLowerCase();
  if (entry.review_status === 'rejected') return 'rule_rejected';
  if (notes.includes('rule calibration')) return 'rule_calibrated';
  if (notes.includes('standard symbol repair')) return 'rule_standard_symbol_repair';
  if (notes.includes('trusted dictionary')) return 'rule_trusted_dictionary';
  if (notes.includes('rule rewrite')) return 'rule_rewritten';
  if (entry.reviewed_by === 'auto_llm_fix') return 'llm_accepted';
  if (entry.reviewed_by === 'auto_rule_fix') return 'rule_other';
  return 'unknown';
}

function sortBreakdown(summary) {
  for (const key of ['by_action', 'by_chapter', 'by_role', 'by_status', 'by_reason', 'by_flag']) {
    summary[key] = sortCountObject(summary[key]);
  }
  summary.files.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' }));
}

function sortCountObject(value) {
  return Object.fromEntries(Object.entries(value).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function increment(target, key) {
  const clean = String(key || 'unknown');
  target[clean] = (target[clean] || 0) + 1;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

async function countJsonl(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).length;
}

async function readJson(filePath) {
  return JSON.parse(stripBom(await readFile(filePath, 'utf8')));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function directoryExists(dirPath) {
  try {
    await access(dirPath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(args) {
  const options = { cohort: true };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output-dir') options.outputDir = args[++index];
    else if (arg === '--report') options.report = args[++index];
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--run-llm') options.runLlm = true;
    else if (arg === '--llm-output') options.llmOutput = args[++index];
    else if (arg === '--retry-llm-output') options.retryLlmOutput = args[++index];
    else if (arg === '--max-retry-cycles') options.maxRetryCycles = args[++index];
    else if (arg === '--max-items') options.maxItems = positiveInteger(args[++index], null, '--max-items');
    else if (arg === '--batch-size') options.batchSize = args[++index];
    else if (arg === '--model') options.model = args[++index];
    else if (arg === '--api-format') options.apiFormat = parseApiFormat(args[++index]);
    else if (arg === '--api-url') options.apiUrl = args[++index];
    else if (arg === '--api-key-env') options.apiKeyEnv = args[++index];
    else if (arg === '--concurrency') options.concurrency = positiveInteger(args[++index], null, '--concurrency');
    else if (arg === '--progress') options.progress = args[++index];
    else if (arg === '--no-cohort') options.cohort = false;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function apiFormat(options) {
  return options.apiFormat || DEFAULT_API_FORMAT;
}

function llmModel(options) {
  if (options.model) return options.model;
  return apiFormat(options) === 'chat-completions' ? DEFAULT_CHAT_MODEL : DEFAULT_RESPONSES_MODEL;
}

function parseApiFormat(value) {
  if (value === 'responses' || value === 'chat-completions') return value;
  throw new Error('--api-format must be responses or chat-completions');
}

function nonNegativeInteger(value, fallback, optionName) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${optionName} must be a non-negative integer`);
  return number;
}

function positiveInteger(value, fallback, optionName) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${optionName} must be a positive integer`);
  return number;
}

function redactArgs(args) {
  const secrets = [process.env.OPENAI_API_KEY, process.env.DEEPSEEK_API_KEY].filter(Boolean);
  return args.map((value) => secrets.some((secret) => String(value).includes(secret)) ? '<redacted>' : String(value));
}

function trimOutput(value = '') {
  const text = String(value || '').trim();
  if (text.length <= 3000) return text;
  return `${text.slice(0, 3000)}\n... <truncated>`;
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function relative(targetPath) {
  return path.relative(ROOT, path.resolve(targetPath)).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printSummary(report, reportPath) {
  console.log(`Concept review pipeline -> ${relative(reportPath)}`);
  console.log(`  status: ${report.status}`);
  console.log(`  rule patch entries: ${report.counts.rule_patch_entries}`);
  console.log(`  LLM initial queue: ${report.counts.llm_initial_queue_entries}`);
  console.log(`  LLM accepted: ${report.counts.llm_accepted_entries}`);
  console.log(`  retry queue: ${report.counts.llm_retry_queue_entries}`);
  console.log(`  human fallback: ${report.counts.human_review_queue_entries}`);
  if (report.next_step) console.log(`  next: ${report.next_step}`);
}

function printHelp() {
  console.log(`Concept review automation pipeline

Usage:
  node scripts/concept-review-pipeline.mjs [--chapter chapter2]
  node scripts/concept-review-pipeline.mjs --apply
  node scripts/concept-review-pipeline.mjs --llm-output tmp/concept-review/auto_fix/llm_batch_output.jsonl --apply
  node scripts/concept-review-pipeline.mjs --run-llm --apply

Default behavior is safe dry-run:
  1. apply deterministic rules to patch files only
  2. prepare Responses-style LLM repair batches
  3. stop with a report if no LLM output is supplied

Options:
  --apply                Write accepted rule/LLM repairs back to tmp/concept-review maps
  --run-llm              Call the configured LLM API for prepared batches
  --llm-output <jsonl>   Use an existing model output JSONL for the first LLM cycle
  --retry-llm-output     Use an existing model output JSONL for the first retry cycle
  --api-format <format>  LLM API transport: chat-completions (default, DeepSeek) or responses
  --api-url <url>        Override the LLM API endpoint
  --api-key-env <name>   Override the API key environment variable
  --model <name>         Override model (default: deepseek-chat for chat-completions)
  --concurrency N        Number of LLM requests to run in parallel
  --max-retry-cycles N   Retry invalid LLM repairs before human fallback (default 2)
  --no-cohort            Do not collapse repeated queue items into cohort tasks
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
