import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOTS = ['data/frontend', 'public/data'] as const;

const EXPECTED_LATEX_BY_ID: Record<string, string> = {
  'formula_5.7d': String.raw`W_{i}=\overline{W}\quad \text{for all } i \text{ with } 0<\widehat{p}_{i}<1`,
  'formula_9.34a': String.raw`H=1-\sum_{i=1}^{k}p_{i}^{2}`,
  'formula_9.40': String.raw`rEHH_{i}=\frac{EHH_{i}}{\mathrm{ave}_{j\neq i}(EHH_{j})}`,
  'formula_10.18': String.raw`Q_{ij}=\left\{\begin{aligned}&0&\text{if i and j differ at more than one position}\\&\pi_{j}&\text{for a silent transversion}\\&\kappa\pi_{j}&\text{for a silent transition}\\&\omega\pi_{j}&\text{for a replacement transversion}\\&\omega\kappa\pi_{j}&\text{for a replacement transition}\end{aligned}\right.\quad \text{for }1\leq i,j\leq61`,
  'formula_10.22a': String.raw`Q_{ij}^{(k)}=\begin{cases}0&\text{if i and j differ at more than one position}\\\pi_{j}&\text{for a silent transversion}\\\kappa\pi_{j}&\text{for a silent transition}\\\omega^{(k)}\pi_{j}&\text{for a replacement transversion}\\\omega^{(k)}\kappa\pi_{j}&\text{for a replacement transition}\end{cases}`,
  'formula_22.23a': String.raw`\sigma(e_{i},e_{j})=\left\{\begin{array}{ll}\sigma^{2}(e)&i=j\\ \rho\sigma^{2}(e)&i\neq j,\text{ i and j in the same group}\\ 0&i\neq j,\text{ i and j in different groups}\end{array}\right.`,
  'formula_25.9d': String.raw`p_{0}>\begin{cases}2/b&\text{recessive}\\e^{-b/4}&\text{additive}\\e^{-b/2}&\text{dominant}\end{cases}\qquad \text{where }b=\left(1-\frac{s}{\beta\alpha}\right)\frac{\alpha^{2}}{\sigma_{A}^{2}}`,
  'formula_26.12': String.raw`\begin{aligned}\Delta_{i}(\infty)&=2a-m_{i}(p_{0})\quad \text{with probability }u_{i}(p_{0})\\&=0-m_{i}(p_{0})\quad \text{with probability }1-u_{i}(p_{0})\end{aligned}`,
  'formula_28.47a': String.raw`\widetilde{\sigma}_{A}^{2}/\widehat{V}_{s}=\begin{cases}4n\mu&\text{HCA}\\4n\mu/(3\kappa_{4})&\text{deleterious pleiotropy }(\text{with }\overline{k}\ll1)\\s&\text{deleterious pleiotropy }(\text{with }\overline{k}\gg1)\end{cases}`,
};

const BAD_LATEX_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'inline English definition', regex: /frequency of the ith haplotype/i },
  { name: 'compressed for-all condition', regex: /for all i with0/i },
  { name: 'bare average condition', regex: /\)for\s*j\\neq\s*i/i },
  { name: 'bare English case label', regex: /&if\s+i\s+and\s+j\s+differ/i },
  { name: 'bare English case label', regex: /&for\s+(?:a\s+silent|a\s+replacement)/i },
  { name: 'bare case label', regex: /&(?:recessive|additive|dominant)(?=\\\\|&|\\end|\s*$)/i },
  { name: 'bare HCA label', regex: /&HCA(?=\\\\|&|\\end|\s*$)/i },
  { name: 'bare group case prose', regex: /[,&]\s*i\s+and\s+j\s+in\s+(?:the\s+same|different)\s+groups?(?=\\\\|&|\\end|\s*$)/i },
  { name: 'bare deleterious pleiotropy condition', regex: /Deleterious pleiotropy\(with/i },
];

function readJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function chapterFromFormulaId(formulaId: string): string {
  const match = /^formula_(\d+)/.exec(formulaId);
  assert.ok(match, `Expected chapter formula id, got ${formulaId}`);
  return `chapter${match[1]}`;
}

function walkJson(value: unknown, visit: (value: unknown, key: string, location: string) => void, key = '', location = '$') {
  visit(value, key, location);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, visit, String(index), `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value)) {
    walkJson(child, visit, childKey, `${location}.${childKey}`);
  }
}

function collectFormulaFieldValues(root: string): Array<{ location: string; value: string }> {
  const values: Array<{ location: string; value: string }> = [];

  const searchIndex = readJson(`${root}/formula_search_index.json`);
  walkJson(searchIndex, (value, key, location) => {
    if (key === 'latex_preview' && typeof value === 'string') values.push({ location: `${root}/formula_search_index.json${location}`, value });
  });

  const dependencyDir = path.join(ROOT, root, 'dependency');
  for (const file of fs.readdirSync(dependencyDir).filter((name) => name.endsWith('.json'))) {
    const data = readJson(`${root}/dependency/${file}`);
    walkJson(data, (value, key, location) => {
      if (key === 'latex' && typeof value === 'string') values.push({ location: `${root}/dependency/${file}${location}`, value });
    });
  }

  const conceptDir = path.join(ROOT, root, 'concept_graph');
  for (const file of fs.readdirSync(conceptDir).filter((name) => name.endsWith('.json'))) {
    const data = readJson(`${root}/concept_graph/${file}`);
    walkJson(data, (value, key, location) => {
      if (key === 'supporting_formula_latex' && typeof value === 'string') values.push({ location: `${root}/concept_graph/${file}${location}`, value });
    });
  }

  return values;
}

function hasBareWithProbability(value: string): boolean {
  const phrase = 'with probability';
  let start = value.toLowerCase().indexOf(phrase);
  while (start >= 0) {
    const before = value.slice(Math.max(0, start - 12), start);
    if (!before.endsWith('\\text{')) return true;
    start = value.toLowerCase().indexOf(phrase, start + phrase.length);
  }
  return false;
}

test('high-confidence repaired formulas stay synchronized in frontend and public data', () => {
  for (const root of DATA_ROOTS) {
    const searchIndex = readJson(`${root}/formula_search_index.json`) as Array<{ id: string; latex_preview: string }>;

    for (const [formulaId, expectedLatex] of Object.entries(EXPECTED_LATEX_BY_ID)) {
      const chapterId = chapterFromFormulaId(formulaId);
      const dependency = readJson(`${root}/dependency/${chapterId}_dependencies.json`) as { formulas: Array<{ id: string; latex: string }> };
      const formula = dependency.formulas.find((item) => item.id === formulaId);
      assert.equal(formula?.latex, expectedLatex, `${root} dependency latex for ${formulaId}`);

      const searchFormula = searchIndex.find((item) => item.id === formulaId);
      assert.equal(searchFormula?.latex_preview, expectedLatex, `${root} search latex for ${formulaId}`);
    }
  }
});

test('formula latex fields do not contain known unwrapped English prose patterns', () => {
  const failures: string[] = [];
  for (const root of DATA_ROOTS) {
    for (const { location, value } of collectFormulaFieldValues(root)) {
      for (const pattern of BAD_LATEX_PATTERNS) {
        if (pattern.regex.test(value)) failures.push(`${location}: ${pattern.name}: ${value}`);
      }
      if (hasBareWithProbability(value)) failures.push(`${location}: bare with-probability label: ${value}`);
    }
  }

  assert.deepEqual(failures, []);
});
