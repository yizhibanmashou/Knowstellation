import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CONCEPT_GRAPH_DIR = resolve(ROOT, 'tmp/concept-review');
const DEFAULT_EVIDENCE_DIR = resolve(ROOT, 'tmp/pdf-audit/evidence');
const DEFAULT_OUTPUT_DIR = resolve(ROOT, 'tmp/pdf-audit');

const DOMAIN_TERMS = new Map([
  ['change', ['change', 'delta', 'difference', 'response']],
  ['p+change p', ['change', 'delta', 'allele frequency']],
  ['1-p', ['1-p', 'allele frequency']],
  ['mean trait value', ['mean trait value', 'mean of a trait', 'mean phenotype', 'average trait']],
  ['trait value', ['trait value', 'value of a trait', 'phenotype']],
  ['class trait value', ['trait value', 'value of a trait', 'category']],
  ['fitness', ['fitness', 'reproductive success', 'descendants']],
  ['class fitness', ['fitness', 'descendants', 'absolute fitness']],
  ['mean fitness', ['mean fitness', 'average number of descendants']],
  ['class frequency', ['frequency', 'categories', 'category']],
  ['population size', ['population size', 'number of individuals', 'categories', 'there are n categories']],
  ['covariance', ['covariance', 'cov']],
  ['variance', ['variance']],
  ['genetic variance', ['genetic variance', 'variance']],
  ['expectation', ['expectation', 'expected']],
  ['selection differential', ['selection differential']],
  ['selection response', ['selection response', 'response to selection']],
  ['breeding value', ['breeding value']],
  ['additive genetic variance', ['additive genetic variance']],
  ['dominance variance', ['dominance variance']],
  ['average excess', ['average excess']],
  ['average effect', ['average effect']],
  ['regression coefficient', ['regression coefficient', 'regression']],
  ['transmission bias', ['transmission bias', 'transmission']],
  ['price equation', ['price equation', "price's theorem"]],
  ['fisher fundamental theorem', ["fisher's fundamental theorem", 'fundamental theorem']],
  ['robertson secondary theorem', ["robertson's secondary theorem", 'secondary theorem']],
]);

const SAFE_CONCEPT_NAMES = new Set([
  ...DOMAIN_TERMS.keys(),
  'time',
  'probability',
  'frequency',
  'allele frequency',
  'genotype frequency',
  'gamete frequency',
  'heterozygosity',
  'trait variance',
  'phenotypic variance',
  'genetic variance',
  'environmental variance',
  'dominance variance',
  'heritability',
  'correlation',
  'standard deviation',
  'probability density',
  'stationary distribution',
  'likelihood',
  'bayes factor',
  'degrees of freedom',
  'identity matrix',
  'state probability',
  'acceptance rate',
  'eigenvalue',
  'selection coefficient',
  'mutation rate',
  'recombination rate',
  'inbreeding coefficient',
  'population mean',
  'absolute fitness',
  'optimal trait value',
  'fitness width',
  'trait breeding value',
  'total response',
  'equilibrium heritability',
  'expected allele-frequency change',
  'unconditional residence time',
  'neutrality index',
  'adjusted selection intensity',
  'strength of selection',
  'strength of stabilizing selection',
]);

const UNSAFE_GENERIC_CONCEPT_NAMES = new Set([
  'variable',
  'function',
  'mean',
  'rate',
  'index',
  'time index',
  'count',
  'distance',
  'values',
  'information',
  'ratio of',
  'eta',
  'there',
  'same logic',
  'fact',
  'offspring',
  'expression',
  'chi',
  'trait',
  'parameter',
  'constant',
  'value',
  'number',
  'probability statement',
]);

const AUTO_RECHECK_REVIEWERS = new Set(['auto_pdf_evidence_review']);

const args = parseArgs(process.argv.slice(2));
const conceptGraphDir = resolvePath(args.conceptGraphDir || DEFAULT_CONCEPT_GRAPH_DIR);
const evidenceDir = resolvePath(args.evidenceDir || DEFAULT_EVIDENCE_DIR);
const outputDir = resolvePath(args.outputDir || DEFAULT_OUTPUT_DIR);
const apply = Boolean(args.apply);

