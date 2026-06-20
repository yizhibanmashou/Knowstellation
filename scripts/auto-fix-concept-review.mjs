#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMON_SYMBOL_NAMES,
  CONCEPT_CALIBRATIONS,
  CONCEPT_DEFINITIONS,
  CONCEPT_DEFINITIONS_ZH,
  PRODUCT_GENERIC_CONCEPT_NAMES,
  REVIEW_STATUSES,
  SUBSCRIPT_SYMBOL_NAMES,
} from './concept_graph/calibrations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_DIR = path.join(ROOT, 'tmp', 'concept-review');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'tmp', 'concept-review', 'auto_fix');
const DEFAULT_MAX_LLM_RETRY_ATTEMPTS = 2;
const AUTO_FIX_FLAGS = new Set([
  'low_confidence',
  'template_definition',
  'formula_or_symbol_artifact',
  'needs_review',
]);
const HUMAN_RISK_FLAGS = new Set([
  'index_like_defined_symbol',
]);
const LLM_REPAIR_FLAGS = new Set([
  'generic_defined_concept_name',
  'llm_rejected',
]);
const CONCEPT_TYPES = new Set([
  'quantity_concept',
  'math_concept',
  'domain_concept',
  'theorem_or_principle',
  'operator_or_function',
  'unknown',
]);
const INDEX_LIKE_DEFINED = /^(?:i|j|k|l|t)$/;
const LATEX_PARSER_FRAGMENT = /\\(?:left|right|begin|end|frac|mathrm|mathbf|boldsymbol)(?:[^A-Za-z]|$)|(?:^|[^A-Za-z])(?:left|right|mathrm|mathbf|boldsymbol)(?:[^A-Za-z]|$)/i;
const FORMULA_PLACEHOLDER_NAME = /^Formula\s+\S+\s+(?:Relationship|Result|Concept|Variable|Parameter|Expression|Value|Values)$/i;
const REVIEWABLE_STATUSES = new Set(['unreviewed', 'needs_revision', 'ambiguous']);
const UNSAFE_PUBLIC_CONCEPT_NAMES = new Set([
  ...PRODUCT_GENERIC_CONCEPT_NAMES,
  'variable',
  'function',
  'count',
  'index',
  'time index',
  'rate',
  'mean',
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
const UNSAFE_PUBLIC_CONCEPT_PREFIX = new RegExp(
  `^(?:${[...UNSAFE_PUBLIC_CONCEPT_NAMES].map(escapeRegExp).join('|')})(?:\\s*\\([^)]*\\)|\\s+(?:representing|raised|indexed|scaled|local|model|formula)\\b.*)$`,
  'i',
);
const STANDALONE_MATH_OPERATOR_TOKENS = new Set([
  '\\Delta',
  '\\Pr',
  '\\infty',
  '\\operatorname',
]);
const EXACT_SYMBOL_CONCEPTS = new Map([
  ['H_{0}', { name: 'Baseline Heterozygosity', type: 'quantity_concept' }],
  ['H_{h}', { name: 'Sweep-Linked Heterozygosity', type: 'quantity_concept' }],
  ['h_{0}', { name: 'Loss-Conditioned Function', type: 'quantity_concept' }],
  ['h_{1}', { name: 'Fixation-Conditioned Function', type: 'quantity_concept' }],
]);
const STANDARD_SYMBOL_REPAIRS = [
  {
    pattern: /^F_\{?ST\}?$/i,
    concept_name: 'Fixation Index',
    concept_type: 'quantity_concept',
    definition: 'A standardized measure of population differentiation among subpopulations, expressed relative to expected heterozygosity or allele-frequency variance.',
    definition_zh: '衡量亚群体间遗传分化程度的标准化指标，通常相对于期望杂合度或等位基因频率方差来表示。',
    aliases: ['F_{ST}', 'FST', 'Fixation Index', 'Wright Fixation Index'],
    confidence: 0.94,
    review_notes: 'Rule standard symbol repair: F_ST is the fixation index across population-genetic contexts.',
  },
  {
    pattern: /^\\sigma\^\{?2\}?$/i,
    concept_name: 'Variance',
    concept_type: 'quantity_concept',
    definition: 'A measure of spread around the mean.',
    definition_zh: '衡量数值围绕均值离散程度的量。',
    aliases: ['\\sigma^{2}', 'sigma^2', 'Variance'],
    confidence: 0.86,
    review_notes: 'Rule standard symbol repair: sigma^2 is the conventional notation for variance.',
  },
  {
    pattern: /^\\(?:bar|overline)\{\\imath\}(?:_\{?[^{}]+\}?)?$/i,
    concept_name: 'Selection Intensity',
    concept_type: 'quantity_concept',
    definition: 'The standardized selection differential, measuring selection strength in units of phenotypic standard deviations.',
    definition_zh: '标准化的选择差，用表型标准差为单位衡量选择强度。',
    aliases: ['\\bar{\\imath}', '\\overline{\\imath}', 'selection intensity', 'standardized selection differential'],
    confidence: 0.9,
    review_notes: 'Rule standard symbol repair: barred i denotes selection intensity in the selection-response chapters.',
  },
];

async function main() {
  const [commandOrOption, ...restArgs] = process.argv.slice(2);
  const command = commandOrOption && !commandOrOption.startsWith('-') ? commandOrOption : 'scan';
  const args = commandOrOption && !commandOrOption.startsWith('-') ? restArgs : process.argv.slice(2);
  const options = parseArgs(args);
  if (options.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(process.cwd(), options.inputDir || DEFAULT_INPUT_DIR);
  const outputDir = path.resolve(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });

  if (command === 'scan') {
    await scanAutoFix(inputDir, outputDir, options);
    return;
  }

  if (command === 'import-llm-results') {
    await importLlmResults(inputDir, outputDir, options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function scanAutoFix(inputDir, outputDir, options) {
  const chapters = options.chapter
    ? [options.chapter]
    : await listMapChapters(inputDir);
  const selectedChapters = options.all ? chapters : chapters.slice(0, 1);
  const results = [];
  for (const chapterId of selectedChapters) {
    results.push(await autoFixChapter(chapterId, inputDir, outputDir, options));
  }

  if (selectedChapters.length > 1 || options.summary) {
    const summary = aggregateResults(results);
    await writeJson(path.join(outputDir, 'auto_fix_summary.json'), summary);
    console.log(`Auto-fix scanned ${selectedChapters.length} chapters`);
    console.log(`  patch entries: ${summary.counts.patch_entries || 0}`);
    console.log(`  llm queue: ${summary.counts.llm_queue || 0}`);
    console.log(`  human queue: ${summary.counts.human_queue || 0}`);
    console.log(`  summary: ${relative(path.join(outputDir, 'auto_fix_summary.json'))}`);
  }
}

async function importLlmResults(inputDir, outputDir, options) {
  const chapters = options.chapter
    ? [options.chapter]
    : await listMapChapters(inputDir);
  const selectedChapters = options.all ? chapters : chapters.slice(0, 1);
  const results = [];
  for (const chapterId of selectedChapters) {
    const inputPath = options.input && selectedChapters.length === 1
      ? path.resolve(process.cwd(), options.input)
      : path.join(outputDir, `${chapterId}_llm_results.jsonl`);
    results.push(await importLlmChapter(chapterId, inputPath, inputDir, outputDir, options));
  }
  if (selectedChapters.length > 1 || options.summary) {
    const summary = aggregateLlmImportResults(results);
    await writeJson(path.join(outputDir, 'llm_import_summary.json'), summary);
    console.log(`LLM import scanned ${selectedChapters.length} chapters`);
    console.log(`  accepted: ${summary.counts.accepted}`);
    console.log(`  rejected: ${summary.counts.rejected}`);
    console.log(`  retry queue: ${summary.counts.retry}`);
    console.log(`  human queue: ${summary.counts.human}`);
    console.log(`  applied: ${summary.counts.applied}`);
    console.log(`  summary: ${relative(path.join(outputDir, 'llm_import_summary.json'))}`);
  }
}

async function importLlmChapter(chapterId, inputPath, inputDir, outputDir, options) {
  const generatedAt = utcNow();
  const mapPath = path.join(inputDir, `${chapterId}_symbol_concept_map.json`);
  const mapPayload = await readJson(mapPath);
  if (!await fileExists(inputPath)) {
    const report = {
      chapter_id: chapterId,
      generated_at: generatedAt,
      source: {
        method: 'validated_llm_concept_auto_fix',
        input: relative(inputPath),
        concept_map: relative(mapPath),
        apply_mode: Boolean(options.apply),
      },
      input_items: 0,
      accepted_entries: 0,
      rejected_entries: 0,
      retry_queue_entries: 0,
      human_review_queue_entries: 0,
      applied_entries: 0,
      skipped: true,
      skip_reason: 'missing_llm_results_file',
    };
    await writeJson(path.join(outputDir, `${chapterId}_llm_import_patch.json`), {
      chapter_id: chapterId,
      generated_at: generatedAt,
      source: report.source,
      entries: [],
    });
    await writeJson(path.join(outputDir, `${chapterId}_llm_import_report.json`), report);
    await writeJson(path.join(outputDir, `${chapterId}_llm_rejected_queue.json`), {
      chapter_id: chapterId,
      generated_at: generatedAt,
      entries: [],
    });
    await writeJsonl(path.join(outputDir, `${chapterId}_llm_retry_queue.jsonl`), []);
    await writeJson(path.join(outputDir, `${chapterId}_llm_human_review_queue.json`), {
      chapter_id: chapterId,
      generated_at: generatedAt,
      entries: [],
    });
    console.log(`LLM import ${chapterId}`);
    console.log(`  skipped: missing ${relative(inputPath)}`);
    return { chapterId, accepted: 0, rejected: 0, retry: 0, human: 0, applied: 0, skipped: 1 };
  }
  const rawItems = await readRawItems(inputPath);
  const conceptByKey = new Map((mapPayload.symbol_concepts || []).map((concept) => [stableKey(concept), concept]));
  const entries = [];
  const rejected = [];
  const retryQueue = [];
  const humanQueue = [];

  for (const raw of rawItems) {
    const validation = validateLlmResult(raw, conceptByKey, generatedAt);
    if (validation.entry) entries.push(validation.entry);
    if (validation.rejected) {
      rejected.push(validation.rejected);
      if (validation.rejected.retry_record) retryQueue.push(validation.rejected.retry_record);
      if (validation.rejected.resolution === 'human_review') humanQueue.push(humanLlmItem(validation.rejected));
    }
  }

  const patch = {
    chapter_id: chapterId,
    generated_at: generatedAt,
    source: {
      method: 'validated_llm_concept_auto_fix',
      input: relative(inputPath),
      concept_map: relative(mapPath),
      apply_mode: Boolean(options.apply),
    },
    entries,
  };
  const report = {
    chapter_id: chapterId,
    generated_at: generatedAt,
    source: patch.source,
    input_items: rawItems.length,
    accepted_entries: entries.length,
    rejected_entries: rejected.length,
    retry_queue_entries: retryQueue.length,
    human_review_queue_entries: humanQueue.length,
    applied_entries: options.apply ? entries.length : 0,
  };

  await writeJson(path.join(outputDir, `${chapterId}_llm_import_patch.json`), patch);
  await writeJson(path.join(outputDir, `${chapterId}_llm_import_report.json`), report);
  await writeJson(path.join(outputDir, `${chapterId}_llm_rejected_queue.json`), {
    chapter_id: chapterId,
    generated_at: generatedAt,
    entries: rejected,
  });
  await writeJsonl(path.join(outputDir, `${chapterId}_llm_retry_queue.jsonl`), retryQueue);
  await writeJson(path.join(outputDir, `${chapterId}_llm_human_review_queue.json`), {
    chapter_id: chapterId,
    generated_at: generatedAt,
    entries: humanQueue,
  });

  if (options.apply && entries.length) {
    const updated = applyPatch(mapPayload, patch, generatedAt);
    await writeJson(mapPath, updated);
  }

  console.log(`LLM import ${chapterId}`);
  console.log(`  input items: ${rawItems.length}`);
  console.log(`  accepted: ${entries.length}`);
  console.log(`  rejected: ${rejected.length}`);
  console.log(`  retry queue: ${retryQueue.length}`);
  console.log(`  human queue: ${humanQueue.length}`);
  if (options.apply) console.log(`  applied: ${relative(mapPath)}`);

  return { chapterId, accepted: entries.length, rejected: rejected.length, retry: retryQueue.length, human: humanQueue.length, applied: options.apply ? entries.length : 0 };
}

async function autoFixChapter(chapterId, inputDir, outputDir, options) {
  const mapPath = path.join(inputDir, `${chapterId}_symbol_concept_map.json`);
  const mapPayload = await readJson(mapPath);
  const generatedAt = utcNow();
  const decisions = (mapPayload.symbol_concepts || []).map((concept) => decideConcept(concept, generatedAt));
  const entries = decisions.filter((decision) => decision.patch).map((decision) => decision.patch);
  const llmQueue = decisions.filter((decision) => decision.llmRecord).map((decision) => decision.llmRecord);
  const humanQueue = decisions.filter((decision) => decision.humanItem).map((decision) => decision.humanItem);

  const patch = {
    chapter_id: chapterId,
    generated_at: generatedAt,
    source: {
      method: 'rules_first_concept_auto_fix',
      concept_map: relative(mapPath),
      apply_mode: Boolean(options.apply),
    },
    entries,
  };
  const report = {
    chapter_id: chapterId,
    generated_at: generatedAt,
    source: patch.source,
    counts: countDecisions(decisions),
    patch_entries: entries.length,
    llm_queue_entries: llmQueue.length,
    human_queue_entries: humanQueue.length,
    applied: Boolean(options.apply),
  };

  await writeJson(path.join(outputDir, `${chapterId}_auto_fix_patch.json`), patch);
  await writeJson(path.join(outputDir, `${chapterId}_auto_fix_report.json`), report);
  await writeJsonl(path.join(outputDir, `${chapterId}_llm_queue.jsonl`), llmQueue);
  await writeJson(path.join(outputDir, `${chapterId}_human_review_queue.json`), {
    chapter_id: chapterId,
    generated_at: generatedAt,
    entries: humanQueue,
  });

  if (options.apply && entries.length) {
    const updated = applyPatch(mapPayload, patch, generatedAt);
    await writeJson(mapPath, updated);
  }

  console.log(`Auto-fix ${chapterId}`);
  console.log(`  patch entries: ${entries.length}`);
  console.log(`  llm queue: ${llmQueue.length}`);
  console.log(`  human queue: ${humanQueue.length}`);
  if (options.apply) console.log(`  applied: ${relative(mapPath)}`);

  return { chapterId, report, patchEntries: entries.length, llmQueue: llmQueue.length, humanQueue: humanQueue.length };
}

function decideConcept(concept, generatedAt) {
  const status = concept.review_status || 'unreviewed';
  const flags = new Set(Array.isArray(concept.review_flags) ? concept.review_flags : []);
  const base = basePatchFields(concept);
  const unsafePublicName = isUnsafePublicConceptName(concept);
  const calibrated = CONCEPT_CALIBRATIONS.get(stableKey(concept));
  if (calibrated && calibrationNeedsPatch(concept, calibrated)) {
    const calibratedPatch = buildCalibrationPatch(concept, calibrated);
    return decision('rule_calibrated', {
      patch: {
        ...base,
        ...calibratedPatch,
        confidence: Math.max(Number(concept.confidence || 0), Number(calibrated.confidence || 0.92)),
        review_status: calibrated.review_status || (status === 'approved' ? 'approved' : 'edited'),
        review_flags: [],
        reviewed_by: 'auto_rule_fix',
        reviewed_at: generatedAt,
        review_notes: calibrated.replace_review_notes
          ? (calibrated.review_notes || 'Rule calibration applied.')
          : appendReviewNote(concept.review_notes, calibrated.review_notes || 'Rule calibration applied.'),
      },
    });
  }

  if (!REVIEWABLE_STATUSES.has(status) && !unsafePublicName) return decision('kept');

  if (flags.has('index_like_defined_symbol') && INDEX_LIKE_DEFINED.test(normalizeSymbol(concept.symbol))) {
    return decision('rule_rejected_index_defined', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: index-like variable was parsed as a defined concept.'),
    });
  }

  if (isRejectableStructuralParserFragment(concept)) {
    return decision('rule_rejected_structural_parser_fragment', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: malformed LaTeX fragment was parsed as a standalone concept.'),
    });
  }

  if (flags.has('formula_or_symbol_artifact') && isRejectableExpressionArtifact(concept)) {
    return decision('rule_rejected_expression_artifact', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: compound formula expression was parsed as a standalone concept.'),
    });
  }

  if (isRejectableUsedExpressionFragment(concept)) {
    return decision('rule_rejected_used_expression_fragment', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: arithmetic or transition expression fragment was parsed as a standalone used concept.'),
    });
  }

  if (isRejectableStandaloneMathOperator(concept)) {
    return decision('rule_rejected_standalone_math_operator', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: mathematical operator or constant token was parsed as a standalone concept.'),
    });
  }

  if (flags.has('formula_or_symbol_artifact') && isRejectableBareConstantArtifact(concept)) {
    return decision('rule_rejected_bare_constant_artifact', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: bare mathematical constant or text fragment was parsed as a standalone used concept.'),
    });
  }

  if (isFormulaPlaceholder(concept) || isLatexParserArtifact(concept)) {
    return decision('rule_rejected_formula_artifact', {
      patch: rejectPatch(base, concept, generatedAt, 'Rule rejected: concept is a formula placeholder or LaTeX parser artifact.'),
    });
  }

  const standardSymbol = standardSymbolRepairPatch(concept, flags);
  if (standardSymbol) {
    return decision('rule_standard_symbol_repair', {
      patch: {
        ...base,
        ...standardSymbol,
        review_status: 'edited',
        reviewed_by: 'auto_rule_fix',
        reviewed_at: generatedAt,
        review_notes: appendReviewNote(concept.review_notes, standardSymbol.review_notes),
      },
    });
  }

  if (unsafePublicName) {
    return decision('llm_required_unsafe_public_name', {
      llmRecord: llmRecord(concept, reasonsForLlm(concept, flags)),
      humanItem: isHumanRisk(concept, flags) ? humanItem(concept, reasonsForHuman(concept, flags)) : null,
    });
  }

  const trusted = trustedDictionaryPatch(concept, flags);
  if (trusted) {
    return decision('rule_trusted_dictionary', {
      patch: {
        ...base,
        ...trusted,
        review_status: 'edited',
        review_flags: trusted.review_flags,
        reviewed_by: 'auto_rule_fix',
        reviewed_at: generatedAt,
        review_notes: appendReviewNote(concept.review_notes, trusted.review_notes),
      },
    });
  }

  const trustedStandardDefined = trustedStandardDefinedSymbolPatch(concept, flags);
  if (trustedStandardDefined) {
    return decision('rule_trusted_standard_defined_symbol', {
      patch: {
        ...base,
        ...trustedStandardDefined,
        review_status: 'edited',
        review_flags: trustedStandardDefined.review_flags,
        reviewed_by: 'auto_rule_fix',
        reviewed_at: generatedAt,
        review_notes: appendReviewNote(concept.review_notes, trustedStandardDefined.review_notes),
      },
    });
  }

  const rewrite = deterministicRewrite(concept);
  if (rewrite) {
    const nextFlags = removeFlags(flags, ['template_definition', 'formula_or_symbol_artifact', 'low_confidence', 'needs_review']);
    if (needsEscalationAfterRewrite(concept, new Set(nextFlags))) {
      const highRiskReasons = ['rule_rewrite_still_high_risk', ...reasonsForLlm(concept, new Set(nextFlags))];
      return decision('llm_required_after_rule_rewrite', {
        llmRecord: llmRecord(concept, highRiskReasons, rewrite),
        humanItem: isHumanRisk(concept, new Set(nextFlags)) ? humanItem(concept, reasonsForHuman(concept, new Set(nextFlags))) : null,
      });
    }
    return decision('rule_rewritten', {
      patch: {
        ...base,
        ...rewrite,
        review_status: 'edited',
        review_flags: nextFlags,
        reviewed_by: 'auto_rule_fix',
        reviewed_at: generatedAt,
        review_notes: appendReviewNote(concept.review_notes, rewrite.review_notes),
      },
    });
  }

  if (needsLlm(concept, flags)) {
    return decision('llm_required', {
      llmRecord: llmRecord(concept, reasonsForLlm(concept, flags)),
      humanItem: isHumanRisk(concept, flags) ? humanItem(concept, reasonsForHuman(concept, flags)) : null,
    });
  }

  return decision('kept');
}

