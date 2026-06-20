#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CONCEPT_GRAPH_DIR = path.resolve(ROOT, 'tmp/concept-review');
const DEFAULT_OUTPUT_PATH = path.resolve(DEFAULT_CONCEPT_GRAPH_DIR, 'concept_review_audit.json');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const DEFAULT_QUEUE_LIMIT = 500;
const OPEN_REVIEW_STATUSES = new Set(['unreviewed', 'flagged', 'ambiguous', 'needs_revision']);
const HIGH_RISK_FLAGS = new Set([
  'index_like_defined_symbol',
]);
const HUMAN_REVIEW_FLAGS = new Set([
  ...HIGH_RISK_FLAGS,
]);
const AUTO_FIX_FLAGS = new Set([
  'generic_defined_concept_name',
  'low_confidence',
  'needs_review',
  'template_definition',
  'formula_or_symbol_artifact',
  'llm_rejected',
]);
const AUTO_GATE_MAX_HUMAN_REVIEW_RATIO = 0.08;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const conceptGraphDir = path.resolve(ROOT, options.inputDir || DEFAULT_CONCEPT_GRAPH_DIR);
  const outputPath = path.resolve(ROOT, options.output || DEFAULT_OUTPUT_PATH);
  const queueLimit = finiteOrDefault(options.limit, DEFAULT_QUEUE_LIMIT);
  const chapterFilter = options.chapter || null;
  const mergeCandidates = await readJsonIfExists(path.join(conceptGraphDir, 'concept_merge_candidates.json'));
  const mergeByStableKey = buildMergeLookup(mergeCandidates);

  const mapFiles = (await readdir(conceptGraphDir))
    .filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX))
    .filter((file) => !chapterFilter || file === `${chapterFilter}${SYMBOL_CONCEPT_MAP_SUFFIX}`)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));

  if (!mapFiles.length) {
    throw new Error(chapterFilter ? `No symbol-concept map found for ${chapterFilter}.` : 'No symbol-concept maps found.');
  }

  const chapters = [];
  const humanReviewQueue = [];
  const autoFixQueue = [];
  const mergeQueue = [];

  for (const file of mapFiles) {
    const payload = JSON.parse(await readFile(path.join(conceptGraphDir, file), 'utf8'));
    const chapterAudit = auditChapter(payload, mergeByStableKey);
    chapters.push(chapterAudit.summary);
    humanReviewQueue.push(...chapterAudit.humanQueue);
    autoFixQueue.push(...chapterAudit.autoFixQueue);
    mergeQueue.push(...chapterAudit.mergeQueue);
  }

  const sortQueue = (queue) => queue.sort((left, right) => {
    if (right.priority_score !== left.priority_score) return right.priority_score - left.priority_score;
    return left.stable_key.localeCompare(right.stable_key);
  });
  sortQueue(humanReviewQueue);
  sortQueue(autoFixQueue);
  sortQueue(mergeQueue);

  const summary = summarizeChapters(chapters, mergeCandidates, {
    humanReviewQueueSize: humanReviewQueue.length,
    autoFixQueueSize: autoFixQueue.length,
    mergeQueueSize: mergeQueue.length,
  });
  const report = {
    version: 1,
    generated_at: utcNow(),
    source: {
      symbol_concept_maps: `${relative(conceptGraphDir)}/*${SYMBOL_CONCEPT_MAP_SUFFIX}`,
      merge_candidates: mergeCandidates ? `${relative(conceptGraphDir)}/concept_merge_candidates.json` : null,
      method: 'automatic quality audit with separate human review, auto-fix, and merge queues',
    },
    completion_gate: completionGate(summary),
    summary,
    chapters,
    human_review_queue: humanReviewQueue.slice(0, queueLimit),
    auto_fix_queue: autoFixQueue.slice(0, queueLimit),
    merge_queue: mergeQueue.slice(0, queueLimit),
    review_queue: humanReviewQueue.slice(0, queueLimit),
    review_queue_limit: queueLimit,
    review_queue_truncated: humanReviewQueue.length > queueLimit,
    auto_fix_queue_truncated: autoFixQueue.length > queueLimit,
    merge_queue_truncated: mergeQueue.length > queueLimit,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printSummary(report, outputPath);

  if (options.failOnOpen && !report.completion_gate.passed) {
    process.exitCode = 1;
  }
}

