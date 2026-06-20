#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_PUBLIC_DIR = path.resolve(ROOT, 'public/data');
const DEFAULT_INTERNAL_DIR = path.resolve(ROOT, 'data/frontend');
const DEFAULT_OUTPUT = path.resolve(ROOT, 'data/frontend/product_release_audit.json');
const BRAND_AUDIT_FILES = [
  'README.md',
  'index.html',
  'package.json',
  'package-lock.json',
  'public/favicon.svg',
  'src',
  'scripts',
  'test',
  'tools',
];
const BRAND_AUDIT_SKIP_FILES = new Set([
  'scripts/audit-product-release.mjs',
]);
const LEGACY_BRAND_PATTERNS = [
  /Formula Atlas/,
  /formula-atlas/,
  /formula_atlas/,
  /FormulaAtlas/,
  /Textbook Formula Atlas/,
  /Generated Formula Atlas/,
];
const LEGACY_BRAND_ALLOWLIST = [
  'https://formula-atlas.13260051624.workers.dev/',
  'GraphAtlas',
  'GraphAtlasProps',
  'graph-atlas',
  'graph-atlas-node',
  'graph-atlas-map',
  'graph-atlas-panel',
];

const REQUIRED_PUBLIC_FILES = [
  'chapter_navigator.json',
  'featured_formulas.json',
  'formula_learning_copy.json',
  'formula_search_index.json',
  'learning_paths.json',
  'llm_cache.json',
  'storylines.json',
  'concept_graph/concept_graph_index.json',
  'concept_graph/concept_search_index.json',
];
const MIN_CONCEPT_SEARCH_ENTRIES = 2000;

const REVIEW_ONLY_FILE_PATTERNS = [
  /[/\\]concept_graph[/\\][^/\\]+_symbol_concept_map\.json$/,
  /[/\\]concept_graph[/\\]concept_merge_candidates\.json$/,
  /[/\\]concept_graph[/\\]concept_review_audit\.json$/,
  /[/\\]concept_graph[/\\]llm_prompts(?:[/\\]|$)/,
  /[/\\]concept_graph[/\\]llm_results(?:[/\\]|$)/,
  /[/\\]symbol_sense(?:[/\\]|$)/,
];

const INTERNAL_REVIEW_KEYS = new Set([
  'reviewed_by',
  'reviewed_at',
  'review_notes',
  'symbol_concepts',
  'symbol_concept_map',
  'teaching_move',
  'teaching_move_zh',
  'extraction_model',
  'review_summary',
  'reviewed_symbol_concepts',
  'unreviewed_symbol_concepts',
]);

const UNSAFE_PUBLIC_CONCEPT_NAMES = new Set([
  'variable',
  'function',
  'count',
  'index',
  'time index',
  'rate',
  'mean',
  'model quantity',
  'coefficient',
  'distance',
  'values',
  'ratio of',
  'there',
  'same logic',
  'fact',
  'offspring',
  'expression',
  'chi',
  'eta',
]);

const UNSAFE_CONCEPT_COPY_PATTERNS = [
  /由当前支撑公式引入/,
  /局部数学量/,
  /当前公式涉及/,
  /背景概念/,
  /概念定义/,
  /教材引入/,
  /上下文线索/,
  /由邻近段落支撑/,
  /待审阅/,
  /supporting formula/i,
  /is a supporting quantity in this equation/i,
  /is the main quantity to read from this equation/i,
  /right-hand side shows/i,
  /names the biological object/i,
  /operation or transformation rule used by the equation/i,
  /model parameter conventionally denoted/i,
  /is a coefficient or parameter attached/i,
  /local context/i,
  /local mathematical quantity/i,
  /local formula context/i,
  /帮你把符号/,
  /标记的是/,
  /places the symbol back/i,
  /marks the object/i,
];

const args = parseArgs(process.argv.slice(2));
const publicDir = path.resolve(ROOT, args.publicDir || DEFAULT_PUBLIC_DIR);
const internalDir = path.resolve(ROOT, args.internalDir || DEFAULT_INTERNAL_DIR);
const outputPath = path.resolve(ROOT, args.output || DEFAULT_OUTPUT);