function buildCalibrationPatch(concept, calibrated) {
  const {
    replace_aliases: _replaceAliases,
    replace_review_notes: _replaceReviewNotes,
    aliases = [],
    ...patch
  } = calibrated;
  return {
    ...patch,
    aliases: calibrated.replace_aliases ? unique(aliases) : unique([...(concept.aliases || []), ...aliases]),
  };
}

function calibrationNeedsPatch(concept, calibrated) {
  const expectedAliases = calibrated.replace_aliases ? unique(calibrated.aliases || []) : unique([...(concept.aliases || []), ...(calibrated.aliases || [])]);
  const expectedFlags = [];
  const expectedStatus = calibrated.review_status || ((concept.review_status || 'unreviewed') === 'approved' ? 'approved' : 'edited');
  return calibrationFieldDiffers(concept, calibrated, 'concept_name')
    || calibrationFieldDiffers(concept, calibrated, 'concept_type')
    || calibrationFieldDiffers(concept, calibrated, 'definition')
    || calibrationFieldDiffers(concept, calibrated, 'definition_zh')
    || Number(concept.confidence || 0) < Number(calibrated.confidence || 0.92)
    || cleanTitle(concept.review_status || 'unreviewed') !== expectedStatus
    || !sameStringList(concept.review_flags || [], expectedFlags)
    || !sameStringList(concept.aliases || [], expectedAliases)
    || (calibrated.replace_review_notes && cleanTitle(concept.review_notes) !== cleanTitle(calibrated.review_notes || 'Rule calibration applied.'));
}