await mkdir(outputDir, { recursive: true });

const chapterIds = args.all ? await listConceptMapChapters(conceptGraphDir) : [args.chapter || 'chapter6'];
const results = [];
for (const chapterId of chapterIds) {
  results.push(await reviewChapter(chapterId));
}

if (chapterIds.length > 1) {
  const aggregate = aggregateResults(results);
  await writeJson(resolve(outputDir, 'auto_review_summary.json'), aggregate);
  console.log(`Auto review ${chapterIds.length} chapters`);
  console.log(`  approved: ${aggregate.counts.approved || 0}`);
  console.log(`  rejected: ${aggregate.counts.rejected || 0}`);
  console.log(`  manual: ${aggregate.counts.manual || 0}`);
  console.log(`  summary: ${relativeToRoot(resolve(outputDir, 'auto_review_summary.json'))}`);
}

async function reviewChapter(chapterId) {
  const mapPath = resolve(conceptGraphDir, `${chapterId}_symbol_concept_map.json`);
  const mapPayload = JSON.parse(await readFile(mapPath, 'utf8'));
  const evidence = await loadEvidence(evidenceDir, chapterId);
  const evidenceText = normalizeText(evidence.text);
  const formulaWindows = buildFormulaWindows(evidenceText);
  const reviewedAt = new Date().toISOString();

  const decisions = mapPayload.symbol_concepts.map((concept) => reviewConcept(concept, evidenceText, formulaWindows, reviewedAt));
  const entries = decisions
    .filter((decision) => decision.patch)
    .map((decision) => decision.patch);
  const manualQueue = decisions
    .filter((decision) => decision.queueItem)
    .map((decision) => decision.queueItem)
    .sort((left, right) => right.priority - left.priority || left.formula_id.localeCompare(right.formula_id));

  const patch = {
    chapter_id: chapterId,
    generated_at: reviewedAt,
    source: {
      method: 'conservative OCR/structured-evidence auto review',
      evidence_dir: relativeToRoot(evidenceDir),
      concept_map: relativeToRoot(mapPath),
    },
    entries,
  };

  const report = buildReport(chapterId, decisions, evidence);

  await writeJson(resolve(outputDir, `${chapterId}_auto_review_patch.json`), patch);
  await writeJson(resolve(outputDir, `${chapterId}_auto_review_report.json`), report);
  await writeJson(resolve(outputDir, `${chapterId}_manual_review_queue.json`), {
    chapter_id: chapterId,
    generated_at: reviewedAt,
    entries: manualQueue,
  });

  if (apply) {
    const appliedMap = {
      ...mapPayload,
      symbol_concepts: mapPayload.symbol_concepts.map((concept, index) => {
        const decision = decisions[index];
        if (!decision.patch) return concept;
        const { stable_key: _stableKey, chapter_id: _chapterId, formula_id: _formulaId, symbol: _symbol, role: _role, ...updates } = decision.patch;
        return { ...concept, ...updates };
      }),
    };
    appliedMap.summary = summaryFor(appliedMap.chapter_id, appliedMap.symbol_concepts);
    appliedMap.review_updated_at = reviewedAt;
    await writeJson(mapPath, appliedMap);
  }

  console.log(`Auto review ${chapterId}`);
  console.log(`  evidence files: ${evidence.files.length}`);
  console.log(`  approved/reviewed patch entries: ${entries.length}`);
  console.log(`  manual queue: ${manualQueue.length}`);
  if (apply) console.log(`  applied to ${relativeToRoot(mapPath)}`);

  return { chapterId, report, patchEntries: entries.length, manualQueue: manualQueue.length };
}