function auditChapter(payload, mergeByStableKey) {
  const statusCounts = {};
  const typeCounts = {};
  const reviewedByCounts = {};
  let reviewedEntries = 0;
  let openReviewEntries = 0;
  let lowConfidenceEntries = 0;
  let flaggedEntries = 0;
  let highRiskFlaggedEntries = 0;
  let mergeCandidateEntries = 0;
  let canonicalMergeResolvedEntries = 0;
  const humanQueue = [];
  const autoFixQueue = [];
  const mergeQueue = [];

  for (const concept of payload.symbol_concepts || []) {
    const status = concept.review_status || 'unreviewed';
    const flags = Array.isArray(concept.review_flags) ? concept.review_flags : [];
    const stableKey = stableKeyFor(concept);
    const rawMergeGroups = mergeByStableKey.get(stableKey) || [];
    const mergeGroups = rawMergeGroups.filter((group) => !isCanonicalMergeResolved(concept, group));
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    typeCounts[concept.concept_type || 'unknown'] = (typeCounts[concept.concept_type || 'unknown'] || 0) + 1;
    if (concept.reviewed_by) reviewedByCounts[concept.reviewed_by] = (reviewedByCounts[concept.reviewed_by] || 0) + 1;
    if (status !== 'unreviewed') reviewedEntries += 1;
    if (OPEN_REVIEW_STATUSES.has(status)) openReviewEntries += 1;
    if (Number(concept.confidence || 0) < 0.72) lowConfidenceEntries += 1;
    if (flags.length) flaggedEntries += 1;
    if (OPEN_REVIEW_STATUSES.has(status) && flags.some((flag) => HIGH_RISK_FLAGS.has(flag))) highRiskFlaggedEntries += 1;
    if (mergeGroups.length) mergeCandidateEntries += 1;
    if (rawMergeGroups.length && !mergeGroups.length) canonicalMergeResolvedEntries += 1;

    const humanItem = humanReviewQueueItem(concept);
    if (humanItem) humanQueue.push(humanItem);
    const autoFixItem = autoFixQueueItem(concept);
    if (autoFixItem) autoFixQueue.push(autoFixItem);
    const mergeItem = mergeQueueItem(concept, mergeGroups);
    if (mergeItem) mergeQueue.push(mergeItem);
  }

  const totalEntries = payload.symbol_concepts?.length || 0;
  return {
    summary: {
      chapter_id: payload.chapter_id,
      total_entries: totalEntries,
      reviewed_entries: reviewedEntries,
      unreviewed_entries: totalEntries - reviewedEntries,
      open_review_entries: openReviewEntries,
      low_confidence_entries: lowConfidenceEntries,
      flagged_entries: flaggedEntries,
      high_risk_flagged_entries: highRiskFlaggedEntries,
      merge_candidate_entries: mergeCandidateEntries,
      canonical_merge_resolved_entries: canonicalMergeResolvedEntries,
      review_completion_ratio: ratio(reviewedEntries, totalEntries),
      status_counts: statusCounts,
      concept_type_counts: typeCounts,
      reviewed_by_counts: reviewedByCounts,
    },
    humanQueue,
    autoFixQueue,
    mergeQueue,
  };
}

function baseQueueItem(concept, reasons, score) {
  if (!reasons.length) return null;
  return {
    stable_key: stableKeyFor(concept),
    priority_score: score + (concept.role === 'defined' ? 8 : 0),
    reasons,
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    symbol: concept.symbol,
    role: concept.role,
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    confidence: Number(concept.confidence || 0),
    review_status: concept.review_status || 'unreviewed',
    review_flags: Array.isArray(concept.review_flags) ? concept.review_flags : [],
  };
}