function calibrationFieldDiffers(concept, calibrated, field) {
  if (!Object.prototype.hasOwnProperty.call(calibrated, field)) return false;
  return cleanTitle(concept[field]) !== cleanTitle(calibrated[field]);
}

function trustedStandardDefinedSymbolPatch(concept, flags) {
  const currentName = cleanTitle(concept.concept_name || '');
  const currentNameKey = currentName.toLowerCase();
  const dictionaryDefinition = CONCEPT_DEFINITIONS.get(currentNameKey);
  const dictionaryDefinitionZh = CONCEPT_DEFINITIONS_ZH.get(currentNameKey);
  if (!dictionaryDefinition) return null;
  if (concept.role !== 'defined') return null;
  if (isHumanRisk(concept, flags)) return null;
  if (![...flags].every((flag) => (
    flag === 'weak_evidence'
    || flag === 'low_confidence'
    || flag === 'template_definition'
    || flag === 'formula_or_symbol_artifact'
    || flag === 'generic_defined_concept_name'
    || flag === 'auto_canonical_merge'
  ))) return null;
  if (!isTrustedStandardDefinedSymbol(concept.symbol, currentName)) return null;
  if (isFormulaExpressionText(concept.definition)) return null;

  const nextFlags = removeFlags(flags, [
    'weak_evidence',
    'low_confidence',
    'template_definition',
    'formula_or_symbol_artifact',
    'generic_defined_concept_name',
  ]);
  return {
    concept_name: currentName,
    concept_type: concept.concept_type || 'quantity_concept',
    definition: dictionaryDefinition,
    definition_zh: dictionaryDefinitionZh || concept.definition_zh,
    aliases: unique([...(concept.aliases || []), concept.symbol, baseSymbol(concept.symbol), currentName]),
    confidence: Math.max(Number(concept.confidence || 0), 0.9),
    review_flags: nextFlags,
    review_notes: 'Rule trusted standard defined symbol: a conventional mathematical symbol family matches a curated local concept definition.',
  };
}

