#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INPUT_DIR = path.resolve(ROOT, 'tmp/concept-review');
const DEFAULT_OUTPUT_DIR = path.resolve(DEFAULT_INPUT_DIR, 'auto_merge');
const DEFAULT_CANDIDATES_PATH = path.resolve(DEFAULT_INPUT_DIR, 'concept_merge_candidates.json');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const SAFE_REASONS = new Set(['exact_normalized_name', 'synonym_normalized_name', 'alias_overlap']);
const OPEN_BLOCKING_STATUSES = new Set(['ambiguous', 'needs_revision', 'rejected']);
const GENERIC_NAMES = new Set([
  'coefficient',
  'count',
  'expectation',
  'function',
  'index',
  'mean',
  'parameter',
  'probability',
  'rate',
  'time',
  'value',
  'variable',
  'variance',
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(ROOT, options.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(ROOT, options.outputDir || DEFAULT_OUTPUT_DIR);
  const candidatesPath = path.resolve(ROOT, options.candidates || DEFAULT_CANDIDATES_PATH);
  const minScore = finiteOrDefault(options.minScore, 0.94);
  const candidates = await readJson(candidatesPath);
  const selectedChapters = options.chapter ? [options.chapter] : await listMapChapters(inputDir);
  const generatedAt = utcNow();
  const reports = [];

  await mkdir(outputDir, { recursive: true });

  for (const chapterId of selectedChapters) {
    const chapterCandidates = candidates.chapters?.[chapterId];
    if (!chapterCandidates) continue;
    const mapPath = path.join(inputDir, `${chapterId}${SYMBOL_CONCEPT_MAP_SUFFIX}`);
    if (!await fileExists(mapPath)) continue;
    const mapPayload = await readJson(mapPath);
    const chapterPatch = buildChapterPatch(chapterId, mapPayload, chapterCandidates, {
      generatedAt,
      minScore,
      allowGeneric: Boolean(options.allowGeneric),
      apply: Boolean(options.apply),
    });
    await writeJson(path.join(outputDir, `${chapterId}_canonical_merge_patch.json`), chapterPatch.patch);
    await writeJson(path.join(outputDir, `${chapterId}_canonical_merge_report.json`), chapterPatch.report);
    reports.push(chapterPatch.report);
    if (options.apply && chapterPatch.patch.entries.length) {
      const applied = applyPatch(mapPayload, chapterPatch.patch);
      mapPayload.summary = summaryFor(mapPayload.chapter_id, mapPayload.symbol_concepts || []);
      mapPayload.review_updated_at = generatedAt;
      await writeJson(mapPath, mapPayload);
      chapterPatch.report.applied_entries = applied;
      await writeJson(path.join(outputDir, `${chapterId}_canonical_merge_report.json`), chapterPatch.report);
    }
  }

  const summary = summarizeReports(reports, {
    generatedAt,
    inputDir,
    outputDir,
    candidatesPath,
    apply: Boolean(options.apply),
    minScore,
  });
  await writeJson(path.join(outputDir, 'canonical_merge_summary.json'), summary);

  console.log(`Canonical merge scanned ${reports.length} chapters`);
  console.log(`  eligible groups: ${summary.counts.eligible_groups}`);
  console.log(`  patch entries: ${summary.counts.patch_entries}`);
  console.log(`  applied entries: ${summary.counts.applied_entries}`);
  console.log(`  summary: ${relative(path.join(outputDir, 'canonical_merge_summary.json'))}`);
}

function buildChapterPatch(chapterId, mapPayload, chapterCandidates, options) {
  const conceptByKey = new Map((mapPayload.symbol_concepts || []).map((concept) => [stableKey(concept), concept]));
  const entries = [];
  const groups = [];
  const skippedGroups = [];

  for (const group of chapterCandidates.groups || []) {
    const decision = decideGroup(group, conceptByKey, options);
    if (!decision.eligible) {
      skippedGroups.push(decision);
      continue;
    }
    groups.push(decision);
    entries.push(...decision.entries);
  }

  const patch = {
    chapter_id: chapterId,
    generated_at: options.generatedAt,
    source: {
      method: 'safe_canonical_concept_merge',
      merge_candidates: 'tmp/concept-review/concept_merge_candidates.json',
      apply_mode: Boolean(options.apply),
      min_score: options.minScore,
    },
    entries,
  };
  const report = {
    chapter_id: chapterId,
    generated_at: options.generatedAt,
    source: patch.source,
    candidate_groups: (chapterCandidates.groups || []).length,
    eligible_groups: groups.length,
    skipped_groups: skippedGroups.length,
    patch_entries: entries.length,
    applied_entries: 0,
    groups: groups.map((group) => ({
      group_id: group.group_id,
      canonical_concept_id: group.canonical.concept_id,
      canonical_concept_name: group.canonical.concept_name,
      entries: group.entries.length,
      reasons: group.reasons,
      score: group.score,
    })),
    skipped_reasons: countBy(skippedGroups.map((group) => group.reason)),
  };
  return { patch, report };
}

function decideGroup(group, conceptByKey, options) {
  const reasons = Array.isArray(group.reasons) ? group.reasons : [];
  const score = Number(group.score || 0);
  const canonical = group.canonical_candidate || {};
  const members = (group.member_keys || []).map((key) => conceptByKey.get(key)).filter(Boolean);
  const normalizedCanonicalName = normalizeName(canonical.concept_name);
  const typeSet = new Set(members.map((member) => member.concept_type).filter(Boolean));

  if (score < options.minScore) return skipped(group, 'score_below_threshold');
  if (!reasons.length || !reasons.every((reason) => SAFE_REASONS.has(reason))) return skipped(group, 'unsafe_reason');
  if (!canonical.concept_id || !normalizedCanonicalName) return skipped(group, 'missing_canonical');
  if (!options.allowGeneric && isGenericName(normalizedCanonicalName)) return skipped(group, 'generic_canonical_name');
  if (members.length < 2 || members.length !== (group.member_keys || []).length) return skipped(group, 'missing_members');
  if (typeSet.size > 1) return skipped(group, 'mixed_concept_types');
  if (members.some((member) => OPEN_BLOCKING_STATUSES.has(member.review_status || 'unreviewed'))) return skipped(group, 'blocking_review_status');
  if (!members.every((member) => compatibleName(member.concept_name, canonical.concept_name))) return skipped(group, 'name_mismatch');

  const entries = members
    .filter((member) => member.canonical_concept_id !== canonical.concept_id || member.canonical_concept_name !== canonical.concept_name)
    .map((member) => ({
      stable_key: stableKey(member),
      chapter_id: member.chapter_id,
      formula_id: member.formula_id,
      symbol: member.symbol,
      role: member.role,
      canonical_concept_id: canonical.concept_id,
      canonical_concept_name: canonical.concept_name,
      review_flags: unique([...(member.review_flags || []), 'auto_canonical_merge']),
      review_notes: appendReviewNote(
        member.review_notes,
        `Auto canonical merge: ${group.group_id} -> ${canonical.concept_name}.`,
      ),
    }));

  if (!entries.length) return skipped(group, 'already_canonical');
  return {
    eligible: true,
    group_id: group.group_id,
    reasons,
    score,
    canonical,
    entries,
  };
}

function skipped(group, reason) {
  return {
    eligible: false,
    group_id: group.group_id,
    reason,
  };
}

function applyPatch(mapPayload, patch) {
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

function summarizeReports(reports, options) {
  return {
    generated_at: options.generatedAt,
    source: {
      input_dir: relative(options.inputDir),
      output_dir: relative(options.outputDir),
      merge_candidates: relative(options.candidatesPath),
      apply_mode: options.apply,
      min_score: options.minScore,
    },
    counts: {
      chapters: reports.length,
      candidate_groups: sum(reports, 'candidate_groups'),
      eligible_groups: sum(reports, 'eligible_groups'),
      skipped_groups: sum(reports, 'skipped_groups'),
      patch_entries: sum(reports, 'patch_entries'),
      applied_entries: sum(reports, 'applied_entries'),
    },
    chapters: reports.map((report) => ({
      chapter_id: report.chapter_id,
      candidate_groups: report.candidate_groups,
      eligible_groups: report.eligible_groups,
      patch_entries: report.patch_entries,
      applied_entries: report.applied_entries,
    })),
  };
}

async function listMapChapters(inputDir) {
  const files = await readdir(inputDir);
  return files
    .filter((file) => file.endsWith(SYMBOL_CONCEPT_MAP_SUFFIX))
    .map((file) => file.slice(0, -SYMBOL_CONCEPT_MAP_SUFFIX.length))
    .sort(sortChapterId);
}

async function readJson(filePath) {
  return JSON.parse(stripBom(await readFile(filePath, 'utf8')));
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

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\\[a-z]+/g, ' ')
    .replace(/[_^{}()[\],.;:/|+=*'"`~!?<>-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map((token) => singularize(token.trim()))
    .filter(Boolean)
    .join(' ');
}

function singularize(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function isGenericName(normalizedName) {
  const tokens = normalizedName.split(/\s+/).filter(Boolean);
  return tokens.length === 1 && GENERIC_NAMES.has(tokens[0]);
}

function compatibleName(left, right) {
  return normalizeName(left) === normalizeName(right);
}

function appendReviewNote(existing, note) {
  return [existing, note].filter(Boolean).join('\n');
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

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    else if (arg === '--min-score') options.minScore = Number(args[++index]);
    else if (arg === '--allow-generic') options.allowGeneric = true;
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
  console.log(`Apply safe canonical concept merge candidates

Usage:
  node scripts/apply-concept-merge-candidates.mjs --chapter chapter3
  node scripts/apply-concept-merge-candidates.mjs --apply

Inputs:
  tmp/concept-review/concept_merge_candidates.json
  tmp/concept-review/*_symbol_concept_map.json

Outputs:
  tmp/concept-review/auto_merge/*_canonical_merge_patch.json
  tmp/concept-review/auto_merge/canonical_merge_summary.json

The script is dry-run by default. Pass --apply to write canonical_concept_id/name back to symbol maps.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