function humanReviewQueueItem(concept) {
  const status = concept.review_status || 'unreviewed';
  if (!OPEN_REVIEW_STATUSES.has(status)) return null;
  const flags = Array.isArray(concept.review_flags) ? concept.review_flags : [];
  const highRiskFlags = flags.filter((flag) => HIGH_RISK_FLAGS.has(flag));
  const queueFlags = flags.filter((flag) => HUMAN_REVIEW_FLAGS.has(flag));
  const reasons = [];
  let score = 0;

  if (status === 'ambiguous' || status === 'needs_revision' || status === 'flagged') {
    reasons.push(status);
    score += 80;
  }
  if (queueFlags.length) {
    reasons.push('flagged');
    score += 25 + Math.min(queueFlags.length * 5, 20);
  }
  if (highRiskFlags.length) {
    reasons.push('high_risk_flag');
    score += 70 + Math.min(highRiskFlags.length * 10, 30);
  }
  if (status === 'unreviewed' && reasons.length) {
    reasons.push('unreviewed');
    score += 10;
  }
  return baseQueueItem(concept, reasons, score);
}

function autoFixQueueItem(concept) {
  const status = concept.review_status || 'unreviewed';
  if (!OPEN_REVIEW_STATUSES.has(status)) return null;
  const flags = Array.isArray(concept.review_flags) ? concept.review_flags : [];
  const confidence = Number(concept.confidence || 0);
  const autoFlags = flags.filter((flag) => AUTO_FIX_FLAGS.has(flag));
  const reasons = [];
  let score = 0;
  if (confidence < 0.72) {
    reasons.push('low_confidence');
    score += Math.round((0.72 - confidence) * 100) + 25;
  }
  if (autoFlags.length) {
    reasons.push('auto_fix_flag');
    score += 20 + Math.min(autoFlags.length * 5, 25);
  }
  return baseQueueItem(concept, reasons, score);
}

function mergeQueueItem(concept, mergeGroups) {
  if (!mergeGroups.length) return null;
  return {
    ...baseQueueItem(concept, ['merge_candidate'], 30 + Math.min(mergeGroups.length * 5, 25)),
    merge_candidate_group_ids: mergeGroups.map((group) => group.group_id),
    canonical_candidate_names: unique(mergeGroups.map((group) => group.canonical_concept_name)),
  };
}

function isCanonicalMergeResolved(concept, group) {
  const canonicalId = normalizeText(group.canonical_concept_id);
  const canonicalName = normalizeText(group.canonical_concept_name).toLowerCase();
  const conceptCanonicalId = normalizeText(concept.canonical_concept_id);
  const conceptCanonicalName = normalizeText(concept.canonical_concept_name).toLowerCase();
  return Boolean(canonicalId && conceptCanonicalId === canonicalId)
    || Boolean(canonicalName && conceptCanonicalName === canonicalName);
}

function summarizeChapters(chapters, mergeCandidates, queueSizes) {
  const statusCounts = {};
  const typeCounts = {};
  const reviewedByCounts = {};
  for (const chapter of chapters) {
    mergeCounts(statusCounts, chapter.status_counts);
    mergeCounts(typeCounts, chapter.concept_type_counts);
    mergeCounts(reviewedByCounts, chapter.reviewed_by_counts);
  }
  const totalEntries = sum(chapters, 'total_entries');
  const reviewedEntries = sum(chapters, 'reviewed_entries');
  const openReviewEntries = sum(chapters, 'open_review_entries');

  return {
    chapters: chapters.length,
    total_entries: totalEntries,
    reviewed_entries: reviewedEntries,
    unreviewed_entries: sum(chapters, 'unreviewed_entries'),
    open_review_entries: openReviewEntries,
    low_confidence_entries: sum(chapters, 'low_confidence_entries'),
    flagged_entries: sum(chapters, 'flagged_entries'),
    high_risk_flagged_entries: sum(chapters, 'high_risk_flagged_entries'),
    merge_candidate_entries: sum(chapters, 'merge_candidate_entries'),
    canonical_merge_resolved_entries: sum(chapters, 'canonical_merge_resolved_entries'),
    merge_candidate_groups: mergeCandidates?.summary?.candidate_groups || 0,
    merge_candidate_members: mergeCandidates?.summary?.candidate_members || 0,
    review_completion_ratio: ratio(reviewedEntries, totalEntries),
    open_review_ratio: ratio(openReviewEntries, totalEntries),
    human_review_queue_entries: queueSizes.humanReviewQueueSize,
    auto_fix_queue_entries: queueSizes.autoFixQueueSize,
    merge_queue_entries: queueSizes.mergeQueueSize,
    review_queue_entries: queueSizes.humanReviewQueueSize,
    status_counts: statusCounts,
    concept_type_counts: typeCounts,
    reviewed_by_counts: reviewedByCounts,
  };
}