function isTrustedStandardDefinedSymbol(symbol, conceptName) {
  const compact = cleanTitle(symbol).replace(/\s+/g, '');
  if (conceptName === 'Probability Density') {
    return /^\\(?:varphi|phi)(?:_\{?[A-Za-z0-9]+\}?|\^\{?[A-Za-z0-9]+\}?)*$/.test(compact);
  }
  if (conceptName === 'Variance') {
    const unstyled = compact
      .replace(/^\\(?:widehat|hat|widetilde|tilde|bar|overline)\{(.+)\}$/, '$1')
      .replace(/^\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{(.+)\}$/, '$1');
    return /^\\sigma(?:_\{[^{}]+\}|_[A-Za-z0-9\\]+)?\^\{?2\}?/.test(unstyled)
      || /^\\sigma(?:_\{[^{}]+\}|_[A-Za-z0-9\\]+)?\^\{?2\}?\(.+\)$/.test(unstyled);
  }
  return false;
}

function trustedDictionaryPatch(concept, flags) {
  const currentName = cleanTitle(concept.concept_name || '');
  const currentNameKey = currentName.toLowerCase();
  const dictionaryDefinition = CONCEPT_DEFINITIONS.get(currentNameKey);
  const dictionaryDefinitionZh = CONCEPT_DEFINITIONS_ZH.get(currentNameKey);
  if (!dictionaryDefinition) return null;
  if (isHumanRisk(concept, flags)) return null;
  if (flags.has('formula_or_symbol_artifact') || flags.has('needs_review')) return null;
  if (![...flags].every((flag) => flag === 'weak_evidence' || flag === 'low_confidence' || flag === 'template_definition')) return null;
  if (concept.role === 'defined' && PRODUCT_GENERIC_CONCEPT_NAMES.has(currentNameKey)) return null;
  if (isFormulaExpressionText(concept.definition)) return null;

  const definitionMatches = normalizeText(concept.definition).toLowerCase() === dictionaryDefinition.toLowerCase();
  const mayReplaceWeakDefinition = flags.has('template_definition') || isWeakDefinition(concept.definition) || isWeakDefinition(concept.definition_zh);
  if (!definitionMatches && !mayReplaceWeakDefinition && Number(concept.confidence || 0) < 0.78) return null;

  const nextFlags = removeFlags(flags, ['weak_evidence', 'low_confidence', 'template_definition']);
  return {
    concept_name: currentName,
    concept_type: concept.concept_type || (concept.role === 'defined' ? 'quantity_concept' : 'domain_concept'),
    definition: definitionMatches ? concept.definition : dictionaryDefinition,
    definition_zh: dictionaryDefinitionZh || concept.definition_zh,
    aliases: unique([...(concept.aliases || []), concept.symbol, baseSymbol(concept.symbol), currentName]),
    confidence: Math.max(Number(concept.confidence || 0), 0.82),
    review_flags: nextFlags,
    review_notes: 'Rule trusted dictionary concept: existing name and definition match a curated local concept definition.',
  };
}

function standardSymbolRepairPatch(concept, flags) {
  const repair = STANDARD_SYMBOL_REPAIRS.find((item) => item.pattern.test(cleanTitle(concept.symbol || '')));
  if (!repair) return null;
  if (isHumanRisk(concept, flags)) return null;
  const nextFlags = removeFlags(flags, [
    'generic_defined_concept_name',
    'low_confidence',
    'template_definition',
    'formula_or_symbol_artifact',
    'needs_review',
  ]);
  return {
    concept_name: repair.concept_name,
    concept_type: repair.concept_type,
    definition: repair.definition,
    definition_zh: repair.definition_zh,
    aliases: unique([...(concept.aliases || []), ...(repair.aliases || []), concept.symbol]),
    confidence: Math.max(Number(concept.confidence || 0), repair.confidence),
    review_flags: nextFlags,
    review_notes: repair.review_notes,
  };
}

function deterministicRewrite(concept) {
  const symbolSpecific = symbolSpecificConcept(concept.symbol);
  const commonName = COMMON_SYMBOL_NAMES.get(concept.symbol) || COMMON_SYMBOL_NAMES.get(baseSymbol(concept.symbol));
  const currentName = cleanTitle(concept.concept_name || '');
  const nextName = symbolSpecific?.name || commonName || currentName;
  const nextType = symbolSpecific?.type || concept.concept_type || (concept.role === 'defined' ? 'quantity_concept' : 'domain_concept');
  const definition = CONCEPT_DEFINITIONS.get(nextName.toLowerCase());
  const definitionZh = CONCEPT_DEFINITIONS_ZH.get(nextName.toLowerCase());
  const hasTemplate = (concept.review_flags || []).includes('template_definition');
  const hasArtifact = (concept.review_flags || []).includes('formula_or_symbol_artifact');
  const canImproveName = nextName && nextName !== currentName && !PRODUCT_GENERIC_CONCEPT_NAMES.has(nextName.toLowerCase());
  const canImproveDefinition = Boolean(definition && (hasTemplate || isWeakDefinition(concept.definition)));
  const canImproveDefinitionZh = Boolean(definitionZh && (hasTemplate || isWeakDefinition(concept.definition_zh)));
  const canClearKnownArtifact = hasArtifact && definition && !isLatexParserArtifact(concept);
  if (!canImproveName && !canImproveDefinition && !canImproveDefinitionZh && !canClearKnownArtifact) return null;

  return {
    concept_name: canImproveName ? nextName : currentName,
    concept_type: nextType,
    definition: canImproveDefinition ? definition : concept.definition,
    definition_zh: canImproveDefinitionZh ? definitionZh : concept.definition_zh,
    aliases: unique([...(concept.aliases || []), concept.symbol, baseSymbol(concept.symbol), nextName]),
    confidence: Math.max(Number(concept.confidence || 0), canImproveName ? 0.78 : 0.74),
    review_notes: `Rule rewrite: ${[
      canImproveName ? 'symbol pattern renamed the concept' : '',
      canImproveDefinition || canImproveDefinitionZh ? 'dictionary definition replaced template copy' : '',
      canClearKnownArtifact ? 'known dictionary concept cleared formula-artifact flag' : '',
    ].filter(Boolean).join('; ')}.`,
  };
}

function symbolSpecificConcept(symbol) {
  const exact = EXACT_SYMBOL_CONCEPTS.get(symbol);
  if (exact) return exact;
  return SUBSCRIPT_SYMBOL_NAMES.find((item) => item.pattern.test(symbol));
}

