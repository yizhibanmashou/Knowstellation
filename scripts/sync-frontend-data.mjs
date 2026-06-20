import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(root, 'data/frontend');
const target = resolve(root, 'public/data');

const reviewOnlyPatterns = [
  /[/\\]concept_graph[/\\][^/\\]+_symbol_concept_map\.json$/,
  /[/\\]concept_graph[/\\]concept_merge_candidates\.json$/,
  /[/\\]concept_graph[/\\]concept_review_audit\.json$/,
  /[/\\]concept_graph[/\\]llm_prompts(?:[/\\]|$)/,
  /[/\\]concept_graph[/\\]llm_results(?:[/\\]|$)/,
  /[/\\]symbol_sense[/\\]prompts(?:[/\\]|$)/,
];

const unsafePublicCopyPatterns = [
  /由当前支撑公式引入/,
  /局部数学量/,
  /当前公式涉及/,
  /背景概念/,
  /概念定义/,
  /教材引入/,
  /待审阅/,
  /上下文线索/,
  /由邻近段落支撑/,
  /local mathematical quantity/i,
  /supporting formula/i,
  /local formula context/i,
  /is a supporting quantity in this equation/i,
  /is the main quantity to read from this equation/i,
  /right-hand side shows/i,
  /names the biological object/i,
  /operation or transformation rule used by the equation/i,
  /model parameter conventionally denoted/i,
  /is a coefficient or parameter attached/i,
  /local context/i,
  /\[formula\]/i,
  /\b(?:frac|left|right|leq|quad|bigg|mathrm)\b/i,
  /^[A-Z]apter\b/i,
  /^[A-Za-z]\s*=/,
  /帮你把符号/,
  /标记的是/,
  /places the symbol back/i,
  /marks the object/i,
  /controls the strength, direction, or scaling of the relationship/i,
  /调节关系强弱或方向/,
];

const internalPublicFields = [
  'reviewed_by',
  'reviewed_at',
  'review_notes',
  'symbol_concepts',
  'teaching_move',
  'teaching_move_zh',
  'extraction_model',
];

function isProductData(filePath) {
  return !reviewOnlyPatterns.some((pattern) => pattern.test(filePath));
}

await mkdir(resolve(root, 'public'), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, {
  recursive: true,
  filter: (sourcePath) => isProductData(sourcePath),
});
await sanitizeProductConceptData(resolve(target, 'concept_graph'));

console.log(`Synced ${source} -> ${target}`);

async function sanitizeProductConceptData(conceptGraphDir) {
  let files = [];
  try {
    files = await readdir(conceptGraphDir);
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = resolve(conceptGraphDir, file);
    if (file === 'concept_graph_index.json') {
      await transformJson(filePath, sanitizeConceptGraphIndex);
    } else if (file.endsWith('_concept_graph.json')) {
      await transformJson(filePath, sanitizeConceptGraphPayload);
    }
  }
}

async function transformJson(filePath, transform) {
  const payload = JSON.parse(await readFile(filePath, 'utf8'));
  await writeFile(filePath, `${JSON.stringify(transform(payload), null, 2)}\n`, 'utf8');
}

function sanitizeConceptGraphIndex(payload) {
  return {
    ...payload,
    chapters: (payload.chapters || []).map((chapter) => omitKeys(chapter, [
      'symbol_concept_map',
      'review_summary',
      'symbol_concept_entries',
      'low_confidence_entries',
    ])),
    summary: omitKeys(payload.summary || {}, [
      'symbol_concept_entries',
      'reviewed_symbol_concepts',
      'unreviewed_symbol_concepts',
    ]),
  };
}

function sanitizeConceptGraphPayload(payload) {
  return stripUndefined({
    ...payload,
    source: sanitizeConceptGraphSource(payload.source || {}),
    summary: omitKeys(payload.summary || {}, ['symbol_concept_entries', 'low_confidence_entries']),
    symbol_concepts: undefined,
    views: (payload.views || []).map(sanitizeConceptView),
  });
}