function reviewConcept(concept, fullEvidenceText, formulaWindows, reviewedAt) {
  const status = concept.review_status || 'unreviewed';
  const flags = Array.isArray(concept.review_flags) ? concept.review_flags : [];
  const stable_key = stableKey(concept);
  const basePatch = {
    stable_key,
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    symbol: concept.symbol,
    role: concept.role,
  };

  const reasons = [];
  const evidenceSnippets = [
    concept.source_sentence,
    ...(concept.evidence || []).map((item) => item.sentence),
  ]
    .filter(Boolean)
    .map(normalizeText)
    .filter(Boolean);
  const sourceText = evidenceSnippets.join(' ');
  const formulaNumber = formulaNumberFor(concept);
  const formulaWindow = formulaWindows.get(formulaNumber) || '';
  const evidenceContext = [sourceText, formulaWindow].filter(Boolean).join(' ');
  const conceptName = String(concept.concept_name || '');
  const confidence = Number(concept.confidence || 0);
  const formulaPlaceholder = isFormulaPlaceholder(concept);

  const shouldRecheckAutoApproval = status === 'approved' && AUTO_RECHECK_REVIEWERS.has(String(concept.reviewed_by || ''));
  if (status !== 'unreviewed' && !shouldRecheckAutoApproval) {
    return { status: 'kept' };
  }

  if (formulaPlaceholder || flags.includes('derived_from_formula_without_defined_symbol')) {
    return {
      status: 'rejected',
      patch: {
        ...basePatch,
        review_status: 'rejected',
        review_flags: unique([...flags, 'auto_rejected_formula_placeholder']),
        review_notes: 'Auto rejected: generated placeholder concept for a formula with no reliable defined symbol.',
        reviewed_by: 'auto_pdf_evidence_review',
        reviewed_at: reviewedAt,
      },
    };
  }

  if (flags.length) reasons.push(`flags:${flags.join(',')}`);
  if (confidence < 0.72) reasons.push('low_confidence');
  if (!sourceText && !formulaWindow) reasons.push('missing_source_sentence');
  const sourceSupported = evidenceSnippets.some((snippet) => fullEvidenceText.includes(snippet)) || Boolean(formulaWindow);
  if (!sourceSupported) reasons.push('source_sentence_not_in_evidence_text');

  const conceptSupported = conceptNameSupported(conceptName, evidenceContext);
  if (!conceptSupported) reasons.push('concept_name_not_text_supported');
  const unsafeConceptName = isUnsafeConceptName(concept);
  if (unsafeConceptName) reasons.push('unsafe_or_generic_concept_name');

  const symbolSupported = symbolEvidenceSupported(concept, evidenceContext);
  if (!symbolSupported) reasons.push('symbol_not_visible_in_evidence_sentence');

  if (!flags.length && confidence >= 0.72 && sourceSupported && conceptSupported && !unsafeConceptName && symbolSupported) {
    return {
      status: 'approved',
      patch: {
        ...basePatch,
        review_status: 'approved',
        review_flags: [],
        review_notes: 'Auto approved: source sentence is present in OCR/structured evidence and concept label has direct textual support.',
        reviewed_by: 'auto_pdf_evidence_review',
        reviewed_at: reviewedAt,
      },
    };
  }

  if (shouldRecheckAutoApproval) {
    return {
      status: 'needs_revision',
      patch: {
        ...basePatch,
        review_status: 'needs_revision',
        review_flags: unique([...flags, 'auto_review_recheck_failed']),
        review_notes: `Auto recheck failed: ${reasons.join('; ') || 'not enough conservative evidence'}.`,
        reviewed_by: 'auto_pdf_evidence_review',
        reviewed_at: reviewedAt,
      },
      queueItem: manualDecision(concept, 'auto_approval_recheck_failed', reasons, stable_key).queueItem,
    };
  }

  return manualDecision(concept, 'manual_required', reasons, stable_key);
}