const report = await buildReleaseAudit(publicDir, internalDir);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeJson(outputPath, report);
const publicOutputPath = path.join(publicDir, 'product_release_audit.json');
if (path.resolve(publicOutputPath) !== outputPath) {
  await mkdir(path.dirname(publicOutputPath), { recursive: true });
  await writeJson(publicOutputPath, report);
}
printSummary(report, outputPath);

if (!report.release_gate.passed) {
  process.exitCode = 1;
}

async function buildReleaseAudit(publicDir, internalDir) {
  const blockers = [];
  const warnings = [];
  const publicFiles = await listFilesIfExists(publicDir);

  await auditRequiredFiles(publicDir, blockers);
  await auditNoInternalPublicData(publicFiles, blockers);
  const conceptSummary = await auditPublicConceptGraphs(publicDir, blockers, warnings);
  const brandAudit = await auditBrandConsistency(blockers);

  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    release_gate: {
      passed: blockers.length === 0,
      blockers,
      warnings,
    },
    public_data: {
      dir: relative(publicDir),
      json_files: publicFiles.filter((file) => file.endsWith('.json')).length,
      required_files: REQUIRED_PUBLIC_FILES.length,
    },
    concept_graph: conceptSummary,
    brand: brandAudit,
  };
  return report;
}

async function auditBrandConsistency(blockers) {
  const findings = [];
  for (const entry of BRAND_AUDIT_FILES) {
    const entryPath = path.join(ROOT, entry);
    const entryFiles = await listFilesIfExists(entryPath);
    const files = entryFiles.length ? entryFiles : [entryPath];
    for (const file of files) {
      if (!isAuditableTextFile(file)) continue;
      if (BRAND_AUDIT_SKIP_FILES.has(relative(file))) continue;
      let text;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!LEGACY_BRAND_PATTERNS.some((pattern) => pattern.test(line))) return;
        if (LEGACY_BRAND_ALLOWLIST.some((allowed) => line.includes(allowed))) return;
        findings.push(`${relative(file)}:${index + 1}`);
      });
    }
  }
  for (const finding of findings) {
    blockers.push(`Legacy Formula Atlas branding remains outside the allowlist: ${finding}`);
  }
  return {
    product_name: 'Knowstellation',
    legacy_formula_atlas_findings: findings,
    allowed_legacy_references: LEGACY_BRAND_ALLOWLIST,
  };
}

async function auditRequiredFiles(publicDir, blockers) {
  for (const file of REQUIRED_PUBLIC_FILES) {
    const filePath = path.join(publicDir, file);
    try {
      await readJson(filePath);
    } catch (error) {
      blockers.push(`Required public JSON is missing or invalid: ${file} (${error.message})`);
    }
  }
}

async function auditNoInternalPublicData(publicFiles, blockers) {
  for (const file of publicFiles) {
    const normalized = file.replaceAll('\\', '/');
    if (REVIEW_ONLY_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
      blockers.push(`Internal review-only file leaked to public data: ${relative(file)}`);
      continue;
    }
    if (!file.endsWith('.json')) continue;
    const payload = await readJson(file);
    collectInternalKeys(payload, blockers, relative(file));
  }
}