function completionGate(summary) {
  const blockers = [];
  const humanReviewRatio = ratio(summary.human_review_queue_entries, summary.total_entries);
  if (humanReviewRatio > AUTO_GATE_MAX_HUMAN_REVIEW_RATIO) blockers.push(`human review queue ratio ${humanReviewRatio} exceeds ${AUTO_GATE_MAX_HUMAN_REVIEW_RATIO}`);
  const unresolvedEntries = (summary.status_counts.ambiguous || 0) + (summary.status_counts.needs_revision || 0);
  if (unresolvedEntries > 0) blockers.push(`${unresolvedEntries} ambiguous or needs_revision entries`);
  return {
    passed: blockers.length === 0,
    method: 'automatic quality gate; high-confidence unreviewed entries are allowed and auto-fix work is separated from human review',
    thresholds: {
      max_human_review_queue_ratio: AUTO_GATE_MAX_HUMAN_REVIEW_RATIO,
    },
    blockers,
  };
}

function buildMergeLookup(mergeCandidates) {
  const lookup = new Map();
  if (!mergeCandidates?.chapters) return lookup;
  for (const chapter of Object.values(mergeCandidates.chapters)) {
    for (const group of chapter.groups || []) {
      for (const key of group.member_keys || []) {
        const groups = lookup.get(key) || [];
        groups.push({
          group_id: group.group_id,
          review_priority: group.review_priority,
          score: group.score,
          canonical_concept_id: group.canonical_candidate?.concept_id,
          canonical_concept_name: group.canonical_candidate?.concept_name,
        });
        lookup.set(key, groups);
      }
    }
  }
  return lookup;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function stableKeyFor(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
}

function ratio(value, total) {
  return total ? Number((value / total).toFixed(4)) : 0;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const next = String(value || '').trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(next);
  }
  return result;
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output') options.output = args[++index];
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--limit') options.limit = Number(args[++index]);
    else if (arg === '--fail-on-open') options.failOnOpen = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  return options;
}

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function printSummary(report, outputPath) {
  const summary = report.summary;
  console.log(`Concept review audit -> ${relative(outputPath)}`);
  console.log(`  reviewed: ${summary.reviewed_entries}/${summary.total_entries}`);
  console.log(`  open review entries: ${summary.open_review_entries}`);
  console.log(`  low confidence: ${summary.low_confidence_entries}`);
  console.log(`  merge candidate members: ${summary.merge_candidate_members}`);
  console.log(`  merge queue entries: ${summary.merge_queue_entries}`);
  console.log(`  canonical merge resolved: ${summary.canonical_merge_resolved_entries}`);
  console.log(`  completion gate: ${report.completion_gate.passed ? 'passed' : 'failed'}`);
  if (report.completion_gate.blockers.length) {
    console.log(`  blockers: ${report.completion_gate.blockers.join('; ')}`);
  }
}

function relative(targetPath) {
  return path.relative(ROOT, targetPath).replaceAll(path.sep, '/');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function printHelp() {
  console.log(`Concept review audit

Usage:
  node scripts/audit-concept-review.mjs
  node scripts/audit-concept-review.mjs --chapter chapter6 --limit 100
  node scripts/audit-concept-review.mjs --fail-on-open

The default command writes tmp/concept-review/concept_review_audit.json.
Use --fail-on-open as a completion gate after human review patches have been applied.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