function isUnsafePublicConceptName(concept) {
  const name = cleanTitle(concept.concept_name || '').toLowerCase();
  if (!name) return false;
  return UNSAFE_PUBLIC_CONCEPT_NAMES.has(name);
}

function needsLlm(concept, flags) {
  if (isUnsafePublicConceptName(concept)) return true;
  if (flags.has('weak_evidence') && Number(concept.confidence || 0) < 0.82) return true;
  if ([...AUTO_FIX_FLAGS].some((flag) => flags.has(flag))) return true;
  if ([...LLM_REPAIR_FLAGS].some((flag) => flags.has(flag))) return true;
  return false;
}

function needsEscalationAfterRewrite(concept, flags) {
  if ((concept.review_status || 'unreviewed') === 'ambiguous') return true;
  if ([...HUMAN_RISK_FLAGS].some((flag) => flags.has(flag))) return true;
  if ([...LLM_REPAIR_FLAGS].some((flag) => flags.has(flag))) return true;
  return false;
}

function isHumanRisk(concept, flags) {
  if ((concept.review_status || 'unreviewed') === 'ambiguous') return true;
  return [...HUMAN_RISK_FLAGS].some((flag) => flags.has(flag));
}

function reasonsForLlm(concept, flags) {
  const reasons = [...flags].filter((flag) => AUTO_FIX_FLAGS.has(flag) || HUMAN_RISK_FLAGS.has(flag));
  if (isUnsafePublicConceptName(concept)) reasons.push('unsafe_public_concept_name');
  if (flags.has('weak_evidence') && Number(concept.confidence || 0) < 0.82) reasons.push('weak_evidence');
  if (!reasons.length && Number(concept.confidence || 0) < 0.72) reasons.push('low_confidence');
  return reasons;
}

function reasonsForHuman(concept, flags) {
  const reasons = [];
  if ((concept.review_status || 'unreviewed') === 'ambiguous') reasons.push('ambiguous');
  for (const flag of flags) {
    if (HUMAN_RISK_FLAGS.has(flag)) reasons.push(flag);
  }
  return reasons;
}

function rejectPatch(base, concept, generatedAt, reviewNotes) {
  return {
    ...base,
    review_status: 'rejected',
    review_flags: unique([...(concept.review_flags || []), 'auto_rejected']),
    reviewed_by: 'auto_rule_fix',
    reviewed_at: generatedAt,
    review_notes: appendReviewNote(concept.review_notes, reviewNotes),
  };
}

function isFormulaPlaceholder(concept) {
  return FORMULA_PLACEHOLDER_NAME.test(concept.concept_name || '') || String(concept.concept_id || '').endsWith('_statement');
}

function isRejectableStructuralParserFragment(concept) {
  const symbol = cleanTitle(concept.symbol || '');
  const name = cleanTitle(concept.concept_name || '');
  if (!symbol) return false;
  if (CONCEPT_DEFINITIONS.has(name.toLowerCase())) return false;
  if (isSimpleDecoratedSymbol(symbol)) return false;
  if (hasUnbalancedDelimiters(symbol)) return true;
  if (/^\\[A-Za-z]+\\(?:big|Big|bigg|Bigg)$/.test(symbol)) return true;
  if (/^\\(?:big|Big|bigg|Bigg)$/.test(symbol)) return true;
  return false;
}

function hasUnbalancedDelimiters(value) {
  const text = String(value || '');
  return countChar(text, '{') !== countChar(text, '}')
    || countChar(text, '(') !== countChar(text, ')')
    || countChar(text, '[') !== countChar(text, ']');
}

function countChar(value, char) {
  return [...String(value || '')].filter((item) => item === char).length;
}

function isLatexParserArtifact(concept) {
  const name = String(concept.concept_name || '');
  const symbol = String(concept.symbol || '');
  if (!LATEX_PARSER_FRAGMENT.test(symbol) && !LATEX_PARSER_FRAGMENT.test(name)) return false;
  if (CONCEPT_DEFINITIONS.has(name.toLowerCase())) return false;
  return true;
}

function isRejectableExpressionArtifact(concept) {
  const name = cleanTitle(concept.concept_name || '');
  const symbol = cleanTitle(concept.symbol || '');
  if (!symbol) return false;
  if (CONCEPT_DEFINITIONS.has(name.toLowerCase())) return false;
  if (COMMON_SYMBOL_NAMES.has(symbol) || COMMON_SYMBOL_NAMES.has(baseSymbol(symbol))) return false;
  if (symbolSpecificConcept(symbol)) return false;
  if (isSimpleDecoratedSymbol(symbol)) return false;
  if (/\\int(?=[^A-Za-z]|$)/.test(symbol)) return true;
  if (isExponentialFactor(symbol) && isFormulaArtifactConceptName(name)) return true;
  if (hasTopLevelArithmeticSymbol(symbol) && isFormulaArtifactConceptName(name)) return true;
  if (hasArithmeticExpressionSymbol(symbol) && isFormulaArtifactConceptName(name)) return true;
  if (/\\(?:sum|prod)(?=[^A-Za-z]|$)/.test(symbol) && isFormulaArtifactConceptName(name)) return true;
  return false;
}

function isRejectableUsedExpressionFragment(concept) {
  const symbol = cleanTitle(concept.symbol || '');
  const name = cleanTitle(concept.concept_name || '');
  if (concept.role !== 'used') return false;
  if (!symbol) return false;
  if (CONCEPT_DEFINITIONS.has(name.toLowerCase())) return false;
  if (COMMON_SYMBOL_NAMES.has(symbol) || COMMON_SYMBOL_NAMES.has(baseSymbol(symbol))) return false;
  if (symbolSpecificConcept(symbol)) return false;
  if (isSimpleDecoratedSymbol(symbol)) return false;
  if (/(?:\\rightarrow|\\to)(?=[^A-Za-z]|$)/.test(symbol)) return true;
  if (/^[A-Za-z\\][A-Za-z0-9\\_{}^]*\s*[+\-]\s*(?:\d+|[A-Za-z]|\\[A-Za-z]+(?:_\{[^{}]+\})?)$/.test(symbol)) return true;
  if (/^\d+\s*[-+]\s*[A-Za-z\\]/.test(symbol)) return true;
  if (hasTopLevelArithmeticSymbol(symbol) && isFormulaArtifactConceptName(name)) return true;
  return false;
}

function isRejectableBareConstantArtifact(concept) {
  const symbol = cleanTitle(concept.symbol || '');
  const name = cleanTitle(concept.concept_name || '');
  if (concept.role !== 'used') return false;
  if (symbol !== 'e') return false;
  if (name !== 'E') return false;
  if (CONCEPT_DEFINITIONS.has(name.toLowerCase())) return false;
  return true;
}

function isRejectableStandaloneMathOperator(concept) {
  const symbol = cleanTitle(concept.symbol || '');
  if (!STANDALONE_MATH_OPERATOR_TOKENS.has(symbol)) return false;
  if (symbol === '\\Delta' && concept.role !== 'used') return false;
  return true;
}

function hasArithmeticExpressionSymbol(symbol) {
  const text = String(symbol || '');
  return /\([^)]*[+*/-][^)]*\)/.test(text)
    || /\^\{?-[^{}]+\}?/.test(text);
}

function hasTopLevelArithmeticSymbol(symbol) {
  const text = String(symbol || '')
    .replace(/_\{[^{}]*\}/g, '')
    .replace(/\^\{[^{}]*\}/g, '')
    .replace(/_[A-Za-z0-9\\]+/g, '')
    .replace(/\^[A-Za-z0-9\\]+/g, '');
  return /[+*/]/.test(text) || /(?:^|[^A-Za-z])-/.test(text);
}