async function auditPublicConceptGraphs(publicDir, blockers, warnings) {
  const conceptDir = path.join(publicDir, 'concept_graph');
  const indexPath = path.join(conceptDir, 'concept_graph_index.json');
  const searchPath = path.join(conceptDir, 'concept_search_index.json');
  const index = await readJson(indexPath);
  const search = await readJson(searchPath);
  const chapterSummaries = [];
  const conceptIds = new Set();
  const conceptNames = new Map();
  let formulasProcessed = 0;
  let conceptViews = 0;
  let prerequisiteEdges = 0;
  let introducedEdges = 0;

  for (const chapter of index.chapters || []) {
    if (!chapter.chapter_id) blockers.push('Concept graph index chapter is missing chapter_id.');
    if (!chapter.file) blockers.push(`Concept graph index chapter ${chapter.chapter_id || '<unknown>'} is missing file.`);
    const chapterPath = path.join(conceptDir, chapter.file || '');
    let payload;
    try {
      payload = await readJson(chapterPath);
    } catch (error) {
      blockers.push(`Concept graph file is missing or invalid: ${chapter.file} (${error.message})`);
      continue;
    }
    if (payload.chapter_id !== chapter.chapter_id) {
      blockers.push(`Concept graph chapter id mismatch for ${chapter.file}: index=${chapter.chapter_id}, file=${payload.chapter_id}`);
    }
    if (payload.symbol_concepts !== undefined) {
      blockers.push(`Public concept graph still contains symbol_concepts: ${chapter.file}`);
    }

    const views = payload.views || [];
    const computed = {
      chapter_id: payload.chapter_id,
      formulas_processed: Number(payload.summary?.formulas_processed || 0),
      concept_views: views.length,
      prerequisite_edges: views.reduce((sum, view) => sum + (view.prerequisite_concepts || []).length, 0),
      introduced_edges: views.reduce((sum, view) => sum + (view.introduced_concepts || []).length, 0),
    };
    chapterSummaries.push(computed);
    formulasProcessed += computed.formulas_processed;
    conceptViews += computed.concept_views;
    prerequisiteEdges += computed.prerequisite_edges;
    introducedEdges += computed.introduced_edges;

    for (const [key, value] of Object.entries(computed)) {
      if (key === 'chapter_id') continue;
      if (Number(chapter[key] || 0) !== value) {
        blockers.push(`Concept graph index mismatch for ${chapter.chapter_id}.${key}: index=${chapter[key] || 0}, actual=${value}`);
      }
      if (Number(payload.summary?.[key] || 0) !== value) {
        blockers.push(`Concept graph summary mismatch for ${chapter.file}.${key}: summary=${payload.summary?.[key] || 0}, actual=${value}`);
      }
    }
    auditConceptViews(chapter.file, views, conceptIds, conceptNames, blockers);
  }

  const expectedSummary = {
    chapters: (index.chapters || []).length,
    formulas_processed: formulasProcessed,
    concept_views: conceptViews,
    prerequisite_edges: prerequisiteEdges,
    introduced_edges: introducedEdges,
  };
  for (const [key, value] of Object.entries(expectedSummary)) {
    if (Number(index.summary?.[key] || 0) !== value) {
      blockers.push(`Concept graph index summary mismatch for ${key}: summary=${index.summary?.[key] || 0}, actual=${value}`);
    }
  }

  const searchItems = search.items || [];
  const searchOccurrenceCoverage = searchItems.reduce(
    (sum, item) => sum + Math.max(1, Number(item.viewOccurrenceCount ?? item.occurrenceCount ?? 1)),
    0,
  );
  if (searchOccurrenceCoverage !== conceptViews) {
    blockers.push(`Concept search index coverage mismatch: search_occurrences=${searchOccurrenceCoverage}, concept_views=${conceptViews}`);
  }
  if (conceptViews >= MIN_CONCEPT_SEARCH_ENTRIES && searchItems.length < MIN_CONCEPT_SEARCH_ENTRIES) {
    blockers.push(`Concept search index has too few entries: entries=${searchItems.length}, minimum=${MIN_CONCEPT_SEARCH_ENTRIES}`);
  }
  for (const item of searchItems) {
    if (!conceptIds.has(item.concept_id)) {
      blockers.push(`Concept search item points to missing concept view: ${item.concept_id}`);
    }
  }

  const zeroViewChapters = chapterSummaries.filter((chapter) => chapter.concept_views === 0).map((chapter) => chapter.chapter_id);
  if (zeroViewChapters.length) {
    warnings.push(`Some chapters have no public concept views yet: ${zeroViewChapters.join(', ')}`);
  }

  return {
    chapters: expectedSummary.chapters,
    formulas_processed: formulasProcessed,
    concept_views: conceptViews,
    concept_search_entries: searchItems.length,
    concept_search_occurrences: searchOccurrenceCoverage,
    prerequisite_edges: prerequisiteEdges,
    introduced_edges: introducedEdges,
    unique_public_concept_names: conceptNames.size,
    zero_view_chapters: zeroViewChapters,
    top_concepts: [...conceptNames.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20)
      .map(([name, count]) => ({ name, count })),
  };
}