function manualDecision(concept, reason, reasons, stableKey) {
  return {
    status: 'manual',
    queueItem: {
      stable_key: stableKey,
      chapter_id: concept.chapter_id,
      formula_id: concept.formula_id,
      formula_label: concept.formula_label,
      symbol: concept.symbol,
      role: concept.role,
      concept_name: concept.concept_name,
      concept_type: concept.concept_type,
      definition: concept.definition,
      confidence: concept.confidence,
      review_flags: concept.review_flags || [],
      source_sentence: concept.source_sentence,
      reason,
      reasons,
      priority: priorityFor(concept, reasons),
    },
  };
}

function priorityFor(concept, reasons) {
  let priority = 0;
  if (concept.role === 'defined') priority += 30;
  if (Number(concept.confidence || 0) < 0.72) priority += 25;
  if ((concept.review_flags || []).length) priority += 25;
  if (reasons.includes('concept_name_not_text_supported')) priority += 15;
  if (reasons.includes('unsafe_or_generic_concept_name')) priority += 15;
  if (reasons.includes('source_sentence_not_in_evidence_text')) priority += 10;
  return priority;
}

function isUnsafeConceptName(concept) {
  const rawName = String(concept.concept_name || '').trim();
  const name = normalizeText(rawName);
  if (!name) return true;
  if (SAFE_CONCEPT_NAMES.has(name)) return false;
  if (UNSAFE_GENERIC_CONCEPT_NAMES.has(name)) return true;
  if (/^(?:[a-z]|[a-z]\s+sub\s+|[a-z]\s+power\s+|alpha|beta|gamma|delta|epsilon|sigma|mu|rho|mathrmd|mathrmn)\b/i.test(name)) return true;
  if (/\b(?:mathrm|mathrmd|mathrmn)\b/.test(name)) return true;
  if (/\b(?:can be|is|are|becomes|given|obtained|evaluated|defined|calculated|using)\b/.test(name)) return true;
  if (name.split(/\s+/).length > 3 && !/(?:variance|covariance|fitness|frequency|selection|response|heritability|correlation|coefficient|probability|trait|population|genetic|environmental)/.test(name)) {
    return true;
  }
  return true;
}

function conceptNameSupported(conceptName, sourceText) {
  const normalizedName = normalizeText(conceptName);
  if (!normalizedName) return false;
  if (sourceText.includes(normalizedName)) return true;
  const terms = DOMAIN_TERMS.get(normalizedName) || [];
  return terms.some((term) => sourceText.includes(term));
}

function symbolEvidenceSupported(concept, sourceText) {
  if (concept.role === 'defined') return true;
  const symbol = normalizeSymbol(concept.symbol);
  if (!symbol) return true;
  if (sourceText.includes(symbol)) return true;
  const compactSource = sourceText.replace(/[^a-z0-9]+/g, '');
  const compactSymbol = symbol.replace(/[^a-z0-9]+/g, '');
  if (compactSymbol && compactSource.includes(compactSymbol)) return true;
  if (/^[a-z]$/i.test(symbol)) {
    return new RegExp(`\\b${escapeRegExp(symbol)}\\b`, 'i').test(sourceText);
  }
  return false;
}

async function loadEvidence(evidenceDir, chapterId) {
  const files = [];
  const chunks = [];

  for (const file of [
    `${chapterId}_textbook.md`,
    `${chapterId}_ocr.md`,
    `textbook/${chapterId}_textbook.md`,
    `glmocr_output/${chapterId}.md`,
  ]) {
    const filePath = resolve(evidenceDir, file);
    try {
      chunks.push(await readFile(filePath, 'utf8'));
      files.push(filePath);
    } catch {
      // Optional evidence source.
    }
  }

  for (const structuredDir of [resolve(evidenceDir, 'structured'), evidenceDir]) {
    try {
      const structuredFiles = (await readdir(structuredDir))
        .filter((file) => file.startsWith(`${chapterId}_`) && file.endsWith('.json'))
        .sort();
      for (const file of structuredFiles) {
        const filePath = resolve(structuredDir, file);
        const payload = JSON.parse(await readFile(filePath, 'utf8'));
        chunks.push(extractText(payload));
        files.push(filePath);
      }
    } catch {
      // Optional evidence source.
    }
  }

  return { text: chunks.join('\n\n'), files };
}