function isExponentialFactor(symbol) {
  return /^e\^\{?-/i.test(String(symbol || '').replace(/\s+/g, ''));
}

function isSimpleDecoratedSymbol(symbol) {
  const text = String(symbol || '').replace(/\s+/g, '');
  const atom = '(?:\\\\[A-Za-z]+|[A-Za-z])';
  const script = '(?:_\\{?[A-Za-z0-9\\\\,+\\-/*]+\\}?|\\^\\{?\\*\\}?|\\^\\{?\\\\prime\\}?|\\^\\{?\\d+\\}?)*';
  return new RegExp(`^(?:\\\\(?:bar|overline|widehat|hat|widetilde|tilde)\\{${atom}${script}\\}|${atom}${script})$`).test(text);
}

function isWeakDefinition(value) {
  const text = normalizeText(value);
  return !text || /(?:core quantity|supporting quantity|controls the strength|right-hand side|local context|formula|general measure|quantity that can vary|rule that maps inputs)/i.test(text);
}

function removeFlags(flags, removable) {
  const removableSet = new Set(removable);
  return [...flags].filter((flag) => !removableSet.has(flag));
}

function llmRecord(concept, reasons, proposedPatch = null, retryAttempt = 0) {
  const input = {
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    formula_latex: concept.formula_latex || concept.supporting_formula_latex || '',
    formula_section: concept.formula_section || '',
    formula_subsection: concept.formula_subsection || '',
    symbol: concept.symbol,
    symbol_role: concept.role,
    current_candidate: {
      concept_id: concept.concept_id,
      concept_name: concept.concept_name,
      concept_type: concept.concept_type,
      definition: concept.definition,
      definition_zh: concept.definition_zh,
      confidence: concept.confidence,
      review_flags: concept.review_flags || [],
    },
    evidence: concept.evidence || [],
    source_sentence: concept.source_sentence || '',
    auto_fix_reasons: reasons,
    retry_attempt: retryAttempt,
    proposed_rule_patch: proposedPatch,
  };
  return {
    task_id: stableKey(concept),
    input,
    output_schema: symbolConceptOutputSchema(),
    prompt: buildPromptText(input),
  };
}

function humanItem(concept, reasons) {
  return {
    stable_key: stableKey(concept),
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    formula_label: concept.formula_label,
    symbol: concept.symbol,
    role: concept.role,
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    concept_type: concept.concept_type,
    definition: concept.definition,
    definition_zh: concept.definition_zh,
    confidence: Number(concept.confidence || 0),
    review_status: concept.review_status || 'unreviewed',
    review_flags: concept.review_flags || [],
    reasons,
    priority_score: (concept.role === 'defined' ? 60 : 20) + reasons.length * 10,
  };
}

function buildPromptText(input) {
  return [
    'You are repairing a symbol-to-concept map for a mathematical biology textbook.',
    'Use only the formula metadata, symbol, local evidence, and current candidate. Do not create dependency edges.',
    'Return one JSON object matching output_schema. Prefer a specific learner-facing concept name over a bare symbol name.',
    'Do not use generic public names such as Mean, Function, Variable, Count, Distance, Coefficient, Index, Parameter, or Rate.',
    'Do not wrap a symbol in a generic label such as "Mean of x", "Variable x", or "Function f"; name the biological/statistical quantity, or reject if the evidence is insufficient.',
    'If the symbol is only an index or parser artifact, set review_status to rejected and explain why in review_notes.',
    'Input:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function symbolConceptOutputSchema() {
  return {
    type: 'object',
    required: ['formula_id', 'symbol', 'role', 'concept_name', 'concept_type', 'definition', 'confidence', 'review_status'],
    properties: {
      formula_id: { type: 'string' },
      symbol: { type: 'string' },
      role: { enum: ['defined', 'used'] },
      concept_name: { type: 'string' },
      concept_type: { enum: ['quantity_concept', 'math_concept', 'domain_concept', 'theorem_or_principle', 'operator_or_function', 'unknown'] },
      definition: { type: 'string' },
      definition_zh: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'array', items: { type: 'object' } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      review_status: { enum: [...REVIEW_STATUSES] },
      review_flags: { type: 'array', items: { type: 'string' } },
      review_notes: { type: 'string' },
    },
  };
}

function validateLlmResult(raw, conceptByKey, generatedAt) {
  if (!isRecord(raw)) {
    return { rejected: rejectedLlmItem(raw, null, ['result_not_object']) };
  }
  const key = cleanTitle(raw.stable_key || raw.task_id || [raw.chapter_id, raw.formula_id, raw.role, raw.symbol].map((item) => String(item || '')).join('::'));
  const original = conceptByKey.get(key);
  if (!original) {
    return { rejected: rejectedLlmItem(raw, key, ['unknown_stable_key']) };
  }

  const normalizedRaw = normalizeLlmResultForValidation(raw);
  const conceptName = cleanTitle(normalizedRaw.concept_name);
  const conceptType = cleanTitle(raw.concept_type);
  const definition = cleanTitle(normalizedRaw.definition);
  const definitionZh = cleanTitle(raw.definition_zh);
  const confidence = clampConfidence(normalizedRaw.confidence);
  const reviewStatus = cleanTitle(raw.review_status || 'edited');
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.filter((item) => typeof item === 'string').map(cleanTitle).filter(Boolean) : original.aliases || [];
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter(isRecord) : original.evidence || [];
  const reviewFlags = new Set(Array.isArray(raw.review_flags) ? raw.review_flags.filter((item) => typeof item === 'string') : []);
  const issues = [];

  if (!REVIEW_STATUSES.includes(reviewStatus)) issues.push('invalid_review_status');
  if (reviewStatus === 'rejected' && !issues.length) {
    return {
      entry: {
        ...basePatchFields(original),
        concept_name: original.concept_name,
        concept_type: original.concept_type,
        definition: original.definition,
        definition_zh: original.definition_zh,
        aliases: original.aliases || [],
        evidence: original.evidence || [],
        confidence: Number.isFinite(original.confidence) ? original.confidence : 0,
        review_status: 'rejected',
        review_flags: unique([...reviewFlags, 'llm_validated']),
        reviewed_by: 'auto_llm_fix',
        reviewed_at: generatedAt,
        review_notes: appendReviewNote(
          cleanTitle(raw.review_notes),
          'Validated LLM result rejected this concept.',
        ),
        extraction_model: cleanTitle(raw.extraction_model || 'llm_validated_concept_auto_fix'),
      },
    };
  }

  if (!conceptName) issues.push('missing_concept_name');
  if (!definition) issues.push('missing_definition');
  if (!CONCEPT_TYPES.has(conceptType)) issues.push('invalid_concept_type');
  if (confidence < 0.72 && reviewStatus !== 'rejected') issues.push('low_confidence');
  if (isWeakDefinition(definition) || isWeakDefinition(definitionZh)) issues.push('template_or_weak_definition');
  if (isFormulaArtifactConceptName(conceptName) || isFormulaExpressionText(definition)) issues.push('formula_or_symbol_artifact');
  if (looksLikeRawSymbolName(conceptName, raw.symbol || original.symbol)) issues.push('raw_symbol_concept_name');
  if (hasEnglishEncodingArtifact(conceptName) || hasEnglishEncodingArtifact(definition)) issues.push('encoding_artifact');
  if (reviewStatus === 'approved') issues.push('llm_cannot_auto_approve');

  if (issues.length) {
    return {
      rejected: rejectedLlmItem(raw, key, issues, original),
    };
  }

  const status = reviewStatus === 'rejected' ? 'rejected' : 'edited';
  if (status !== 'rejected') reviewFlags.delete('needs_review');
  reviewFlags.delete('low_confidence');
  reviewFlags.add('llm_validated');

  return {
    entry: {
      ...basePatchFields(original),
      concept_name: conceptName,
      concept_type: conceptType,
      definition,
      definition_zh: definitionZh || original.definition_zh,
      aliases: unique([...aliases, original.symbol, conceptName]),
      evidence,
      confidence,
      review_status: status,
      review_flags: [...reviewFlags],
      reviewed_by: 'auto_llm_fix',
      reviewed_at: generatedAt,
      review_notes: appendReviewNote(
        cleanTitle(raw.review_notes),
        status === 'rejected' ? 'Validated LLM result rejected this concept.' : 'Validated LLM concept repair accepted.',
      ),
      extraction_model: cleanTitle(raw.extraction_model || 'llm_validated_concept_auto_fix'),
    },
  };
}

function rejectedLlmItem(raw, stableKeyValue, reasons, original = null) {
  const retryAttempt = positiveInteger(raw?.retry_attempt, 0);
  const retryable = original
    && retryableLlmRejection(reasons)
    && retryAttempt < DEFAULT_MAX_LLM_RETRY_ATTEMPTS;
  const retryRecord = retryable
    ? llmRecord(original, unique(['llm_rejected', ...reasons]), repairHintFromRejectedResult(raw, reasons), retryAttempt + 1)
    : null;
  return {
    stable_key: stableKeyValue || cleanTitle(raw?.stable_key || raw?.task_id || ''),
    chapter_id: original?.chapter_id || cleanTitle(raw?.chapter_id),
    formula_id: original?.formula_id || cleanTitle(raw?.formula_id),
    formula_label: original?.formula_label || cleanTitle(raw?.formula_label),
    symbol: original?.symbol || cleanTitle(raw?.symbol),
    role: original?.role || cleanTitle(raw?.role),
    concept_id: original?.concept_id || cleanTitle(raw?.concept_id),
    concept_name: cleanTitle(raw?.concept_name || original?.concept_name),
    concept_type: cleanTitle(raw?.concept_type || original?.concept_type),
    definition: cleanTitle(raw?.definition || original?.definition),
    confidence: typeof raw?.confidence === 'number' ? raw.confidence : original?.confidence,
    reasons,
    retry_attempt: retryAttempt,
    max_retry_attempts: DEFAULT_MAX_LLM_RETRY_ATTEMPTS,
    resolution: retryable ? 'retry' : 'human_review',
    raw_result: raw,
    retry_record: retryRecord,
    priority_score: 80 + reasons.length * 10 + (original?.role === 'defined' ? 20 : 0),
  };
}

function normalizeLlmResultForValidation(raw) {
  const normalized = { ...raw };
  normalized.concept_name = normalizeLlmConceptName(cleanTitle(raw.concept_name));
  normalized.definition = normalizeLlmDefinition(cleanTitle(raw.definition));
  if (typeof normalized.confidence !== 'number' || !Number.isFinite(normalized.confidence)) {
    const hasUsableRepair = normalized.concept_name
      && normalized.definition
      && cleanTitle(raw.review_status || 'edited') !== 'rejected';
    normalized.confidence = hasUsableRepair ? 0.9 : 0;
  }
  return normalized;
}

function normalizeLlmConceptName(name) {
  const clean = cleanTitle(name);
  if (!clean) return '';
  const distributionMean = clean.match(/^Mean of (.+?) distribution$/i);
  if (distributionMean) return `${titleCase(distributionMean[1])} Distribution Mean`;
  const variableMean = clean.match(/^Mean of (?:the )?(.+)$/i);
  if (variableMean && !/^[A-Za-z]$/i.test(variableMean[1].trim())) {
    return `${titleCase(variableMean[1])} Mean`;
  }
  if (/^Function of allele frequencies$/i.test(clean)) return 'Allele-Frequency Moment Function';
  if (/^Degrees of freedom$/i.test(clean)) return 'Degrees of Freedom';
  if (/^Phenotypic divergence$/i.test(clean)) return 'Phenotypic Divergence';
  if (/^Mean fitness$/i.test(clean)) return 'Mean Fitness';
  if (/^quadratic selection gradient$/i.test(clean)) return 'Quadratic Selection Gradient';
  if (/^allele frequency raised to power a$/i.test(clean)) return 'Powered Allele-Frequency Transform';
  if (/^Probability of fixation of a beneficial allele$/i.test(clean)) return 'Beneficial-Allele Fixation Probability';
  return titleCaseConceptName(clean);
}

function normalizeLlmDefinition(definition) {
  let clean = cleanTitle(definition);
  if (!clean) return '';
  clean = clean
    .replace(/,\s*(?:given by|defined as|where|with|here given by)\s+[^.]*[=<>][^.]*\.?$/i, '.')
    .replace(/\s+(?:given by|defined as)\s+[^.]*[=<>][^.]*\.?$/i, '.')
    .replace(/\s+for\s+[A-Za-z\\]+\s*[<>]\s*[^.]*\.?$/i, '.');
  return cleanTitle(clean);
}

function titleCase(value) {
  return cleanTitle(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function titleCaseConceptName(value) {
  const stop = new Set(['a', 'an', 'and', 'as', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return cleanTitle(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => word
      .split('-')
      .map((part, partIndex) => {
        const lower = part.toLowerCase();
        if ((index > 0 || partIndex > 0) && stop.has(lower)) return lower;
        if (/[A-Z].*[A-Z]/.test(part)) return part;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join('-'))
    .join(' ');
}

function humanLlmItem(rejected) {
  return {
    stable_key: rejected.stable_key,
    chapter_id: rejected.chapter_id,
    formula_id: rejected.formula_id,
    formula_label: rejected.formula_label,
    symbol: rejected.symbol,
    role: rejected.role,
    concept_id: rejected.concept_id,
    concept_name: rejected.concept_name,
    concept_type: rejected.concept_type,
    definition: rejected.definition,
    confidence: Number(rejected.confidence || 0),
    review_status: 'needs_revision',
    review_flags: unique(['llm_rejected', ...rejected.reasons]),
    reasons: rejected.reasons,
    priority_score: rejected.priority_score,
    review_notes: 'LLM output could not be safely retried automatically; route to human fallback review.',
  };
}

function retryableLlmRejection(reasons) {
  const terminal = new Set(['result_not_object', 'unknown_stable_key', 'invalid_review_status']);
  return Array.isArray(reasons) && reasons.length > 0 && !reasons.some((reason) => terminal.has(reason));
}

function repairHintFromRejectedResult(raw, reasons) {
  if (!isRecord(raw)) return null;
  return {
    rejected_result: {
      concept_name: cleanTitle(raw.concept_name),
      concept_type: cleanTitle(raw.concept_type),
      definition: cleanTitle(raw.definition),
      definition_zh: cleanTitle(raw.definition_zh),
      confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
      review_status: cleanTitle(raw.review_status),
      review_notes: cleanTitle(raw.review_notes),
    },
    rejection_reasons: reasons,
    retry_instruction: 'Repair the rejected result. Keep the same stable_key, formula_id, symbol, and role; fix only the concept fields or reject a true parser artifact/index.',
  };
}

function isFormulaArtifactConceptName(value) {
  const text = cleanTitle(value);
  return FORMULA_PLACEHOLDER_NAME.test(text)
    || /^[A-Za-z]$/.test(text)
    || /\b(?:Sub|Power|Widehat|Widetilde|Mathbf|Boldsymbol|Mathbb|Simeq|Frac|Left|Right|Mathrm)\b/i.test(text)
    || /^Updated\s+/i.test(text);
}

function looksLikeRawSymbolName(name, symbol) {
  const cleanName = cleanTitle(name);
  if (!cleanName) return true;
  const lowerName = cleanName.toLowerCase();
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(lowerName)) return true;
  if (UNSAFE_PUBLIC_CONCEPT_PREFIX.test(cleanName)) return true;
  if (/^(?:Variable|Function)\b/i.test(cleanName)) return true;
  if (/^Mean of (?:[A-Za-z]|\\[A-Za-z]+)$/i.test(cleanName)) return true;
  const rawSymbol = cleanTitle(symbol);
  if (!rawSymbol) return false;
  const normalizedName = normalizeSymbolLikeText(cleanName);
  const normalizedSymbol = normalizeSymbolLikeText(rawSymbol);
  if (normalizedName && normalizedSymbol && normalizedName === normalizedSymbol) return true;
  if (/^[A-Za-z]+(?:[_^][A-Za-z0-9]+)+$/.test(cleanName)) return true;
  return false;
}

function hasEnglishEncodingArtifact(value) {
  const text = cleanTitle(value);
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    if (code === 0xfffd || code === 0x00a6) return true;
    if (code >= 0x4e00 && code <= 0x9fff) return true;
  }
  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSymbolLikeText(value) {
  return cleanTitle(value)
    .replace(/\\(?:bar|overline|widehat|hat|widetilde|tilde|mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:Delta|delta|sigma|mu|Omega|omega|alpha|beta|gamma|theta|lambda|pi|phi|varphi|imath)\b/g, (match) => match.replace(/^\\/u, ''))
    .replace(/[{}\\]/g, '')
    .replace(/\s+(?:sub|power)\s+/gi, '_')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();
}

function isFormulaExpressionText(value) {
  return /[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/i.test(String(value || ''));
}

function decision(status, rest = {}) {
  return { status, ...rest };
}

function countDecisions(decisions) {
  const counts = {};
  for (const decision of decisions) {
    counts[decision.status] = (counts[decision.status] || 0) + 1;
    if (decision.patch) counts.patch_entries = (counts.patch_entries || 0) + 1;
    if (decision.llmRecord) counts.llm_queue = (counts.llm_queue || 0) + 1;
    if (decision.humanItem) counts.human_queue = (counts.human_queue || 0) + 1;
  }
  return counts;
}

function aggregateResults(results) {
  const counts = {
    patch_entries: 0,
    llm_queue: 0,
    human_queue: 0,
  };
  for (const result of results) {
    for (const [key, value] of Object.entries(result.report.counts || {})) {
      counts[key] = (counts[key] || 0) + value;
    }
  }
  return {
    generated_at: utcNow(),
    counts,
    chapters: results.map((result) => ({
      chapter_id: result.chapterId,
      counts: result.report.counts,
      patch_entries: result.patchEntries,
      llm_queue_entries: result.llmQueue,
      human_queue_entries: result.humanQueue,
    })),
  };
}

function aggregateLlmImportResults(results) {
  return {
    generated_at: utcNow(),
    counts: {
      accepted: results.reduce((sum, result) => sum + result.accepted, 0),
      rejected: results.reduce((sum, result) => sum + result.rejected, 0),
      retry: results.reduce((sum, result) => sum + (result.retry || 0), 0),
      human: results.reduce((sum, result) => sum + (result.human || 0), 0),
      applied: results.reduce((sum, result) => sum + result.applied, 0),
      skipped: results.reduce((sum, result) => sum + (result.skipped || 0), 0),
    },
    chapters: results.map((result) => ({
      chapter_id: result.chapterId,
      accepted_entries: result.accepted,
      rejected_entries: result.rejected,
      retry_queue_entries: result.retry || 0,
      human_review_queue_entries: result.human || 0,
      applied_entries: result.applied,
    })),
  };
}

function applyPatch(mapPayload, patchPayload, generatedAt) {
  const byKey = new Map((mapPayload.symbol_concepts || []).map((concept, index) => [stableKey(concept), index]));
  for (const entry of patchPayload.entries || []) {
    const key = entry.stable_key || [entry.chapter_id, entry.formula_id, entry.role, entry.symbol].join('::');
    const index = byKey.get(key);
    if (index === undefined) continue;
    const {
      stable_key: _stableKey,
      chapter_id: _chapterId,
      formula_id: _FormulaId,
      symbol: _symbol,
      role: _role,
      ...updates
    } = entry;
    mapPayload.symbol_concepts[index] = {
      ...mapPayload.symbol_concepts[index],
      ...updates,
    };
  }
  mapPayload.summary = summaryFor(mapPayload.chapter_id, mapPayload.symbol_concepts || []);
  mapPayload.review_updated_at = generatedAt;
  return mapPayload;
}

function summaryFor(chapterId, concepts) {
  const status_counts = {};
  for (const concept of concepts) {
    const status = REVIEW_STATUSES.includes(concept.review_status) ? concept.review_status : 'unreviewed';
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

function basePatchFields(concept) {
  return {
    stable_key: stableKey(concept),
    chapter_id: concept.chapter_id,
    formula_id: concept.formula_id,
    symbol: concept.symbol,
    role: concept.role,
  };
}

function stableKey(concept) {
  return [concept.chapter_id, concept.formula_id, concept.role, concept.symbol].join('::');
}

function baseSymbol(symbol = '') {
  let value = String(symbol || '').trim();
  value = value.replace(/\\(?:overline|bar|widehat|hat)\{([^{}]+)\}/g, '$1');
  value = value.replace(/_\{[^{}]+\}/g, '');
  value = value.replace(/\^\{[^{}]+\}/g, '');
  value = value.replace(/[{}]/g, '');
  value = value.replace(/^\\/, '');
  return value.trim();
}

function normalizeSymbol(symbol = '') {
  return baseSymbol(symbol).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function cleanTitle(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sameStringList(left = [], right = []) {
  const a = left.map((value) => cleanTitle(value));
  const b = right.map((value) => cleanTitle(value));
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function unique(values) {
  return [...new Set(values.map((value) => cleanTitle(value)).filter(Boolean))];
}

function appendReviewNote(existing, note) {
  return [existing, note].filter(Boolean).join('\n');
}

async function listMapChapters(inputDir) {
  const files = await readdir(inputDir);
  return files
    .filter((file) => file.endsWith('_symbol_concept_map.json'))
    .map((file) => file.replace('_symbol_concept_map.json', ''))
    .sort(sortChapterId);
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

async function readJson(filePath) {
  return JSON.parse(stripBom(await readFile(filePath, 'utf8')));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readRawItems(filePath) {
  const text = stripBom(await readFile(filePath, 'utf8'));
  if (filePath.endsWith('.jsonl')) {
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  const value = JSON.parse(text);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.entries)) return value.entries;
  return [];
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--summary') options.summary = true;
    else if (arg === '--chapter') options.chapter = args[++index];
    else if (arg === '--input-dir') options.inputDir = args[++index];
    else if (arg === '--output-dir') options.outputDir = args[++index];
    else if (arg === '--input') options.input = args[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function clampConfidence(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
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
  console.log(`Concept auto-fix pipeline

Usage:
  node scripts/auto-fix-concept-review.mjs scan --chapter chapter2
  node scripts/auto-fix-concept-review.mjs scan --all [--apply]
  node scripts/auto-fix-concept-review.mjs import-llm-results --chapter chapter2 --input tmp/results.jsonl [--apply]

Outputs:
  *_auto_fix_patch.json       deterministic rule patch
  *_llm_queue.jsonl           remaining candidates for LLM repair
  *_human_review_queue.json   small high-risk fallback queue
  *_llm_import_patch.json     validated LLM repair patch
  *_llm_rejected_queue.json   LLM outputs returned to human/rule review

The script is dry-run by default. Pass --apply to update tmp/concept-review/*_symbol_concept_map.json.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