function auditConceptViews(file, views, conceptIds, conceptNames, blockers) {
  for (const view of views) {
    const label = `${file}:${view.concept_id || '<missing concept_id>'}`;
    for (const key of ['chapter_id', 'concept_id', 'name', 'definition', 'defined_by_formula_id', 'defined_symbol', 'supporting_formula_label']) {
      if (!view[key]) blockers.push(`Public concept view is missing ${key}: ${label}`);
    }
    if (!view.review_status) blockers.push(`Public concept view is missing review_status: ${label}`);
    const normalizedName = normalizeName(view.name);
    if (!normalizedName || UNSAFE_PUBLIC_CONCEPT_NAMES.has(normalizedName)) {
      blockers.push(`Unsafe or generic public concept name: "${view.name}" in ${label}`);
    }
    if (/^formula\s+.+\s+result$/i.test(String(view.name || ''))) {
      blockers.push(`Formula-placeholder public concept name: "${view.name}" in ${label}`);
    }
    auditConceptCopy(label, view, blockers);
    conceptIds.add(view.concept_id);
    conceptNames.set(view.name, (conceptNames.get(view.name) || 0) + 1);
    for (const reference of [...(view.prerequisite_concepts || []), ...(view.introduced_concepts || [])]) {
      auditConceptCopy(`${label}:${reference.concept_id || reference.name || '<reference>'}`, reference, blockers);
    }
  }
}

function auditConceptCopy(label, item, blockers) {
  for (const field of ['definition', 'definition_zh']) {
    const value = String(item[field] || '');
    if (!value) continue;
    const pattern = UNSAFE_CONCEPT_COPY_PATTERNS.find((candidate) => candidate.test(value));
    if (pattern) {
      blockers.push(`Unsafe generated concept copy in ${field}: ${label}`);
    }
  }
}

function collectInternalKeys(value, blockers, label, prefix = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInternalKeys(item, blockers, label, `${prefix}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (INTERNAL_REVIEW_KEYS.has(key)) {
      blockers.push(`Internal review key leaked to public data: ${label}:${childPath}`);
    }
    collectInternalKeys(child, blockers, label, childPath);
  }
}

async function listFilesIfExists(dir) {
  let entryStat;
  try {
    entryStat = await stat(dir);
  } catch {
    return [];
  }
  if (!entryStat.isDirectory()) return [dir];

  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      files.push(...await listFilesIfExists(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

function isAuditableTextFile(filePath) {
  if (filePath.includes(`${path.sep}__pycache__${path.sep}`)) return false;
  const ext = path.extname(filePath).toLowerCase();
  return new Set(['.css', '.html', '.ipynb', '.js', '.json', '.jsx', '.md', '.mjs', '.py', '.svg', '.ts', '.tsx']).has(ext);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function relative(filePath) {
  return path.resolve(filePath).replace(`${ROOT}${path.sep}`, '').replaceAll('\\', '/');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    parsed[key] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function printSummary(report, outputPath) {
  console.log(`Product release audit -> ${relative(outputPath)}`);
  console.log(`  release gate: ${report.release_gate.passed ? 'passed' : 'failed'}`);
  console.log(`  public concept views: ${report.concept_graph.concept_views}`);
  console.log(`  public concept search entries: ${report.concept_graph.concept_search_entries}`);
  console.log(`  blockers: ${report.release_gate.blockers.length}`);
  console.log(`  warnings: ${report.release_gate.warnings.length}`);
  if (report.release_gate.blockers.length) {
    console.log('  blocker details:');
    for (const item of report.release_gate.blockers.slice(0, 20)) console.log(`    - ${item}`);
  }
  if (report.release_gate.warnings.length) {
    console.log('  warning details:');
    for (const item of report.release_gate.warnings.slice(0, 20)) console.log(`    - ${item}`);
  }
}