async function listConceptMapChapters(conceptGraphDir) {
  const files = await readdir(conceptGraphDir);
  return files
    .filter((file) => file.endsWith('_symbol_concept_map.json'))
    .map((file) => file.replace('_symbol_concept_map.json', ''))
    .sort(chapterSort);
}

function aggregateResults(results) {
  const counts = {};
  const manualReasonCounts = {};
  const chapters = [];
  for (const result of results) {
    chapters.push({
      chapter_id: result.chapterId,
      counts: result.report.counts,
      manual_reason_counts: result.report.manual_reason_counts,
      patch_entries: result.patchEntries,
      manual_queue: result.manualQueue,
    });
    for (const [key, value] of Object.entries(result.report.counts)) {
      counts[key] = (counts[key] || 0) + value;
    }
    for (const [key, value] of Object.entries(result.report.manual_reason_counts)) {
      manualReasonCounts[key] = (manualReasonCounts[key] || 0) + value;
    }
  }
  return {
    generated_at: new Date().toISOString(),
    counts,
    manual_reason_counts: manualReasonCounts,
    chapters,
  };
}

function chapterSort(left, right) {
  const rank = (id) => {
    const appendix = id.match(/^appendix(\d+)$/);
    if (appendix) return 1000 + Number(appendix[1]);
    const chapter = id.match(/^chapter(\d+)$/);
    if (chapter) return Number(chapter[1]);
    return 9999;
  };
  return rank(left) - rank(right) || left.localeCompare(right);
}

function buildFormulaWindows(evidenceText) {
  const windows = new Map();
  const pattern = /formula\s*\(?([0-9]+(?:\.[0-9]+[a-z]?)?)\)?/gi;
  let match;
  while ((match = pattern.exec(evidenceText))) {
    const formulaNumber = match[1].toLowerCase();
    const start = Math.max(0, match.index - 800);
    const end = Math.min(evidenceText.length, match.index + 1400);
    const window = evidenceText.slice(start, end);
    windows.set(formulaNumber, `${windows.get(formulaNumber) || ''} ${window}`.trim());
  }
  return windows;
}

function formulaNumberFor(concept) {
  const label = String(concept.formula_label || concept.formula_id || '').toLowerCase();
  const match = label.match(/([0-9]+(?:\.[0-9]+[a-z]?))/);
  return match?.[1] || '';
}

function extractText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(extractText).join('\n');
  if (typeof value === 'object') return Object.values(value).map(extractText).join('\n');
  return '';
}

function isFormulaPlaceholder(concept) {
  const symbol = String(concept.symbol || '');
  const name = String(concept.concept_name || '');
  return /^Formula\s+/i.test(symbol) || /^Formula\s+.+\s+Result$/i.test(name);
}

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
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

function buildReport(chapterId, decisions, evidence) {
  const counts = {};
  const reasonCounts = {};
  for (const decision of decisions) {
    counts[decision.status] = (counts[decision.status] || 0) + 1;
    if (decision.queueItem) {
      for (const reason of decision.queueItem.reasons || []) {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
    }
  }
  return {
    chapter_id: chapterId,
    generated_at: new Date().toISOString(),
    evidence_files: evidence.files.map(relativeToRoot),
    counts,
    manual_reason_counts: reasonCounts,
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\\overline\{([^}]+)\}/g, '$1-bar')
    .replace(/\$+/g, ' ')
    .replace(/\\[a-z]+/g, ' ')
    .replace(/[{}_^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSymbol(value) {
  return normalizeText(value)
    .replace(/\s+sub\s+/g, '')
    .replace(/\s+/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--all') {
      parsed[arg.slice(2)] = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      parsed[key] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function resolvePath(value) {
  return resolve(process.cwd(), value);
}

function relativeToRoot(filePath) {
  return resolve(filePath).replace(`${ROOT}\\`, '').replaceAll('\\', '/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