function sanitizeConceptGraphSource(source) {
  return {
    ...omitKeys(source, ['symbol_concept_map']),
    method: 'learner concept views from formula dependencies and structured evidence',
  };
}

function sanitizeConceptView(view) {
  const sanitized = omitKeys(view, internalPublicFields);
  return {
    ...sanitizePublicCopy(sanitized, view),
    evidence: sanitizeEvidence(view.evidence || []),
    prerequisite_concepts: (view.prerequisite_concepts || []).map(sanitizeConceptReference),
    successor_concepts: (view.successor_concepts || []).map(sanitizeConceptReference),
    introduced_concepts: (view.introduced_concepts || []).map(sanitizeConceptReference),
  };
}

function sanitizeConceptReference(reference) {
  const sanitized = omitKeys(reference, internalPublicFields);
  const copySafe = sanitizePublicCopy(sanitized, reference);
  return {
    ...copySafe,
    prerequisite_concepts: (reference.prerequisite_concepts || []).map(sanitizeConceptReference),
    introduced_concepts: (reference.introduced_concepts || []).map(sanitizeConceptReference),
  };
}

function sanitizeEvidence(evidence) {
  return evidence.map((item) => omitKeys(item, ['teaching_move', 'teaching_move_zh', 'source_sentence']));
}

function omitKeys(value, keys) {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefined(child)]),
  );
}

function isUnsafePublicCopy(value) {
  return typeof value === 'string' && unsafePublicCopyPatterns.some((pattern) => pattern.test(value));
}

function sanitizePublicCopy(item, source = item) {
  const next = { ...item };
  const name = source.name || source.concept_name || 'Concept';
  const symbol = source.symbol || source.defined_symbol || 'the symbol';
  const formulaLabel = source.formula_label || source.supporting_formula_label || source.label || 'the formula';

  if (isUnsafePublicCopy(next.definition)) {
    next.definition = readableFallbackDefinition(name, symbol, formulaLabel, false);
  }
  if (isUnsafePublicCopy(next.definition_zh)) {
    next.definition_zh = readableFallbackDefinition(name, symbol, formulaLabel, true);
  }
  return stripUndefined(next);
}

function readableFallbackDefinition(name, symbol, formulaLabel, zh) {
  const label = String(name || symbol || 'Concept').replace(/\s+/g, ' ').trim();
  const formula = String(formulaLabel || 'the formula').replace(/\s+/g, ' ').trim();
  const lower = label.toLowerCase();
  if (zh) {
    if (/probability|density|likelihood/.test(lower)) return `${label} 表示 ${formula} 中的可能性或概率权重。`;
    if (/frequency|allele/.test(lower)) return `${label} 表示 ${formula} 中被追踪的群体比例或等位基因状态。`;
    if (/variance|sigma|covariance|correlation/.test(lower)) return `${label} 描述 ${formula} 中变量的离散程度或共同变化。`;
    if (/mean|average|expectation|expected/.test(lower)) return `${label} 表示 ${formula} 中一组取值的中心水平。`;
    if (/^tau$/.test(lower) || /\\tau/.test(symbol || '')) return `${label} 表示 ${formula} 中控制时间间隔、滞后尺度或组内相关性的参数。`;
    return `${label} 是 ${formula} 中需要先定位的量，用来读清它和核心关系的连接方式。`;
  }
  if (/probability|density|likelihood/.test(lower)) return `${label} describes probability weight in ${formula}.`;
  if (/frequency|allele/.test(lower)) return `${label} is the population proportion or allele state tracked in ${formula}.`;
  if (/variance|sigma|covariance|correlation/.test(lower)) return `${label} describes spread or joint movement in ${formula}.`;
  if (/mean|average|expectation|expected/.test(lower)) return `${label} is the center of a set of values in ${formula}.`;
  if (/^tau$/.test(lower) || /\\tau/.test(symbol || '')) return `${label} denotes the time lag, interval scale, or intraclass-correlation parameter used by ${formula}.`;
  return `${label} is a quantity to locate first when reading its relationship to the main term in ${formula}.`;
}
