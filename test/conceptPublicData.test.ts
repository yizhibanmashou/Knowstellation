import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const INTERNAL_REVIEW_FILES = [
  /_symbol_concept_map\.json$/,
  /^concept_merge_candidates\.json$/,
  /^concept_review_audit\.json$/,
];

const INTERNAL_REVIEW_KEYS = new Set([
  'symbol_concepts',
  'review_summary',
  'reviewed_symbol_concepts',
  'unreviewed_symbol_concepts',
  'teaching_move',
  'teaching_move_zh',
  'extraction_model',
]);

const UNSAFE_PUBLIC_COPY = [
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
];

const FORMULA_STATEMENT_ID = /_statement$/;
const FORMULA_ARTIFACT_TITLE = /^(?:Formula\s+\S+\s+(?:Relationship|Result|Concept)|Updated\s+.+|(?:Pi Constant|Order Term|Nablaw-bar|D-hat)|(?:[A-Za-z]|[A-Za-z]_[A-Za-z0-9]+|[A-Za-z]\s+Sub\s+[A-Za-z0-9]+|[A-Za-z]\s+Power\s+[A-Za-z0-9]+))$/;
const FORMULA_ARTIFACT_FRAGMENT = /(?:[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)|\b(?:Simeq|Frac|Left|Right|Mathrm)\b|Simmathrm|Simleft)/;
const FORMULA_EXPRESSION_SYMBOL = /[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/;

test('public concept graph data excludes internal review artifacts', async () => {
  const conceptDir = path.resolve('public/data/concept_graph');
  if (!existsSync(conceptDir)) return;

  const files = await walk(conceptDir);
  const reviewOnlyFiles = files
    .map((file) => path.basename(file))
    .filter((file) => INTERNAL_REVIEW_FILES.some((pattern) => pattern.test(file)));
  assert.deepEqual(reviewOnlyFiles, []);

  for (const file of files.filter((item) => item.endsWith('.json'))) {
    const payload = JSON.parse(await readFile(file, 'utf8'));
    const leakedKeys = [];
    collectReviewKeys(payload, leakedKeys);
    assert.deepEqual(leakedKeys, [], `internal review keys leaked from ${path.relative(process.cwd(), file)}`);
    const unsafeCopy = [];
    collectUnsafeCopy(payload, unsafeCopy);
    assert.deepEqual(unsafeCopy, [], `unsafe public copy leaked from ${path.relative(process.cwd(), file)}`);
    const statementConcepts = [];
    collectFormulaStatementConcepts(payload, statementConcepts);
    assert.deepEqual(statementConcepts, [], `formula-statement concepts leaked from ${path.relative(process.cwd(), file)}`);
  }
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      files.push(...await walk(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

function collectReviewKeys(value: unknown, output: string[], prefix = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReviewKeys(item, output, `${prefix}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (INTERNAL_REVIEW_KEYS.has(key)) output.push(childPath);
    collectReviewKeys(child, output, childPath);
  }
}

function collectUnsafeCopy(value: unknown, output: string[], prefix = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnsafeCopy(item, output, `${prefix}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string' && UNSAFE_PUBLIC_COPY.some((pattern) => pattern.test(child))) {
      output.push(childPath);
    }
    collectUnsafeCopy(child, output, childPath);
  }
}

function collectFormulaStatementConcepts(value: unknown, output: string[], prefix = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFormulaStatementConcepts(item, output, `${prefix}[${index}]`));
    return;
  }

  const record = value as Record<string, unknown>;
  const conceptId = typeof record.concept_id === 'string' ? record.concept_id : '';
  const title = typeof record.name === 'string' ? record.name : typeof record.title === 'string' ? record.title : '';
  const symbol = typeof record.defined_symbol === 'string' ? record.defined_symbol : typeof record.symbol === 'string' ? record.symbol : '';
  const titleIsArtifact = FORMULA_ARTIFACT_TITLE.test(title) || FORMULA_ARTIFACT_FRAGMENT.test(title);
  const symbolIsFormulaExpression = FORMULA_EXPRESSION_SYMBOL.test(symbol);
  if (FORMULA_STATEMENT_ID.test(conceptId) || titleIsArtifact || (symbolIsFormulaExpression && titleIsArtifact)) {
    output.push(`${prefix || '<root>'}:${conceptId || title}`);
  }

  for (const [key, child] of Object.entries(record)) {
    collectFormulaStatementConcepts(child, output, prefix ? `${prefix}.${key}` : key);
  }
}
