import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEPENDENCY_DIR = resolve(ROOT, 'data/frontend/dependency');
const PROMPT_DIR = resolve(ROOT, 'data/frontend/symbol_sense/prompts');
const STRUCTURED_DIR = resolve(ROOT, 'data/structured');
const OUTPUT_DIR = resolve(ROOT, 'data/frontend/concept_graph');
const REVIEW_OUTPUT_DIR = resolve(ROOT, 'tmp/concept-review');
const SYMBOL_CONCEPT_MAP_SUFFIX = '_symbol_concept_map.json';
const SAFE_SINGLE_LETTER_CANONICAL_SYMBOLS = new Set(['N', 'P', 'p', 'q', 'R', 'S', 'w', 'z', 'h']);
const FLAGGED_CONCEPT_DEFINITION_ZH = '该概念的名称和解释仍需复核；当前释义依据公式上下文和符号角色生成，可作为临时学习线索。';
const FLAGGED_CONCEPT_DEFINITION_EN = 'This interpretation is still under review.';
const MAX_INTRODUCED_REFERENCES_PER_VIEW = 10;

import {
  BAD_CONCEPT_NAME,
  BAD_CONCEPT_PHRASE,
  COMMON_SYMBOL_NAMES,
  CONCEPT_CALIBRATIONS,
  CONCEPT_DEFINITIONS,
  CONCEPT_DEFINITIONS_ZH,
  GREEK_NAMES,
  IGNORED_SYMBOLS,
  LATEX_COMMAND_SYMBOLS,
  OPERATOR_SYMBOLS,
  PRODUCT_GENERIC_CONCEPT_NAMES,
  REVIEW_PRESERVED_FIELDS,
  REVIEW_STATUSES,
  SENTENCE_START_REPAIRS,
  STRUCTURED_BLOCK_PRIORITY,
  SUBSCRIPT_SYMBOL_NAMES,
} from './calibrations.mjs';
import { readJsonIfExists } from './io.mjs';
import { cleanDefinition, compactText, normalizeSpaces, repairSentenceStart, slug } from './normalization.mjs';
function conceptDefinitionZh(name, role, conceptType) {
  const key = normalizeSpaces(name).toLowerCase();
  const stable = CONCEPT_DEFINITIONS_ZH.get(key);
  if (stable) return stable;
  const label = normalizeSpaces(name) || '这个量';
  if (conceptType === 'operator_or_function') return `${label} 表示一种运算或转换规则，用来把输入量映射为输出量。`;
  if (/probability|likelihood|density|chance|risk/.test(key)) return `${label} 表示事件、状态或连续变量取值的可能性，用来读出模型给出的概率权重。`;
  if (/frequency|allele/.test(key)) return `${label} 表示群体中某类等位基因或状态所占的比例，是追踪变化方向的核心量。`;
  if (/heterozygosity|diversity/.test(key)) return `${label} 衡量遗传多样性；数值越高，随机抽到不同等位基因的机会越大。`;
  if (/variance|sigma|covariance|correlation/.test(key)) return `${label} 描述变量之间的离散程度或共同变化，用来判断变化有多宽、是否一起移动。`;
  if (/mean|average|expectation|expected/.test(key)) return `${label} 表示一组取值的中心水平，用来把个体差异汇总成可比较的总体量。`;
  if (/time|generation|age|scale|length|distance/.test(key)) return `${label} 给出过程发生的时间或尺度位置，帮助判断变化已经推进到哪一步。`;
  if (/index|count|number|category|class/.test(key)) return `${label} 用来区分类别、状态位置或计数对象，帮助定位模型中的不同项。`;
  if (/coefficient|gradient|parameter|rate|effect/.test(key)) return `${label} 表示调节关系强弱、方向或尺度的参数，用来比较条件变化带来的影响。`;
  if (conceptType === 'math_concept') return `${label} 是一种数学结构，用来把多个量整理成便于比较、缩放或计算的形式。`;
  if (conceptType === 'domain_concept') return `${label} 表示相关的生物学对象或模型条件，需要结合局部上下文确定其对应的群体、性状或过程。`;
  if (role === 'defined') return `${label} 表示一个由局部模型条件共同决定的目标数量。`;
  return `${label} 表示参与局部模型关系的辅助数量，需要结合相邻变量判断其作用方式。`;
}

function conceptDefinitionEn(name, role, conceptType) {
  const key = normalizeSpaces(name).toLowerCase();
  const stable = CONCEPT_DEFINITIONS.get(key);
  if (stable) return stable;
  const label = normalizeSpaces(name) || 'This quantity';
  if (conceptType === 'operator_or_function') return `${label} is the operation or transformation rule used by the equation.`;
  if (/probability|likelihood|density|chance|risk/.test(key)) return `${label} describes how much probability weight the model assigns to an event, state, or continuous value.`;
  if (/frequency|allele/.test(key)) return `${label} is a population-level proportion used to track how a state changes over time.`;
  if (/heterozygosity|diversity/.test(key)) return `${label} measures genetic diversity through the chance that two sampled alleles differ.`;
  if (/variance|sigma|covariance|correlation/.test(key)) return `${label} describes spread or joint movement among variables.`;
  if (/mean|average|expectation|expected/.test(key)) return `${label} summarizes individual values into a comparable population-level center.`;
  if (/time|generation|age|scale|length|distance/.test(key)) return `${label} locates the process on a time or scale axis.`;
  if (/index|count|number|category|class/.test(key)) return `${label} identifies a term, category, or state position in the equation.`;
  if (/coefficient|gradient|parameter|rate|effect/.test(key)) return `${label} is a coefficient or parameter attached to a term in this equation; interpret it from the surrounding biological context before comparing magnitudes.`;
  if (conceptType === 'math_concept') return `${label} is a mathematical structure used to organize, transform, or compare quantities.`;
  if (conceptType === 'domain_concept') return `${label} names the biological object or model condition being used in this formula.`;
  if (role === 'defined') return `${label} is the main quantity to read from this equation; the right-hand side shows which terms determine it.`;
  return `${label} is a supporting quantity in this equation; read how it combines with the main term.`;
}


function conceptTeachingMoveFromContext(context = '') {
  const normalized = normalizeSpaces(context);
  if (!normalized) return null;
  const sentences = normalized
    .replace(/\$\$[\s\S]*?\$\$/g, ' [formula] ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeSpaces(sentence))
    .filter(Boolean);
  const patterns = [
    { move: 'recalls prior equations to propose an estimator', zh: '回忆前式后提出估计量', test: /\brecalling\b.*\b(suggests?|estimator|approach)\b/i },
    { move: 'introduces an estimator', zh: '作为估计量引入', test: /\bestimat(?:or|e|ed|ing)\b/i },
    { move: 'defines a quantity explicitly', zh: '直接定义一个量', test: /\bdefined\s+as\b/i },
    { move: 'names a quantity used in the literature', zh: '给出文献中的名称', test: /\b(?:called|denoted\s+by)\b/i },
    { move: 'sets notation before the formula', zh: '先设定符号再写公式', test: /\b(?:let|letting)\b/i },
    { move: 'explains symbols with a where clause', zh: '用 where 解释符号', test: /\bwhere\b/i },
  ];
  for (const pattern of patterns) {
    const hit = sentences.find((sentence) => pattern.test.test(sentence));
    if (hit) {
      return {
        teaching_move: pattern.move,
        teaching_move_zh: pattern.zh,
        source_sentence: compactText(hit),
      };
    }
  }
  return {
    teaching_move: 'uses nearby prose as formula evidence',
    teaching_move_zh: '由邻近段落支撑',
    source_sentence: compactText(sentences[0] || normalized),
  };
}

function formulaContext(formula, promptRecord) {
  const parts = [promptRecord?.nearby_text, formula.context_text, formula.section, formula.subsection]
    .map((part) => normalizeSpaces(part))
    .filter(Boolean);
  const seen = new Set();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
}

function formulaNumber(formula) {
  return String(formula?.label || formula?.id || '')
    .replace(/^formula[_\s-]*/i, '')
    .replace(/^Formula\s+/i, '')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLatex(value) {
  return normalizeSpaces(
    String(value || '')
      .replace(/\[\[SEE_FORMULA:[^\]]+\]\]/g, ' ')
      .replace(/\[\[SEE_TABLE:[^\]]+\]\]/g, ' ')
      .replace(/\[\[SEE_EXAMPLE:[^\]]+\]\]/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[\s\S]*?\$/g, ' ')
      .replace(/\\\[[\s\S]*?\\\]/g, ' ')
      .replace(/\\\([\s\S]*?\\\)/g, ' ')
      .replace(/\\[a-zA-Z]+\{([^{}]+)\}/g, '$1')
      .replace(/[{}_^]/g, ' ')
      .replace(/\\/g, ' '),
  );
}

function splitSentences(text) {
  const clean = stripLatex(text);
  if (!clean) return [];
  return clean.split(/(?<=[.!?])\s+/).map((sentence) => normalizeSpaces(sentence)).filter(Boolean);
}

function usefulDefinitionSentence(sentence) {
  const clean = normalizeSpaces(sentence);
  if (clean.length < 28) return false;
  if (clean.length > 190) return false;
  if (!/^[A-Z][A-Za-z0-9("' ]/.test(clean)) return false;
  if (/^[a-z]/.test(clean)) return false;
  if (BAD_CONCEPT_PHRASE.test(clean)) return false;
  if (/\bholds for all possible values of\b/i.test(clean)) return false;
  if (/\bappears in the literature\b/i.test(clean)) return false;
  if (/\bWright's \(\d{4}/i.test(clean)) return false;
  if (/[A-Z][A-Z\s,'-]{18,}$/.test(clean)) return false;
  if (/\b[A-Z]{3,}(?:'S)?\b.*\b[A-Z]{3,}(?:'S)?\b/.test(clean)) return false;
  if (/\b(first|second|third)\s+term\b/i.test(clean)) return false;
  if ((clean.match(/\b[A-Za-z]\b/g) || []).length > 12) return false;
  return true;
}

function titleCase(value) {
  const stop = new Set(['a', 'an', 'and', 'as', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return normalizeSpaces(value)
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && stop.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function baseSymbol(symbol) {
  let value = String(symbol || '').trim();
  value = value.replace(/&/g, '');
  value = value.replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\s+(\\?[A-Za-z])/g, '$1');
  value = value.replace(/\\overline\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\bar\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\widehat\{([^{}]+)\}/g, '$1');
  value = value.replace(/\\hat\{([^{}]+)\}/g, '$1');
  value = value.replace(/_\{[^{}]+\}/g, '');
  value = value.replace(/\^\{[^{}]+\}/g, '');
  value = value.replace(/[{}]/g, '');
  value = value.replace(/^\\/, '');
  return value;
}

function readableSymbol(symbol) {
  let value = String(symbol || '').trim();
  value = value.replace(/&/g, '');
  value = value.replace(/\\widehat\{\\boldsymbol\{([^{}]+)\}\}/g, '$1 estimator vector');
  value = value.replace(/\\boldsymbol\{([^{}]+)\}/g, '$1 vector');
  value = value.replace(/\\mathbf\{([^{}]+)\}/g, '$1 matrix');
  value = value.replace(/\\boldsymbol\s+(\\?[A-Za-z])/g, '$1 vector');
  value = value.replace(/\\mathbf\s+(\\?[A-Za-z])/g, '$1 matrix');
  value = value.replace(/\\(?:bm|mathbb|mathcal|mathit|mathsf|mathrm)\s+(\\?[A-Za-z])/g, '$1');
  value = value.replace(/\\overline\{([^{}]+)\}/g, '$1-bar');
  value = value.replace(/\\bar\{([^{}]+)\}/g, '$1-bar');
  value = value.replace(/\\widehat\{([^{}]+)\}/g, '$1-hat');
  value = value.replace(/\\hat\{([^{}]+)\}/g, '$1-hat');
  value = value.replace(/\\Delta/g, 'Change');
  value = value.replace(/\\delta/g, 'delta');
  value = value.replace(/\\epsilon|\\varepsilon/g, 'epsilon');
  value = value.replace(/\\alpha/g, 'alpha');
  value = value.replace(/\\beta/g, 'beta');
  value = value.replace(/\\gamma/g, 'gamma');
  value = value.replace(/\\sigma/g, 'sigma');
  value = value.replace(/\\mu/g, 'mu');
  value = value.replace(/_\{([^{}]+)\}/g, ' sub $1');
  value = value.replace(/\^\{\\prime\}/g, ' prime');
  value = value.replace(/\^\{([^{}]+)\}/g, ' power $1');
  value = value.replace(/[{}]/g, '');
  value = value.replace(/\\/g, '');
  return titleCase(value);
}

function isMkTestContext(context) {
  return /MK test|McDonald|Kreitman|replacement substitutions|substitutions that are adaptive|silent sites|silent-site|neutrality index|NI_\{?[A-Z]+\}?|polymorphism.*divergence|direction of selection|DPRS|adaptive replacement|adaptive evolution/i.test(context || '');
}

function symbolSpecificConcept(symbol, context = '') {
  const compact = String(symbol || '').replace(/\s+/g, '');
  if (/^p_\{?i(?:'|\\prime)?\}?$/i.test(compact) && /\b(?:class|Price equation|descendant|fitness|trait)\b/i.test(context || '')) {
    return { name: 'Class Frequency', type: 'quantity_concept' };
  }
  if (/^p$/i.test(compact)
    && /\b(?:allele|gene\s+frequency|frequency change|selection coefficient|segregation|population genetics)\b/i.test(context || '')
    && !/\b(?:posterior|prior|likelihood|density|distribution|probability model|bayes)\b/i.test(context || '')) {
    return { name: 'Allele Frequency', type: 'quantity_concept' };
  }
  if (/^\\mathbf\{?V\}?$/i.test(compact) && /covariance matrix|variance matrix|vector of observations|mixed model/i.test(context || '')) {
    return { name: 'Observation Covariance Matrix', type: 'quantity_concept' };
  }
  if (/^\\mathbf\{?M\}?$/i.test(compact) && /projection matrix|\\mathbf\{I\}-\\mathbf\{X\}|mixed-model equations|Henderson/i.test(context || '')) {
    return { name: 'Projection Matrix', type: 'quantity_concept' };
  }
  if (/^c$/i.test(compact) && /recombination|sweep|linked neutral|linked sites|H_\{h\}|H_\{0\}|c\/s|c_0/i.test(context || '')) {
    return { name: 'Recombination Rate', type: 'quantity_concept' };
  }
  if (/^c_\{?0\}?$/i.test(compact) && /recombination|linked sites|heterozygosity|sweeps/i.test(context || '')) {
    return { name: 'Baseline Recombination Rate', type: 'quantity_concept' };
  }
  if (/^p\(0\)$/i.test(compact) && /allele frequency|sweep|p\(0\)|ln\[?p\(0\)/i.test(context || '')) {
    return { name: 'Initial Allele Frequency', type: 'quantity_concept' };
  }
  if (/^\\eta$/i.test(compact) && /complete recessive|recessive sweep|Ewing|H_\{h\}|H_\{0\}|sqrt\{?4N/i.test(context || '')) {
    return { name: 'Recessive Sweep Recombination Scale', type: 'quantity_concept' };
  }
  if (/^\\chi$/i.test(compact) && /characteristic dispersal length|geographic|Ralph and Coop|rate of spread|successful mutations/i.test(context || '')) {
    return { name: 'Characteristic Dispersal Length', type: 'quantity_concept' };
  }
  if (/^\\eta$/i.test(compact) && /Morrissey|path analysis|extended selection gradient|\\boldsymbol\{\\Phi\}|\\beta_\{?pa\}?/i.test(context || '')) {
    return { name: 'Extended Selection Gradient Vector', type: 'quantity_concept' };
  }
  if (/^H_\{?h\}?$/i.test(compact) && /sweep|H_\{0\}|heterozygosity|linked neutral/i.test(context || '')) {
    return { name: 'Sweep-Linked Heterozygosity', type: 'quantity_concept' };
  }
  if (/^H_\{?0\}?$/i.test(compact) && /sweep|H_\{h\}|heterozygosity|linked neutral/i.test(context || '')) {
    return { name: 'Baseline Heterozygosity', type: 'quantity_concept' };
  }
  if (/^\\pi$/i.test(compact) && /characteristic dispersal length|rate of spread|successful mutations|2\\pi|pi\\s*lambda|pi\\s*rho/i.test(context || '')) {
    return { name: 'Pi Constant', type: 'math_concept' };
  }
  if (/^\\pi(?:_\{?0\}?)?$/i.test(compact) && /heterozygosity|nucleotide diversity|neutral population/i.test(context || '')) {
    return { name: compact.includes('0') ? 'Baseline Heterozygosity' : 'Expected Heterozygosity', type: 'quantity_concept' };
  }
  if (/^\\frac\{?\\pi\}?\/?\{?\\pi_\{?0\}?\}?/i.test(compact) || (/\\pi/.test(compact) && /decline in heterozygosity/i.test(context || ''))) {
    return { name: 'Decline in Heterozygosity', type: 'quantity_concept' };
  }
  if (/R_\{?C\}?$/i.test(compact) && /cumulative[^.]{0,80}responses?/i.test(context || '')) {
    return { name: 'Cumulative Response', type: 'quantity_concept' };
  }
  if (/S_\{?C\}?$/i.test(compact) && /cumulative[^.]{0,80}(?:selection\s+)?differentials?/i.test(context || '')) {
    return { name: 'Cumulative Selection Differential', type: 'quantity_concept' };
  }
  if (/^c$/i.test(compact) && /\bcontrol\s*\(\s*c\s*\)\s+population/i.test(context || '')) {
    return { name: 'Control Population', type: 'domain_concept' };
  }
  if (/^s$/i.test(compact) && /\bselected\s*\(\s*s\s*\)\s+and\s+control/i.test(context || '')) {
    return { name: 'Selected Population', type: 'domain_concept' };
  }
  if (/\\overline\{z\}_\{?s,t\}?$/i.test(compact) && /\bselected\s*\(\s*s\s*\)/i.test(context || '')) {
    return { name: 'Selected Population Mean Trait Value', type: 'quantity_concept' };
  }
  if (/\\overline\{z\}_\{?c,t\}?$/i.test(compact) && /\bcontrol\s*\(\s*c\s*\)/i.test(context || '')) {
    return { name: 'Control Population Mean Trait Value', type: 'quantity_concept' };
  }
  if (/\\widehat\{\\overline\{\\alpha\}\}(?:_\{?[A-Za-z]+\}?)?$/.test(compact) && isMkTestContext(context)) {
    return { name: 'Estimated Fraction of Adaptive Substitutions', type: 'quantity_concept' };
  }
  if (/^\\widehat\{\\alpha\}$/.test(compact) && isMkTestContext(context)) {
    return { name: 'Estimated Fraction of Adaptive Replacement Substitutions', type: 'quantity_concept' };
  }
  for (const rule of SUBSCRIPT_SYMBOL_NAMES) {
    if (rule.pattern.test(compact)) return rule;
  }
  return null;
}

function primaryFormulaSymbol(symbol) {
  const clean = normalizeSpaces(String(symbol || '').replace(/&/g, ''));
  if (!clean) return '';
  if (/\([^)]*(?:\\mid\b|\\midx\b|=)/.test(clean)) {
    return clean.split('(')[0]?.trim() || clean;
  }
  const withoutCondition = clean.split(/\\mid\b/)[0]?.trim();
  const withoutCompactCondition = withoutCondition.split(/\\midx\b/)[0]?.trim();
  return withoutCompactCondition || withoutCondition || clean;
}

function uniqueFormulaSymbols(symbols) {
  const unique = [];
  const seen = new Set();
  for (const symbol of symbols || []) {
    const normalized = primaryFormulaSymbol(symbol);
    const key = symbolKey(normalized);
    if (!normalized || isIgnoredSymbol(normalized) || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }
  return unique;
}

const SYMBOL_WRAPPER_COMMAND_NAMES = new Set([
  'bar',
  'boldsymbol',
  'bm',
  'mathbf',
  'mathbb',
  'mathcal',
  'mathit',
  'mathsf',
  'mathrm',
  'overline',
  'hat',
  'widehat',
  'tilde',
  'widetilde',
  'vec',
]);

function isIgnoredSymbol(symbol) {
  const compact = String(symbol || '').replace(/\s+/g, '');
  const commandName = compact.replace(/^\\/, '').replace(/\{.*$/u, '');
  if (SYMBOL_WRAPPER_COMMAND_NAMES.has(commandName) && /^\\[A-Za-z]+\{.+\}/u.test(compact)) {
    if (/^\\?mathrm\{?[A-Za-z]\}?$/i.test(compact)) return true;
    return false;
  }
  if (IGNORED_SYMBOLS.has(compact) || LATEX_COMMAND_SYMBOLS.has(commandName)) return true;
  if (/^\\?mathrm\{?[A-Za-z]\}?$/i.test(compact)) return true;
  return false;
}

function nearbyPromptMap(chapterId) {
  return readFile(resolve(PROMPT_DIR, `${chapterId}.jsonl`), 'utf8')
    .then((text) => {
      const map = new Map();
      text.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        try {
          const record = JSON.parse(line);
          if (record.formula_id) map.set(record.formula_id, record);
        } catch {
          // Keep generation resilient; malformed prompt rows simply don't enrich concepts.
        }
      });
      return map;
    })
    .catch(() => new Map());
}

function formulaReferencesInBlock(content) {
  const references = new Set();
  const text = String(content || '');
  for (const match of text.matchAll(/\[\[SEE_FORMULA:([^\]]+)\]\]/g)) {
    if (match[1]) references.add(normalizeSpaces(match[1]));
  }
  return [...references];
}

async function structuredBlocksForChapter(chapterId) {
  return readdir(STRUCTURED_DIR)
    .then(async (files) => {
      const chapterFiles = files
        .filter((file) => file.startsWith(`${chapterId}_`) && file.endsWith('.json'))
        .sort();
      const blocks = [];
      for (const file of chapterFiles) {
        try {
          const doc = JSON.parse(await readFile(resolve(STRUCTURED_DIR, file), 'utf8'));
          const metadata = doc.metadata || {};
          (doc.blocks || []).forEach((block, index) => {
            if (!STRUCTURED_BLOCK_PRIORITY.has(block.type)) return;
            const content = normalizeSpaces(block.content);
            if (!content) return;
            const blockFormulaReferences = formulaReferencesInBlock(content);
            blocks.push({
              chunk_id: doc.id || file.replace(/\.json$/i, ''),
              block_index: index,
              block_type: block.type,
              content,
              clean_content: stripLatex(content).toLowerCase(),
              block_formula_references: blockFormulaReferences,
              formula_references: metadata.formula_references || [],
              section: metadata.section_level_1 || metadata.section || '',
              subsection: metadata.section_level_2 || metadata.display_heading || '',
              priority: STRUCTURED_BLOCK_PRIORITY.get(block.type) || 1,
            });
          });
        } catch {
          // Structured extraction can be partial; skip malformed chunks without blocking the whole book.
        }
      }
      return blocks;
    })
    .catch(() => []);
}

function blockMatchesFormula(block, formula) {
  const number = formulaNumber(formula);
  if (!number) return false;
  if (block.block_formula_references?.length) return block.block_formula_references.includes(number);
  if ((block.formula_references || []).length === 1) return block.formula_references.includes(number);
  return block.block_type === 'definition' && (block.formula_references || []).includes(number);
}

function symbolSearchTerms(symbol, conceptName) {
  const terms = new Set();
  [symbol, baseSymbol(symbol), readableSymbol(symbol), conceptName].forEach((value) => {
    const clean = stripLatex(value).toLowerCase();
    if (clean && clean.length > 1) terms.add(clean);
  });
  return [...terms];
}

function textContainsTerm(text, term) {
  if (!term) return false;
  const escaped = escapeRegExp(term);
  if (/^[a-z0-9]+$/i.test(term)) {
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(term);
}

function bestStructuredEvidence(formula, symbol, conceptName, structuredBlocks) {
  const formulaBlocks = structuredBlocks.filter((block) => blockMatchesFormula(block, formula));
  if (!formulaBlocks.length) return null;
  const terms = symbolSearchTerms(symbol, conceptName);
  let best = null;
  for (const block of formulaBlocks) {
    const sentences = splitSentences(block.content);
    const fallbackSentence = sentences.find(usefulDefinitionSentence) || sentences[0] || '';
    const hit = sentences.find((sentence) => {
      const clean = stripLatex(sentence).toLowerCase();
      return terms.some((term) => textContainsTerm(clean, term));
    });
    if (!hit && block.block_type !== 'definition') continue;
    const sentence = hit || fallbackSentence;
    if (!sentence || !usefulDefinitionSentence(sentence)) continue;
    const score = block.priority
      + (hit ? 2 : 0)
      + (block.formula_references?.includes(formulaNumber(formula)) ? 1.5 : 0)
      + (block.block_type === 'definition' ? 1 : 0);
    if (!best || score > best.score) {
      best = {
        score,
        sentence,
        evidence: {
          chunk_id: block.chunk_id,
          block_index: block.block_index,
          block_type: block.block_type,
        },
      };
    }
  }
  return best;
}

function sentenceWindow(text, symbol) {
  const clean = stripLatex(text);
  if (!clean) return '';
  const base = baseSymbol(symbol);
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const hit = sentences.find((sentence) => sentence.includes(base) || sentence.toLowerCase().includes(readableSymbol(symbol).toLowerCase()));
  return cleanDefinition(hit || sentences.find((sentence) => usefulDefinitionSentence(sentence)) || sentences[0] || clean, '').slice(0, 260);
}

function phraseBeforeFormula(text, symbol) {
  const clean = stripLatex(text);
  const base = escapeRegExp(baseSymbol(symbol));
  const patterns = [
    new RegExp(`(?:the|called|denote|denotes|defined as|is the|is called)\\s+([A-Za-z][A-Za-z\\s,'-]{3,64})\\s+(?:${base}|is|as|by|equals)`, 'i'),
    new RegExp(`([A-Za-z][A-Za-z\\s,'-]{3,64})\\s+(?:is|are)\\s+(?:defined|given|computed|calculated)`, 'i'),
    new RegExp(`([A-Za-z][A-Za-z\\s,'-]{3,64})\\s+is\\s+\\$?`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      const phrase = normalizeSpaces(match[1].replace(/\b(the|this|that|where|and|or)$/i, ''));
      if (
        phrase.split(' ').length <= 5
        && !BAD_CONCEPT_PHRASE.test(phrase)
        && !BAD_CONCEPT_NAME.test(phrase)
        && !/^(a|an|the|if|for|when|while|thus|similarly|likewise|hence)\b/i.test(phrase)
      ) return titleCase(phrase);
    }
  }
  return '';
}

function inferConceptName(symbol, formula, promptRecord, role) {
  const context = formulaContext(formula, promptRecord);
  const specific = symbolSpecificConcept(symbol, context);
  if (specific) return specific.name;

  const base = baseSymbol(symbol);
  const compactSymbol = normalizeSpaces(symbol || '').replace(/\s+/g, '');
  const compactLatex = normalizeSpaces(formula?.latex || '').replace(/\s+/g, '');
  if (/^(?:p|\\mathsf\{?p\}?)$/i.test(compactSymbol)
    && /p\(/.test(compactLatex)
    && /\b(?:bayes|likelihood|prior|posterior|density|distribution|gaussian|normal|gamma|exponential)\b/i.test(context)) {
    return 'Probability Density';
  }
  if (/^\\?sigma\^\{?2\}?$/i.test(compactSymbol)
    && /\b(?:unknown variance|known variance|variance parameter|posterior|prior|gaussian|normal)\b/i.test(context)) {
    return 'Variance Parameter';
  }
  if (COMMON_SYMBOL_NAMES.has(symbol)) return COMMON_SYMBOL_NAMES.get(symbol);
  if (COMMON_SYMBOL_NAMES.has(base)) {
    const name = COMMON_SYMBOL_NAMES.get(base);
    if (/\\overline|\\bar/.test(symbol)) return `Mean ${name}`;
    if (/\\Delta/.test(symbol)) return `Change in ${name}`;
    if (/prime/.test(symbol) || /\\prime/.test(symbol)) return `Updated ${name}`;
    return name;
  }
  if (GREEK_NAMES.has(base)) return GREEK_NAMES.get(base);
  if (OPERATOR_SYMBOLS.has(symbol) || OPERATOR_SYMBOLS.has(base)) return COMMON_SYMBOL_NAMES.get(base) || readableSymbol(symbol);
  const phrase = role === 'defined' ? phraseBeforeFormula(context, symbol) : '';
  if (phrase && !/^Let$/i.test(phrase) && !BAD_CONCEPT_NAME.test(phrase)) return phrase;
  return readableSymbol(symbol);
}

function conceptTypeFor(symbol, role, context = '') {
  const specific = symbolSpecificConcept(symbol, context);
  if (specific?.type) return specific.type;
  const base = baseSymbol(symbol);
  if (OPERATOR_SYMBOLS.has(symbol) || OPERATOR_SYMBOLS.has(base)) return 'operator_or_function';
  if (['Cov', 'Var', 'E', 'Pr'].includes(base)) return 'math_concept';
  if (role === 'defined') return 'quantity_concept';
  if (['w', 'W', 'z', 'p', 'q'].includes(base)) return 'quantity_concept';
  return 'domain_concept';
}

function confidenceFor(symbol, formula, promptRecord, role, structuredEvidence) {
  let score = role === 'defined' ? 0.82 : 0.68;
  const context = formulaContext(formula, promptRecord);
  if (symbolSpecificConcept(symbol, context)) score += 0.08;
  if (usefulDefinitionSentence(sentenceWindow(context, symbol))) score += 0.08;
  if (structuredEvidence) score += 0.04;
  if (COMMON_SYMBOL_NAMES.has(symbol) || COMMON_SYMBOL_NAMES.has(baseSymbol(symbol))) score += 0.05;
  if (role === 'defined' && formula.symbols_defined?.includes(symbol)) score += 0.05;
  return Math.min(0.95, Number(score.toFixed(2)));
}

const GENERATOR_FALLBACK_DEFINITION_MARKERS = [
  'is the operation or transformation rule used by the equation.',
  'describes how much probability weight the model assigns to an event, state, or continuous value.',
  'is a population-level proportion used to track how a state changes over time.',
  'measures genetic diversity through the chance that two sampled alleles differ.',
  'describes spread or joint movement among variables.',
  'summarizes individual values into a comparable population-level center.',
  'locates the process on a time or scale axis.',
  'identifies a term, category, or state position in the equation.',
  'is a coefficient or parameter attached to a term in this equation; interpret it from the surrounding biological context before comparing magnitudes.',
  'is a mathematical structure used to organize, transform, or compare quantities.',
  'names the biological object or model condition being used in this formula.',
  'is the main quantity to read from this equation; the right-hand side shows which terms determine it.',
  'is a supporting quantity in this equation; read how it combines with the main term.',
  '表示本式中的运算或转换规则',
  '表示事件、状态或连续变量取值的可能性',
  '表示群体中某类等位基因或状态所占的比例',
  '衡量遗传多样性；数值越高',
  '描述变量之间的离散程度或共同变化',
  '表示一组取值的中心水平',
  '给出过程发生的时间或尺度位置',
  '用来区分求和项、类别或状态位置',
  '是调节关系强弱或方向的参数',
  '是本式借用的数学结构',
  '表示本式讨论的生物学对象或模型条件',
  '是这条公式要读出的核心量',
  '是本式中的辅助量',
];

const HIGH_RISK_GENERIC_CONCEPT_NAMES = new Set([
  'expectation',
  'probability',
  'probability density',
  'variance',
  'vector or matrix quantity',
  'response',
  'frequency',
  'information',
  'mean time',
  'time',
  'fitness width',
]);

const PUBLIC_PLACEHOLDER_CONCEPT_NAMES = new Set([
  'defined quantity',
  'vector or matrix quantity',
  'variable',
  'value',
  'quantity',
  'parameter',
  'coefficient',
  'probability',
  'expectation',
  'mean',
  'variance',
  'time',
  'function',
  'response',
]);

const PUBLIC_GLOBAL_CANONICAL_CONCEPT_NAMES = new Set([
  'selection response',
]);

const KNOWN_CONCEPT_CORRECTIONS = new Map([
  ['chapter2::formula_2.42::defined::F_{ST}', {
    concept_name: 'Fixation Index',
    concept_type: 'quantity_concept',
    definition: 'A standardized measure of population differentiation among subpopulations, expressed as the among-population allele-frequency variance relative to total expected heterozygosity.',
    definition_zh: '衡量亚群体间等位基因频率分化程度的标准化指标，用群体间频率方差相对于总体期望杂合度来表示。',
    aliases: ['F_{ST}', 'FST', 'Fixation Index', 'Wright Fixation Index'],
    confidence: 0.96,
    review_status: 'approved',
    review_flags: [],
    review_notes: 'Rule calibration: F_ST is Wright’s fixation index, not a parsed phrase from metapopulation text.',
  }],
  ['appendix4::formula_A4.17::defined::\\widehat{\\pi}_{0}', {
    concept_name: 'True Null Proportion',
    concept_type: 'quantity_concept',
    definition: 'The estimated proportion of true null hypotheses among all tested hypotheses.',
    definition_zh: '在全部被检验假设中，真实零假设所占比例的估计值。',
    aliases: ['\\widehat{\\pi}_{0}', 'pi0', 'true null proportion'],
    confidence: 0.9,
    review_flags: [],
    review_notes: 'Rule calibration: avoid a generic fraction phrase and name the multiple-testing quantity directly.',
  }],
  ['chapter16::formula_16.23a::defined::d', {
    concept_name: 'Assortative-Mating Disequilibrium Recursion State',
    concept_type: 'quantity_concept',
    definition: 'The recursively updated disequilibrium quantity d(t) generated by assortative mating, initialized at d(0)=0 in the worked iteration.',
    aliases: ['d(t)', 'd(0)', 'Assortative-Mating Disequilibrium Recursion State'],
    confidence: 0.88,
    review_status: 'edited',
    review_flags: ['llm_validated'],
    review_notes: 'Rule calibration: Formula 16.23a uses d(t) as the recurrence state for assortative-mating disequilibrium, not a generic initial condition.',
  }],
  ['chapter8::formula_8.1d::defined::f_{s}', {
    concept_name: 'Hitchhiking Event Strength',
    concept_type: 'quantity_concept',
    definition: 'The fraction of the initial excess association at the linked neutral marker that persists when the selected allele fixes.',
    aliases: ['f_{s}', 'f_s', 'Hitchhiking Event Strength', 'Sweep Strength'],
    confidence: 0.95,
    review_status: 'edited',
    review_flags: ['llm_validated'],
    review_notes: 'Rule calibration: Formula 8.1d explicitly defines f_s as the critical measure of hitchhiking-event strength.',
  }],
  ['chapter8::formula_8.3g::defined::f_{s}', {
    concept_name: 'Hitchhiking Event Strength',
    concept_type: 'quantity_concept',
    definition: 'The approximation to hitchhiking-event strength for a new favorable mutation starting at frequency 1/(2N).',
    aliases: ['f_{s}', 'f_s', 'Hitchhiking Event Strength', 'Sweep Strength'],
    confidence: 0.95,
    review_status: 'edited',
    review_flags: ['llm_validated'],
    review_notes: 'Rule calibration: Formula 8.3g is a later approximation for the same f_s hitchhiking-event strength defined in Formula 8.1d.',
  }],
  ['chapter8::formula_8.7d::used::\\mathbb{E}', {
    concept_name: 'Expectation Operator',
    concept_type: 'operator_or_function',
    definition: 'The expectation operator applied to the squared linked-marker frequency change when deriving remaining heterozygosity after a sweep.',
    aliases: ['\\mathbb{E}', 'E', 'Expectation Operator'],
    confidence: 0.9,
    review_status: 'edited',
    review_flags: ['llm_validated'],
    review_notes: 'Rule calibration: Formula 8.7d uses blackboard-bold E as an expectation operator, not a raw symbol fragment.',
  }],
]);

function definitionLooksFallback(...definitions) {
  const text = definitions.map((value) => normalizeSpaces(value)).filter(Boolean).join('\n');
  return GENERATOR_FALLBACK_DEFINITION_MARKERS.some((marker) => text.includes(marker));
}

function publicReviewStatus(status = 'unreviewed', flags = []) {
  if (status === 'reviewed') return 'approved';
  if (status === 'ambiguous' || status === 'needs_revision') return 'flagged';
  if ((flags || []).some((flag) => (
    flag === 'template_definition'
    || flag === 'formula_or_symbol_artifact'
    || flag === 'generic_defined_concept_name'
    || flag === 'low_confidence'
  ))) return 'flagged';
  return REVIEW_STATUSES.includes(status) ? status : 'unreviewed';
}

function mergeReviewStatus(existingStatus = 'unreviewed', incomingStatus = 'unreviewed') {
  const priorities = new Map([
    ['unreviewed', 0],
    ['approved', 1],
    ['reviewed', 1],
    ['edited', 2],
    ['flagged', 3],
    ['ambiguous', 3],
    ['needs_revision', 3],
    ['rejected', 4],
  ]);
  const existing = REVIEW_STATUSES.includes(existingStatus) ? existingStatus : 'unreviewed';
  const incoming = REVIEW_STATUSES.includes(incomingStatus) ? incomingStatus : 'unreviewed';
  return (priorities.get(incoming) || 0) > (priorities.get(existing) || 0) ? incoming : existing;
}

function conceptQualityFlags({ name, role, symbol, definition, definitionZh, structuredEvidence, confidence }) {
  const flags = new Set();
  const cleanName = normalizeSpaces(name);
  const normalizedName = normalizeSpaces(name).toLowerCase();
  if (confidence < 0.72) flags.add('low_confidence');
  if (!structuredEvidence) flags.add('weak_evidence');
  if (role === 'defined' && HIGH_RISK_GENERIC_CONCEPT_NAMES.has(normalizedName)) flags.add('generic_defined_concept_name');
  if (/[,;:]$/u.test(cleanName)) flags.add('formula_or_symbol_artifact');
  if (greekParameterConceptName(cleanName, symbol)) flags.add('generic_defined_concept_name');
  if (role === 'defined' && /^(?:event probability|probability)$/i.test(cleanName)) flags.add('generic_defined_concept_name');
  if (definitionLooksFallback(definition, definitionZh)) flags.add('template_definition');
  if (isFormulaArtifactConcept({ name, concept_name: name, symbol, defined_symbol: symbol })) flags.add('formula_or_symbol_artifact');
  if (/^(?:i|j|k|l|t)$/.test(normalizeSpaces(symbol)) && role === 'defined') flags.add('index_like_defined_symbol');
  return [...flags];
}

function applyKnownConceptCorrection(concept) {
  const correction = KNOWN_CONCEPT_CORRECTIONS.get(symbolConceptStableKey(concept));
  if (!correction) return concept;
  return {
    ...concept,
    ...correction,
    aliases: Array.from(new Set([...(concept.aliases || []), ...(correction.aliases || [])])).filter(Boolean),
  };
}

function conceptId(chapterId, formulaId, symbol, role) {
  return `concept_${chapterId}_${slug(formulaId)}_${role}_${slug(symbol)}`;
}

function withUniqueConceptId(concept, idCounts, takenIds) {
  const baseId = concept.concept_id;
  let nextCount = idCounts.get(baseId) || 0;
  let candidate = baseId;
  do {
    nextCount += 1;
    candidate = nextCount === 1 ? baseId : `${baseId}_${nextCount}`;
  } while (takenIds.has(candidate));
  idCounts.set(baseId, nextCount);
  takenIds.add(candidate);
  if (candidate === baseId) return concept;
  return {
    ...concept,
    concept_id: candidate,
  };
}

function evidenceFor(formula, promptRecord, structuredEvidence, sourceSentence = '') {
  const teachingMove = conceptTeachingMoveFromContext(formulaContext(formula, promptRecord));
  const fallback = {
    chunk_id: promptRecord?.formula_id || formula.id,
    block_index: formula.position ?? 0,
    block_type: formula.context_text ? 'derivation' : 'formula',
    sentence: teachingMove?.source_sentence || sourceSentence,
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
  };
  if (!structuredEvidence?.evidence) return [fallback];
  const key = `${structuredEvidence.evidence.chunk_id}:${structuredEvidence.evidence.block_index}:${structuredEvidence.evidence.block_type}`;
  const fallbackKey = `${fallback.chunk_id}:${fallback.block_index}:${fallback.block_type}`;
  const structured = {
    ...structuredEvidence.evidence,
    sentence: structuredEvidence.sentence,
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
  };
  return key === fallbackKey ? [fallback] : [structured, fallback];
}

function makeSymbolConcept(chapterId, formula, symbol, role, promptRecord, structuredBlocks) {
  const context = formulaContext(formula, promptRecord);
  const name = inferConceptName(symbol, formula, promptRecord, role);
  const structuredEvidence = bestStructuredEvidence(formula, symbol, name, structuredBlocks);
  const definitionSource = structuredEvidence?.sentence || sentenceWindow(context, symbol);
  const teachingMove = conceptTeachingMoveFromContext(context);
  const sourceSentence = structuredEvidence?.sentence || teachingMove?.source_sentence || definitionSource;
  const stableDefinition = CONCEPT_DEFINITIONS.get(name.toLowerCase());
  const conceptType = conceptTypeFor(symbol, role, context);
  const fallback = stableDefinition || conceptDefinitionEn(name, role, conceptType);
  const definition = cleanDefinition(stableDefinition ? '' : usefulDefinitionSentence(definitionSource) ? definitionSource : '', fallback);
  const confidence = confidenceFor(symbol, formula, promptRecord, role, structuredEvidence);
  const definitionZh = conceptDefinitionZh(name, role, conceptType);
  const reviewFlags = conceptQualityFlags({
    name,
    role,
    symbol,
    definition,
    definitionZh,
    structuredEvidence,
    confidence,
  });
  return applyKnownConceptCorrection({
    chapter_id: chapterId,
    formula_id: formula.id,
    formula_label: formula.label,
    formula_latex: formula.latex,
    formula_section: formula.section,
    formula_subsection: formula.subsection,
    symbol,
    role,
    concept_id: conceptId(chapterId, formula.id, symbol, role),
    concept_name: name,
    concept_type: conceptType,
    definition,
    definition_zh: definitionZh,
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
    source_sentence: sourceSentence,
    aliases: Array.from(new Set([symbol, readableSymbol(symbol), name])).filter(Boolean),
    evidence: evidenceFor(formula, promptRecord, structuredEvidence, sourceSentence),
    confidence,
    review_status: 'unreviewed',
    review_flags: reviewFlags,
    extraction_model: 'deterministic_formula_structured_context_v2',
  });
}

function symbolConceptStableKey(concept) {
  return [
    concept.chapter_id || '',
    concept.formula_id || '',
    concept.role || '',
    concept.symbol || '',
  ].join('::');
}

function symbolConceptNormalizedStableKey(concept) {
  return [
    concept.chapter_id || '',
    concept.formula_id || '',
    concept.role || '',
    symbolKey(concept.symbol || ''),
  ].join('::');
}

function hasReviewWork(generated, reviewed) {
  return reviewPreservedFields(reviewed).length > 0;
}

function reviewPreservedFields(reviewed) {
  const status = reviewed.review_status || 'unreviewed';
  if (status && status !== 'unreviewed') return REVIEW_PRESERVED_FIELDS;
  if (reviewed.reviewed_by || reviewed.reviewed_at || reviewed.review_notes) return REVIEW_PRESERVED_FIELDS;
  if (reviewed.canonical_concept_id || reviewed.canonical_concept_name) {
    return ['canonical_concept_id', 'canonical_concept_name'];
  }
  return [];
}

function mergeReviewedSymbolConcepts(generatedConcepts, reviewedPayload) {
  if (!reviewedPayload?.symbol_concepts?.length) return generatedConcepts;
  const byStableKey = new Map();
  const byNormalizedStableKey = new Map();
  const byConceptId = new Map();
  for (const concept of reviewedPayload.symbol_concepts) {
    byStableKey.set(symbolConceptStableKey(concept), concept);
    byNormalizedStableKey.set(symbolConceptNormalizedStableKey(concept), concept);
    if (concept.concept_id) byConceptId.set(concept.concept_id, concept);
  }
  return generatedConcepts.map((generated) => {
    const reviewed = byStableKey.get(symbolConceptStableKey(generated))
      || byNormalizedStableKey.get(symbolConceptNormalizedStableKey(generated))
      || byConceptId.get(generated.concept_id);
    if (!reviewed || !hasReviewWork(generated, reviewed)) return generated;
    const preserved = {};
    for (const field of reviewPreservedFields(reviewed)) {
      if (reviewed[field] !== undefined) preserved[field] = reviewed[field];
    }
    if (preserved.canonical_concept_id !== undefined) {
      preserved.canonical_concept_id = cleanPublicConceptId(preserved.canonical_concept_id);
    }
    if (preserved.canonical_concept_name !== undefined) {
      preserved.canonical_concept_name = cleanPublicConceptText(preserved.canonical_concept_name);
    }
    return {
      ...generated,
      ...preserved,
      review_status: REVIEW_STATUSES.includes(preserved.review_status) ? preserved.review_status : generated.review_status,
      review_flags: preserved.review_flags !== undefined ? preserved.review_flags : generated.review_flags,
    };
  });
}

function applyConceptCalibrations(symbolConcepts) {
  return symbolConcepts.map((concept) => {
    const curated = CONCEPT_CALIBRATIONS.get(symbolConceptStableKey(concept));
    if (!curated) return applyKnownConceptCorrection(concept);
    const canonicalUpdates = curated.concept_name && concept.canonical_concept_name
      ? {
        canonical_concept_id: curated.canonical_concept_id || `canonical_${cleanPublicConceptId(concept.concept_id || symbolConceptStableKey(concept))}`,
        canonical_concept_name: curated.canonical_concept_name || curated.concept_name,
      }
      : {};
    return applyKnownConceptCorrection({
      ...concept,
      ...curated,
      ...canonicalUpdates,
    });
  });
}

function splitSenseId(senseId) {
  const index = String(senseId || '').indexOf('::');
  if (index < 0) return null;
  return {
    formula_id: senseId.slice(0, index),
    symbol: senseId.slice(index + 2),
  };
}

function senseConceptKey(formulaId, symbol) {
  return `${formulaId}::${symbolKey(symbol)}`;
}

function conceptHasCanonicalMetadata(concept) {
  return Boolean(concept?.canonical_concept_id || concept?.canonical_concept_name);
}

function sameSubsectionCluster(cluster, formulaById) {
  const clusterSubsection = normalizeSpaces(cluster.subsection || '').toLowerCase();
  if (!clusterSubsection) return false;
  return (cluster.member_formula_ids || []).every((formulaId) => (
    normalizeSpaces(formulaById.get(formulaId)?.subsection || '').toLowerCase() === clusterSubsection
  ));
}

function isSafeClusterCanonicalSymbol(symbol) {
  const clean = normalizeSpaces(symbol);
  if (!clean) return false;
  if (/^[A-Za-z]$/.test(clean)) return SAFE_SINGLE_LETTER_CANONICAL_SYMBOLS.has(clean);
  return true;
}

function autoCanonicalConceptId(cluster) {
  return `canonical_${slug(cluster.canonical_sense_id || [
    cluster.chapter_id,
    cluster.subsection,
    cluster.canonical_symbol || cluster.symbol,
  ].join('::'))}`;
}

function reviewedConceptScore(concept) {
  const status = concept.review_status || 'unreviewed';
  const statusScore = status === 'approved' ? 4 : status === 'edited' ? 3 : status === 'unreviewed' ? 1 : 0;
  const flagPenalty = Array.isArray(concept.review_flags) ? concept.review_flags.length * 0.03 : 0;
  return statusScore + (Number.isFinite(concept.confidence) ? concept.confidence : 0) - flagPenalty;
}

function representativeConceptForCluster(concepts, cluster) {
  const representativeKey = splitSenseId(cluster.representative_sense_id || '');
  const representative = representativeKey
    ? concepts.find((concept) => (
        concept.formula_id === representativeKey.formula_id
        && symbolKey(concept.symbol) === symbolKey(representativeKey.symbol)
      ))
    : null;
  if (representative) return representative;
  return concepts.slice().sort((left, right) => (
    reviewedConceptScore(right) - reviewedConceptScore(left)
    || String(left.formula_id || '').localeCompare(String(right.formula_id || ''), undefined, { numeric: true, sensitivity: 'base' })
    || String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
  ))[0];
}

function canonicalMetadataForCluster(concepts, cluster) {
  const existing = concepts
    .filter(conceptHasCanonicalMetadata)
    .map((concept) => ({
      id: cleanPublicConceptId(concept.canonical_concept_id),
      name: cleanPublicConceptText(concept.canonical_concept_name || concept.concept_name),
    }))
    .filter((item) => item.id || item.name);
  const existingKeys = new Set(existing.map((item) => `${item.id}::${item.name.toLowerCase()}`));
  if (existingKeys.size > 1) return null;
  if (existing.length) {
    return {
      canonical_concept_id: existing[0].id || autoCanonicalConceptId(cluster),
      canonical_concept_name: existing[0].name,
    };
  }
  const representative = representativeConceptForCluster(concepts, cluster);
  if (!representative) return null;
  return {
    canonical_concept_id: autoCanonicalConceptId(cluster),
    canonical_concept_name: representative.concept_name,
  };
}

function applySymbolSenseClusterCanonicalConcepts(symbolConcepts, chapterDoc) {
  const clusters = chapterDoc.symbol_sense_clusters || [];
  if (!clusters.length) return symbolConcepts;
  const chapterId = chapterDoc.chapter_id;
  const formulaById = new Map((chapterDoc.formulas || []).map((formula) => [formula.id, formula]));
  const definedConceptsBySense = new Map();

  for (const concept of symbolConcepts) {
    if (concept.role !== 'defined') continue;
    if ((concept.review_status || 'unreviewed') === 'rejected') continue;
    definedConceptsBySense.set(senseConceptKey(concept.formula_id, concept.symbol), concept);
  }

  const updatesByStableKey = new Map();
  for (const cluster of clusters) {
    if (cluster.chapter_id !== chapterId) continue;
    if (cluster.merge_basis !== 'same_chapter_subsection_canonical_symbol') continue;
    if ((cluster.member_sense_ids || []).length < 2) continue;
    if (!isSafeClusterCanonicalSymbol(cluster.canonical_symbol || cluster.symbol)) continue;
    if (!sameSubsectionCluster(cluster, formulaById)) continue;

    const concepts = [];
    const seenConceptIds = new Set();
    for (const senseId of cluster.member_sense_ids || []) {
      const sense = splitSenseId(senseId);
      if (!sense) continue;
      const concept = definedConceptsBySense.get(senseConceptKey(sense.formula_id, sense.symbol));
      if (!concept || seenConceptIds.has(concept.concept_id)) continue;
      concepts.push(concept);
      seenConceptIds.add(concept.concept_id);
    }
    if (concepts.length < 2) continue;

    const canonical = canonicalMetadataForCluster(concepts, cluster);
    if (!canonical?.canonical_concept_id || !canonical?.canonical_concept_name) continue;

    for (const concept of concepts) {
      updatesByStableKey.set(symbolConceptStableKey(concept), {
        ...(conceptHasCanonicalMetadata(concept) ? {} : {
          canonical_concept_id: canonical.canonical_concept_id,
          canonical_concept_name: canonical.canonical_concept_name,
        }),
        canonical_sense_id: cluster.canonical_sense_id,
        canonical_merge_basis: cluster.merge_basis,
      });
    }
  }

  if (!updatesByStableKey.size) return symbolConcepts;
  return symbolConcepts.map((concept) => {
    const update = updatesByStableKey.get(symbolConceptStableKey(concept));
    return update ? { ...concept, ...update } : concept;
  });
}

function missingCalibratedConceptEntries(symbolConcepts, chapterDoc, promptMap, structuredBlocks) {
  const chapterId = chapterDoc.chapter_id;
  const formulasById = new Map((chapterDoc.formulas || []).map((formula) => [formula.id, formula]));
  const existingKeys = new Set(symbolConcepts.map(symbolConceptStableKey));
  const missing = [];

  for (const [stableKey] of CONCEPT_CALIBRATIONS) {
    const [calibrationChapterId, formulaId, role, symbol] = stableKey.split('::');
    if (calibrationChapterId !== chapterId || existingKeys.has(stableKey)) continue;
    const formula = formulasById.get(formulaId);
    if (!formula) continue;
    const concept = makeSymbolConcept(chapterId, formula, symbol, role, promptMap.get(formulaId), structuredBlocks);
    missing.push(concept);
    existingKeys.add(symbolConceptStableKey(concept));
  }

  return missing;
}

function appendMissingCalibratedConcepts(symbolConcepts, chapterDoc, promptMap, structuredBlocks) {
  return [
    ...symbolConcepts,
    ...missingCalibratedConceptEntries(symbolConcepts, chapterDoc, promptMap, structuredBlocks),
  ];
}

function productConceptName(name, formulaLabel, symbol) {
  const cleanName = cleanPublicConceptText(name || '');
  const symbolName = naturalSymbolConceptName(symbol, cleanName);
  const withoutTrailingPunctuation = cleanName.replace(/[,\s;:]+$/u, '');
  if (withoutTrailingPunctuation && withoutTrailingPunctuation !== cleanName) {
    return productConceptName(withoutTrailingPunctuation, formulaLabel, symbol);
  }
  const greekParameter = greekParameterConceptName(cleanName, symbol);
  if (greekParameter) return greekParameter;
  if (/^power of additive matrix$/i.test(cleanName)) return 'Additive Matrix Exponentiation';
  if (/^(?:time|mean time)$/i.test(cleanName) && /^\\(?:bar|overline)(?:\{t\}|t)(?:_\{?[LF]\}?)?$/i.test(normalizeSpaces(symbol || '').replace(/\s+/g, ''))) {
    return 'Time to Fixation';
  }
  if (!cleanName) return symbolName || 'Model Quantity';
  const withoutFormulaPrefix = cleanName.replace(/^Formula\s+\S+\s+/i, '');
  if (withoutFormulaPrefix && withoutFormulaPrefix !== cleanName) {
    return productConceptName(withoutFormulaPrefix, '', symbol);
  }
  if (/^formula\s+.+\s+result$/i.test(cleanName)) return symbolName || 'Formula Relation';
  if (BAD_CONCEPT_NAME.test(cleanName) || BAD_CONCEPT_PHRASE.test(cleanName)) return symbolName || 'Model Quantity';
  if (/[,]{2}|^whose\b|^which\b|^that\b|^this\b|^these\b|^those\b/i.test(cleanName)) return symbolName || 'Model Quantity';
  if (isMechanicalReadableName(cleanName)) return symbolName || 'Model Quantity';
  if (isGenericSymbolConceptName(cleanName)) {
    if (symbolName) return symbolName;
    return 'Model Quantity';
  }
  if (symbolName && PRODUCT_GENERIC_CONCEPT_NAMES.has(normalizeSpaces(symbolName).toLowerCase())) return cleanName;
  if (symbolName && shouldPreferNaturalSymbolName(symbol, cleanName, symbolName)) return symbolName;
  return cleanName;
}

function greekParameterConceptName(name, symbol) {
  const cleanName = normalizeSpaces(name || '');
  if (!/^(?:Alpha|Beta|Gamma|Delta|Epsilon|Theta|Lambda|Mu|Phi|Omega)$/i.test(cleanName)) return '';
  const compactSymbol = normalizeSpaces(symbol || '').replace(/\s+/g, '');
  const greek = compactSymbol.match(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|phi|omega)(?=[_}^]|$)/i)?.[1]
    || baseSymbol(symbol).toLowerCase();
  const normalizedGreek = greek.toLowerCase() === 'varepsilon' ? 'epsilon' : greek.toLowerCase();
  if (normalizedGreek !== cleanName.toLowerCase()) return '';
  const prefix = /\\(?:widehat|hat)/i.test(compactSymbol) ? 'Estimated ' : '';
  return `${prefix}${titleCase(cleanName)} Parameter`;
}

function shouldPreferNaturalSymbolName(symbol, cleanName, symbolName) {
  const normalizedName = normalizeSpaces(cleanName).toLowerCase();
  const normalizedSymbolName = normalizeSpaces(symbolName).toLowerCase();
  const compactSymbol = normalizeSpaces(symbol || '').replace(/\s+/g, '');
  const genericButRecoverable = new Set([
    'alpha',
    'expectation',
    'lambda',
    'probability',
    'response',
    'time',
    'variance',
    'vector or matrix quantity',
  ]);
  if (!normalizedName || normalizedName === normalizedSymbolName) return false;
  if (BAD_CONCEPT_NAME.test(cleanName) || BAD_CONCEPT_PHRASE.test(cleanName)) return true;
  if (/[,]{2}|^whose\b|^which\b|^that\b|^this\b|^these\b|^those\b/i.test(cleanName)) return true;
  if (/\b(?:surprising result|changes that occur|fraction of accounted for|selection- and drift-dominated domains|breeding value,|hamilton's rule how general)\b/i.test(cleanName)) return true;
  if (/^(?:mutation|mutational increment|differential|sigma_g|d\(0\)|iance)$/i.test(cleanName)) return true;
  if (isSpecificReviewedConceptName(cleanName)) return false;
  if (/\\(?:Delta|widetilde|tilde)|^\\?Deltap/i.test(compactSymbol)) return true;
  if (/^h_\{?m\}?\^\{?2\}?$/i.test(compactSymbol)) return true;
  if (/^R(?:_\{?[^{}]+\}?)?$/i.test(compactSymbol) && normalizedName === 'response') return true;
  if ((/^\\(?:widehat|hat)?\{?\\?sigma/i.test(compactSymbol) || /^\\?(?:mathrm)?\{?Var\}?/i.test(compactSymbol) || /^\\?widehat\{?V\}?_/i.test(compactSymbol) || /^V_\{?[^{}]+\}?$/i.test(compactSymbol))
    && normalizedName === 'variance'
    && normalizedSymbolName !== 'variance') return true;
  if (/^(?:E|\\mathbb\{?E\}?|\\mathrm\{?E\}?)$/i.test(compactSymbol) && normalizedName === 'expectation') return true;
  if (/^(?:\\mathrm\{?Pr\}?|\\Pr|Pr)$/i.test(compactSymbol) && normalizedName === 'probability') return true;
  if (/^p_\{?.+\}?$/i.test(compactSymbol) && normalizedName === 'probability') return true;
  if (/^R_\{?y\}?$/i.test(compactSymbol) && /\bresponse\b/i.test(cleanName)) return true;
  if (genericButRecoverable.has(normalizedName)
    && normalizedSymbolName
    && !PRODUCT_GENERIC_CONCEPT_NAMES.has(normalizedSymbolName)
    && !genericButRecoverable.has(normalizedSymbolName)) return true;
  if (/^f_\{?s\}?$/i.test(compactSymbol) && normalizedSymbolName !== 'frequency') return true;
  if (CONCEPT_DEFINITIONS.has(normalizedSymbolName) && !CONCEPT_DEFINITIONS.has(normalizedName)) return true;
  return false;
}

function isSpecificReviewedConceptName(name = '') {
  const clean = normalizeSpaces(name);
  const lower = clean.toLowerCase();
  if (!clean || PRODUCT_GENERIC_CONCEPT_NAMES.has(lower) || PUBLIC_PLACEHOLDER_CONCEPT_NAMES.has(lower)) return false;
  if (isMechanicalReadableName(clean)) return false;
  const words = clean.match(/[A-Za-z][A-Za-z-]*/g) || [];
  if (words.length < 2) return false;
  return /\b(?:allele|breeding|class|fitness|frequency|heritability|offspring|parent|preselection|regression|residual|response|selection|trait|variance)\b/i.test(clean);
}

function readableSymbolConceptName(symbol) {
  const cleanSymbol = normalizeSpaces(symbol || '');
  const base = baseSymbol(cleanSymbol);
  const readable = readableSymbol(cleanSymbol);
  if (!readable || RAW_SYMBOL_CONCEPT_NAME.test(readable)) return '';
  if (isMechanicalReadableName(readable)) return '';
  if (/^[A-Za-z]$/.test(base)) return '';
  return readable;
}

function publicPlaceholderConceptName(value = {}) {
  const name = cleanPublicConceptText(value?.name || value?.concept_name || value?.title || '');
  const normalizedName = normalizeSpaces(name).toLowerCase();
  const symbol = normalizeSpaces(value?.defined_symbol || value?.symbol || '');
  const scopedName = scopedPublicConceptName(value, name, symbol);
  if (scopedName) return scopedName;
  const greekParameter = greekParameterConceptName(name, symbol);
  if (greekParameter) return greekParameter;
  if (!PUBLIC_PLACEHOLDER_CONCEPT_NAMES.has(normalizedName)) return name;
  const natural = naturalSymbolConceptName(symbol, name);
  if (natural && !PUBLIC_PLACEHOLDER_CONCEPT_NAMES.has(normalizeSpaces(natural).toLowerCase())) return natural;
  if (normalizedName === 'vector or matrix quantity') return 'Matrix or Vector Quantity';
  if (normalizedName === 'probability') return probabilityPlaceholderConceptName(value, symbol);
  if (normalizedName === 'expectation') return 'Expected Quantity';
  if (normalizedName === 'variance') return 'Variance Quantity';
  if (normalizedName === 'time') return 'Process Time';
  if (normalizedName === 'response') return 'Model Response';
  if (normalizedName === 'function') return 'Model Function';
  return 'Model Quantity';
}

function scopedPublicConceptName(value = {}, name = '', symbol = '') {
  const compactSymbol = normalizeSpaces(symbol || '').replace(/\s+/g, '');
  const normalizedName = normalizeSpaces(name).toLowerCase();
  const context = conceptContextForNaming(value);
  if (
    /^\\Delta\\mu_\{?A\}?$/i.test(compactSymbol)
    && /models without trait associative effects/i.test(context)
    && /\b(?:change|response|breeding value|trait value|fitness)\b/i.test(normalizedName)
  ) {
    return 'Change in Mean Trait Value';
  }
  if (
    /^R$/i.test(compactSymbol)
    && /robertson'?s theory of selection limits/i.test(context)
    && /\b(?:response|selection response|response to selection|cumulative response)\b/i.test(normalizedName)
  ) {
    return 'Selection Response';
  }
  if (
    /^d$/i.test(compactSymbol)
    && /henshaw'?s distributional selection differential|distributional selection differential \(dsd\)/i.test(context)
    && /\b(?:distributional selection differential|directional selection gradient|differential operator)\b/i.test(normalizedName)
  ) {
    return 'Distributional Selection Differential';
  }
  return '';
}

function canonicalMergePublicName(value = {}, canonicalMergeBasis = value?.canonical_merge_basis) {
  if (!canonicalMergeBasis) return '';
  const canonicalName = cleanPublicConceptText(value?.canonical_concept_name || '');
  if (!canonicalName) return '';
  const symbol = value?.defined_symbol || value?.symbol || value?.via_symbol || '';
  return productConceptName(canonicalName, value?.formula_label || value?.supporting_formula_label, symbol);
}

function conceptContextForNaming(value = {}) {
  return normalizeSpaces([
    value.definition,
    value.source_sentence,
    value.formula_section,
    value.formula_subsection,
    value.supporting_formula_latex,
    value.formula_latex,
  ].filter(Boolean).join(' '));
}

function probabilityPlaceholderConceptName(value = {}, symbol = '') {
  const compactSymbol = normalizeSpaces(symbol || '').replace(/\s+/g, '');
  const context = conceptContextForNaming(value);
  if (/^(?:\\Pr|Pr|\\mathrm\{?Pr\}?|P)$/i.test(compactSymbol)) return 'Probability Operator';
  if (/\b(?:likelihood|density|posterior|prior|Bayes|Gaussian|normal|gamma|exponential|distribution)\b/i.test(context)) {
    return 'Probability Density';
  }
  if (/^p_\{?i(?:'|\\prime)?\}?$/i.test(compactSymbol) || /\b(?:class|descendant|Price equation|fitness class|trait class)\b/i.test(context)) {
    return 'Class Frequency';
  }
  if (/^p(?:_\{?[^{}]+\}?|$)/i.test(compactSymbol)
    && /\b(?:allele|gene\s+frequency|allele-frequency|frequency change|segregation|selection)\b/i.test(context)) {
    return 'Allele Frequency';
  }
  if (/\b(?:transition|Wright-Fisher)\b/i.test(context)) return 'Transition Probability';
  return 'Model Probability';
}

function isMechanicalReadableName(name = '') {
  const clean = normalizeSpaces(name);
  if (!clean) return false;
  if (/\bSub\b\s+\S/i.test(clean)) return true;
  if (/\bPower\b\s+(?!of\b)[^\s]/i.test(clean)) return true;
  if (/(?:\b|^)(?:Widetilde|Widehat|Mathbf|Boldsymbol|Mathbb|Mathrm|Frac|Simeq|Nabla|Sigma[_a-z]*|Delta)[A-Za-z]*/i.test(clean)) return true;
  if (/^[A-Za-z]?\^?\d*$/.test(clean)) return true;
  if (/^Formula\s+\S+\s+Defined Quantity$/i.test(clean)) return true;
  return false;
}

function scriptRoleName(value = '') {
  const key = normalizeSpaces(value)
    .replace(/\\(?:overline|bar)\{([^{}]+)\}/g, '$1')
    .replace(/[{}\\]/g, '')
    .toLowerCase();
  const roles = new Map([
    ['a', 'Additive Genetic'],
    ['aa', 'Additive Genetic'],
    ['b', 'Block'],
    ['c', 'Cumulative'],
    ['d', 'Direct'],
    ['f', 'Fixation'],
    ['fix', 'Fixation'],
    ['fd', 'Fitness-Differential'],
    ['fs', 'Fixation-Selection'],
    ['g', 'Genetic'],
    ['gb', 'Genotype-by-Block'],
    ['gf', 'Genetic-Fitness'],
    ['gw', 'Genetic-Fitness'],
    ['z', 'Trait'],
    ['y', 'Trait'],
    ['w', 'Fitness'],
    ['wf', 'Wright-Fisher'],
    ['p', 'Allele-Frequency'],
    ['pt', 'Phenotypic'],
    ['q', 'Frequency'],
    ['m', 'Mutation'],
    ['e', 'Environmental'],
    ['s', 'Selection'],
    ['t', 'Time-Indexed'],
    ['0.5', 'Half-Life'],
    ['1/2', 'Half-Life'],
    ['i', 'Class'],
    ['j', 'Class'],
    ['ij', 'Pairwise'],
    ['li', 'Lineage'],
    ['st', 'Population-Differentiation'],
  ]);
  return roles.get(key) || (key.length === 1 ? 'Indexed' : titleCase(key.replace(/[_,-]+/g, ' ')));
}

function firstSubscript(symbol = '') {
  const text = String(symbol || '');
  return text.match(/_\{([^{}]+)\}/)?.[1] || text.match(/_([A-Za-z0-9]+)/)?.[1] || '';
}

function expectedQuantityConceptName(innerSymbol = '') {
  const compact = normalizeSpaces(innerSymbol).replace(/\s+/g, '');
  const known = SUBSCRIPT_SYMBOL_NAMES.find(({ pattern }) => pattern.test(compact));
  if (known?.name) return `Expected ${known.name}`;
  if (/^S/i.test(compact)) return 'Expected Segregating Sites';
  if (/^D/i.test(compact)) return 'Expected Divergence';
  if (/^P/i.test(compact)) return 'Expected Polymorphism';
  return 'Expected Quantity';
}

function naturalSymbolConceptName(symbol, fallbackName = '') {
  const cleanSymbol = normalizeSpaces(symbol || '');
  const compact = cleanSymbol.replace(/\s+/g, '');
  const base = baseSymbol(cleanSymbol);
  const subscript = firstSubscript(cleanSymbol);
  const role = scriptRoleName(subscript);
  const lowerFallback = normalizeSpaces(fallbackName).toLowerCase();
  const isTilde = /\\(?:widetilde|tilde)/.test(cleanSymbol);
  const isDelta = /\\Delta|^Delta\b/i.test(cleanSymbol);

  if (/^(?:E|\\mathbb\{?E\}?|\\mathrm\{?E\}?)$/i.test(compact)) return 'Expectation Operator';
  if (/^E(?:_\{?[^{}]+\}?|\^\{?[^{}]+\}?)$/i.test(compact)) return 'Expectation Operator';
  if (/^(?:\\mathrm\{?Var\}?|Var)$/i.test(compact)) return 'Variance Operator';
  if (/^(?:\\mathrm\{?Pr\}?|\\Pr|Pr)$/i.test(compact)) return 'Probability Operator';
  if (/^\\Pr_\{?[^{}]+\}?$/i.test(compact)) return subscript ? `${role} Probability` : 'Event Probability';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?x\}?(?:\^\{?T\}?)?$/i.test(compact)) return 'Data Vector';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?y\}?(?:\^\{?T\}?)?$/i.test(compact)) return 'Response Vector';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?z\}?(?:\^\{?T\}?)?$/i.test(compact)) return 'Trait Vector';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?a\}?(?:\^\{?T\}?)?$/i.test(compact)) return 'Additive Genetic Value Vector';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?(?:V|Var)\}?(?:\^\{?T\}?|(?:\^\{-1\}))?$/i.test(compact)) return /\^\{-1\}/.test(compact) ? 'Inverse Covariance Matrix' : 'Covariance Matrix';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?P\}?(?:\^\{?T\}?)?$/i.test(compact)) return 'Transition Matrix';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?A\}?(?:\^\{?T\}?|\^\{?k\}?)?$/i.test(compact)) return /\^\{?k\}?/i.test(compact) ? 'Additive Matrix Exponentiation' : 'Additive Relationship Matrix';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?G\}?(?:\^\{?T\}?|(?:\^\{-1\}))?$/i.test(compact)) return 'Genetic Covariance Matrix';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?R\}?(?:\^\{?T\}?|(?:\^\{-1\}))?$/i.test(compact)) return /\^\{-1\}/.test(compact) ? 'Inverse Relationship Matrix' : 'Relationship Matrix';
  if (/^\\(?:mathbf|boldsymbol|bm)\{?M\}?(?:\^\{?T\}?|_\{?[^{}]+\}?)?$/i.test(compact)) return 'Projection Matrix';
  if (/^\\(?:widehat|hat)\{?p\}?(?:_\{?[^{}]+\}?)?$/i.test(compact)) return 'Estimated Allele Frequency';
  if (/^p(?:\^\{?\\prime\\prime\}?|\^\{?\\prime\}?|''|')$/i.test(compact)) return 'Derived Allele Frequency';
  if (/^\\widehat\{E\}\[S/i.test(compact) || /^\\widehatE\[S/i.test(compact)) return 'Estimated Expected Segregating Sites';
  if (/^\\widehat\{E\}\[D/i.test(compact) || /^\\widehatE\[D/i.test(compact)) return 'Estimated Expected Divergence';
  if (/^\\widehat\{E\}\[.+\]$/i.test(compact) || /^\\widehatE\[.+\]$/i.test(compact)) return 'Estimated Expectation';
  {
    const expectedMatch = compact.match(/^E\[(.+)\]$/);
    if (expectedMatch) {
      if (/^x_\{?\[[^\]]+\]\}?$/i.test(expectedMatch[1])) return 'Expected Order Statistic';
      return expectedQuantityConceptName(expectedMatch[1]);
    }
  }
  if (/^\\ell(?:\(|$)/i.test(compact) || compact === '\\ell') return 'Likelihood Function';
  if (/^\\(?:widetilde|tilde)\{?\\sigma\}?_\{?A\}?\^\{?2\}?$/i.test(compact)
    || /^\\(?:widetilde|tilde)\{\\sigma\}_\{?A\}?\^\{?2\}?$/i.test(compact)) {
    return 'Equilibrium Additive Genetic Variance';
  }
  if (/^\\(?:widehat|hat)\{?\\sigma\^\{?2\}?\}?$/i.test(compact)) return 'Estimated Variance';
  if (/^\\(?:widetilde|tilde)\{?\\sigma\}?\^\{?2\}?$/i.test(compact)) return 'Equilibrium Variance';
  if (/\\sigma/.test(compact) && /\^\{?2\}?/.test(compact)) {
    if (/A/.test(subscript)) return `${isTilde ? 'Equilibrium ' : ''}Additive Genetic Variance`;
    if (/G/.test(subscript)) return 'Genetic Variance';
    if (/z/i.test(subscript)) return 'Trait Variance';
    if (/e/i.test(subscript)) return 'Environmental Variance';
    if (subscript) return `${role} Variance`;
    return 'Variance';
  }
  if (/^\\(?:widehat|hat)\{?V\}?_\{?([^{}]+)\}?$/i.test(compact) && subscript) return `Estimated ${role} Variance`;
  if (/^V_\{?([^{}]+)\}?$/i.test(compact) && subscript) return `${role} Variance`;
  if (/^h\^\{?2\}?$/i.test(compact) || /^\\widetilde\{?h\}?\^\{?2\}?$/i.test(compact)) return 'Narrow-Sense Heritability';
  if (/^R(?:_\{?([^{}]+)\}?)?$/i.test(compact)) return subscript ? `${role} Response` : 'Selection Response';
  if (/^S(?:_\{?([^{}]+)\}?)?$/i.test(compact)) return subscript ? `${role} Selection Differential` : 'Selection Differential';
  if (/^w_\{?i\}?$/i.test(compact)) return 'Class Fitness';
  if (/^W_\{?i\}?$/i.test(compact)) return 'Class Absolute Fitness';
  if (/^q_\{?i'?\\prime?\}?$|^q_\{?i\}?'$/i.test(compact)) return 'Class Frequency';
  if (/^z_\{?i\}?$/i.test(compact)) return 'Class Trait Value';
  if (/^p_\{?.+\}?$/i.test(compact)) return 'Allele Frequency';
  if (/^[Tt]_\{?([^{}]+)\}?$/i.test(compact)) return subscript ? `${role} Time` : 'Process Time';
  if (/^\\(?:bar|overline)\{?t\}?(?:_\{?([^{}]+)\}?)?$/i.test(compact)) return subscript ? `${role} Mean Time` : 'Mean Time';
  if (/^\\(?:widehat|hat)\{?\\alpha\}?|^\\alpha(?:_\{?[^{}]+\}?|\^\{?[^{}]+\}?)?$/i.test(compact)) return subscript ? `${role} Alpha Parameter` : 'Alpha Parameter';
  if (/^\\(?:widehat|hat)\{?\\lambda\}?|^\\lambda(?:_\{?[^{}]+\}?|\^\{?[^{}]+\}?)?$/i.test(compact)) return subscript ? `${role} Lambda Parameter` : 'Lambda Parameter';
  if (/^\\Delta\s*p|^\\Deltap|^\\Delta_\{?p/i.test(compact)) return 'Allele-Frequency Change';
  if (isDelta && /^\\?Deltap/i.test(compact)) return 'Allele-Frequency Change';
  if (isDelta && /sigma|\\sigma/i.test(compact) && /_\{?[Aa]\}?/.test(compact)) return 'Change in Additive Genetic Variance';
  if (isDelta && /mu|\\mu/i.test(compact)) return 'Change in Mean Trait Value';
  if (isDelta && /sigma|\\sigma/i.test(compact)) return 'Change in Variance';
  if (isDelta && subscript) return `${role} Change`;
  if (/^\\Theta(?:_\{?[^{}]+\}?)?$/i.test(compact)) return subscript ? `${role} Covariance Decomposition` : 'Covariance Decomposition';
  if (/^\\(?:bar|overline)\{\\imath\}(?:_.+)?$/i.test(compact)) return subscript ? `${role} Selection Intensity` : 'Selection Intensity';
  if (/^\\(?:bar|overline)\{?z\}?(?:_\{?([^{}]+)\}?)?$/i.test(compact)) return subscript ? `${role} Mean Trait Value` : 'Mean Trait Value';
  if (/^\\(?:bar|overline)\{?[Ww]\}?(?:_\{?([^{}]+)\}?)?$/i.test(compact)) return subscript ? `${role} Mean Fitness` : 'Mean Fitness';
  if (/^r_\{?m\}?$/i.test(compact)) return 'Mutation Rate';
  if (/^r_\{?e\}?$/i.test(compact)) return 'Environmental Correlation';
  if (COMMON_SYMBOL_NAMES.has(cleanSymbol)) return COMMON_SYMBOL_NAMES.get(cleanSymbol);
  if (COMMON_SYMBOL_NAMES.has(base)) {
    const baseName = COMMON_SYMBOL_NAMES.get(base);
    if (subscript && !CONCEPT_DEFINITIONS.has(baseName.toLowerCase())) return '';
    return baseName;
  }
  if (GREEK_NAMES.has(base)) {
    const greekName = GREEK_NAMES.get(base);
    return CONCEPT_DEFINITIONS.has(greekName.toLowerCase()) ? greekName : '';
  }
  if (lowerFallback && !isMechanicalReadableName(fallbackName) && !PRODUCT_GENERIC_CONCEPT_NAMES.has(lowerFallback)) return normalizeSpaces(fallbackName);
  return /^[A-Za-z]$/.test(base) ? '' : readableSymbolConceptName(cleanSymbol);
}

function isGenericSymbolConceptName(name) {
  const normalizedName = normalizeSpaces(name || '').toLowerCase();
  return PRODUCT_GENERIC_CONCEPT_NAMES.has(normalizedName)
    || RAW_SYMBOL_CONCEPT_NAME.test(name)
    || GENERIC_SYMBOL_CONCEPT_NAME.test(name)
    || SYMBOL_FRAGMENT_CONCEPT_NAME.test(name);
}

function conceptReferenceDisplayScore(reference, index) {
  const name = normalizeSpaces(reference.name || '').toLowerCase();
  let score = Number.isFinite(reference.confidence) ? reference.confidence : 0;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(name)) score -= 0.08;
  if (/^formula\s+.+\s+/.test(name)) score -= 0.06;
  if (/\bsub\b/.test(name)) score -= 0.04;
  if (reference.definition_zh) score += 0.03;
  return score - index * 0.0001;
}

const SAFE_GLOBAL_CANONICAL_CONCEPT_NAMES = new Set([
  'additive genetic value',
  'additive genetic variance',
  'event probability',
  'fitness',
  'matrix or vector quantity',
  'population size',
  'process time',
  'selection coefficient',
  'standard deviation',
  'time',
  'trait value',
  'variance',
  'variance quantity',
  'vector or matrix quantity',
]);

const CHAPTER_SCOPED_CANONICAL_CONCEPT_NAMES = new Set([
  ...SAFE_GLOBAL_CANONICAL_CONCEPT_NAMES,
  'absolute fitness',
  'allele frequency',
  'class fitness',
  'class frequency',
  'class selection coefficient',
  'class trait value',
  'covariance',
  'eigenvalue',
  'environmental variance',
  'change in additive genetic variance',
  'expected divergence',
  'expected order statistic',
  'expected polymorphism',
  'expected segregating sites',
  'fitness breeding value',
  'genetic variance',
  'heritability',
  'heterozygosity',
  'identity matrix',
  'likelihood',
  'mean fitness',
  'mean trait value',
  'multivariate normal density',
  'mutation rate',
  'narrow-sense heritability',
  'probability',
  'probability density',
  'response',
  'selection differential',
  'trait breeding value',
  'trait variance',
  'wright-fisher transition probability',
]);

function cleanPublicConceptText(value) {
  return normalizeSpaces(String(value || '').replace(/&/g, ''));
}

function cleanPublicConceptId(value) {
  return normalizeSpaces(String(value || '').replace(/&/g, ''));
}

function cleanPublicConceptFields(value) {
  if (!value) return value;
  const clean = { ...value };
  for (const field of [
    'name',
    'concept_name',
    'title',
    'symbol',
    'defined_symbol',
    'via_symbol',
    'canonical_concept_name',
    'definition',
    'definition_zh',
  ]) {
    if (clean[field] !== undefined) clean[field] = cleanPublicConceptText(clean[field]);
  }
  for (const field of ['concept_id', 'view_id', 'canonical_concept_id']) {
    if (clean[field] !== undefined) clean[field] = cleanPublicConceptId(clean[field]);
  }
  return clean;
}

function chapterScopedCanonicalConceptId(chapterId, name) {
  const cleanName = cleanPublicConceptText(name);
  if (!chapterId || !cleanName) return '';
  return `canonical_${slug(chapterId)}_${slug(cleanName)}`;
}

function canonicalIdForDisplayName(chapterId, name) {
  const cleanName = cleanPublicConceptText(name);
  if (!cleanName) return '';
  if (PUBLIC_GLOBAL_CANONICAL_CONCEPT_NAMES.has(cleanName.toLowerCase())) {
    return `canonical_${slug(cleanName)}`;
  }
  if (SAFE_GLOBAL_CANONICAL_CONCEPT_NAMES.has(cleanName.toLowerCase()) || CONCEPT_DEFINITIONS.has(cleanName.toLowerCase())) {
    return `canonical_${slug(cleanName)}`;
  }
  return chapterScopedCanonicalConceptId(chapterId, cleanName) || `canonical_${slug(cleanName)}`;
}

function shouldUseChapterScopedConceptId(value) {
  const name = cleanPublicConceptText(value?.canonical_concept_name || value?.name || value?.concept_name || value?.title || '');
  if (!name) return false;
  if (isFormulaArtifactConcept(value)) return false;
  if (isDependencyAnchorConceptId(value?.concept_id || '')) return false;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(name.toLowerCase())) return false;
  return CHAPTER_SCOPED_CANONICAL_CONCEPT_NAMES.has(name.toLowerCase());
}

function publicConceptIdForView(view) {
  return semanticPublicConceptId(view, view?.chapter_id) || cleanPublicConceptId(view?.concept_id || '');
}

function publicConceptIdForReference(reference, fallbackChapterId) {
  return semanticPublicConceptId(reference, fallbackChapterId) || cleanPublicConceptId(reference?.concept_id || '');
}

function semanticPublicConceptId(value, fallbackChapterId = '') {
  if (!value) return '';
  if (isFormulaArtifactConcept(value)) return '';
  const chapterId = value.chapter_id || fallbackChapterId || '';
  const displayName = cleanPublicConceptText(value?.canonical_concept_name || value?.name || value?.concept_name || value?.title || '');
  if (!displayName) return '';
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(displayName.toLowerCase())) return '';
  if (isGenericSymbolConceptName(displayName)) return '';
  return canonicalIdForDisplayName(chapterId, displayName);
}

function defaultCanonicalMetadata(value) {
  const displayName = cleanPublicConceptText(value?.name || value?.concept_name || value?.title || '');
  const rawCanonicalName = cleanPublicConceptText(value?.canonical_concept_name || '');
  const canonicalName = rawCanonicalName
    ? productConceptName(rawCanonicalName, value?.formula_label, value?.symbol || value?.defined_symbol)
    : '';
  const name = displayName || canonicalName;
  if (!name) return {};
  if (isFormulaArtifactConcept(value)) return {};
  if (!PRODUCT_GENERIC_CONCEPT_NAMES.has(name.toLowerCase()) && !isGenericSymbolConceptName(name)) {
    return {
      canonical_concept_id: canonicalIdForDisplayName(value?.chapter_id, name),
      canonical_concept_name: name,
    };
  }
  if (SAFE_GLOBAL_CANONICAL_CONCEPT_NAMES.has(displayName.toLowerCase())) {
    const rawCanonicalId = cleanPublicConceptId(value?.canonical_concept_id);
    if (displayName.toLowerCase() === 'time' && /time_to_fixation/i.test(rawCanonicalId)) {
      return {
        canonical_concept_id: rawCanonicalId,
        canonical_concept_name: canonicalName || displayName,
      };
    }
    return {
      canonical_concept_id: `canonical_${slug(displayName)}`,
      canonical_concept_name: displayName,
    };
  }
  if (value?.canonical_concept_id || canonicalName) {
    return {
      canonical_concept_id: cleanPublicConceptId(value?.canonical_concept_id) || `canonical_${slug(canonicalName || displayName)}`,
      canonical_concept_name: canonicalName || displayName,
    };
  }
  if (shouldUseChapterScopedConceptId({ ...value, name })) {
    return {
      canonical_concept_id: chapterScopedCanonicalConceptId(value?.chapter_id, name) || cleanPublicConceptId(value?.canonical_concept_id),
      canonical_concept_name: name,
    };
  }
  const nameKey = (canonicalName || displayName).toLowerCase();
  if (!CONCEPT_DEFINITIONS.has(nameKey)) return {};
  return {
    canonical_concept_id: `canonical_${slug(displayName)}`,
    canonical_concept_name: displayName,
  };
}

function sortConceptReferencesForDisplay(references) {
  return references
    .map((reference, index) => ({ reference, score: conceptReferenceDisplayScore(reference, index) }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.reference);
}

function dedupeConceptViewsById(views) {
  const byId = new Map();
  for (const view of views || []) {
    if (!view?.concept_id) continue;
    const existing = byId.get(view.concept_id);
    if (!existing) {
      byId.set(view.concept_id, view);
      continue;
    }
    byId.set(view.concept_id, {
      ...existing,
      prerequisite_concepts: dedupeConceptReferences([
        ...(existing.prerequisite_concepts || []),
        ...(view.prerequisite_concepts || []),
      ]),
      introduced_concepts: dedupeConceptReferences([
        ...(existing.introduced_concepts || []),
        ...(view.introduced_concepts || []),
      ]),
      confidence: Math.max(existing.confidence || 0, view.confidence || 0),
    });
  }
  return [...byId.values()];
}

function remapConceptReferenceIdentity(reference, chapterId) {
  if (!reference) return reference;
  const originalConceptId = cleanPublicConceptId(reference?.view_id || reference?.concept_id || '');
  const canonical = defaultCanonicalMetadata(reference);
  const mapped = {
    ...reference,
    view_id: originalConceptId,
    concept_id: originalConceptId,
    ...canonical,
  };
  if (Array.isArray(reference.prerequisite_concepts)) {
    mapped.prerequisite_concepts = reference.prerequisite_concepts.map((item) => remapConceptReferenceIdentity(item, chapterId));
  }
  if (Array.isArray(reference.introduced_concepts)) {
    mapped.introduced_concepts = reference.introduced_concepts.map((item) => remapConceptReferenceIdentity(item, chapterId));
  }
  return mapped;
}

function remapConceptEdgeIdentity(edge, idByOriginal) {
  if (!edge) return edge;
  return {
    ...edge,
    from: idByOriginal.get(edge.from) || edge.from,
    to: idByOriginal.get(edge.to) || edge.to,
  };
}

function applyPublicConceptIdentity(views) {
  const idByOriginal = new Map();
  const edgeIdByOriginal = new Map();
  for (const view of views || []) {
    const originalConceptId = cleanPublicConceptId(view.view_id || view.concept_id || '');
    idByOriginal.set(view.concept_id, originalConceptId);
    edgeIdByOriginal.set(view.concept_id, originalConceptId);
  }

  const remapped = (views || []).map((view) => {
    const originalConceptId = cleanPublicConceptId(view.view_id || view.concept_id || '');
    const conceptId = idByOriginal.get(view.concept_id) || view.concept_id;
    const canonical = defaultCanonicalMetadata(view);
    const next = {
      ...view,
      view_id: originalConceptId,
      concept_id: conceptId,
      ...canonical,
      prerequisite_concepts: (view.prerequisite_concepts || [])
        .map((reference) => remapConceptReferenceIdentity(reference, view.chapter_id)),
      introduced_concepts: (view.introduced_concepts || [])
        .map((reference) => remapConceptReferenceIdentity(reference, view.chapter_id)),
      edges: (view.edges || []).map((edge) => remapConceptEdgeIdentity(edge, edgeIdByOriginal)),
    };
    return {
      ...next,
      prerequisite_concepts: sanitizePrerequisiteReferences(next.prerequisite_concepts, next),
      introduced_concepts: sortConceptReferencesForDisplay(dedupeConceptReferences(
        filterProductConceptReferences(next.introduced_concepts)
          .filter((reference) => !isSameConceptReference(reference, next))
          .filter((reference) => !isSameConceptMeaning(reference, next)),
      )),
    };
  });

  return finalizeConceptViewStructure(remapped, []);
}

function canonicalAggregationKey(view) {
  const chapterId = cleanPublicConceptId(view?.chapter_id || '');
  const canonicalId = cleanPublicConceptId(view?.canonical_concept_id || '');
  const canonicalName = cleanPublicConceptText(view?.canonical_concept_name || view?.name || '');
  if (!chapterId || !canonicalId || !canonicalName) return '';
  if (isFormulaArtifactConcept(view)) return '';
  return `${chapterId}::${canonicalId}`;
}

function formulaReferenceFromView(view) {
  return {
    formula_id: view.defined_by_formula_id,
    formula_label: view.supporting_formula_label,
    formula_latex: view.supporting_formula_latex,
    formula_position: view.formula_position,
    formula_section: view.formula_section,
    formula_subsection: view.formula_subsection,
    symbol: view.defined_symbol,
    concept_id: view.concept_id,
    view_id: view.view_id || view.concept_id,
    source_sentence: view.source_sentence,
    review_status: view.review_status,
  };
}

function formulaReferencesFromView(view) {
  const references = [];
  if (view?.defined_by_formula_id) references.push(formulaReferenceFromView(view));
  for (const reference of view?.formula_references || []) {
    if (reference?.formula_id) references.push(reference);
  }
  const byKey = new Map();
  for (const reference of references) {
    const key = [
      reference.formula_id,
      symbolKey(reference.symbol || ''),
      cleanPublicConceptId(reference.view_id || reference.concept_id || ''),
    ].join('::');
    if (!byKey.has(key)) byKey.set(key, reference);
  }
  return [...byKey.values()];
}

function representedFormulaIdsForViews(views) {
  const ids = new Set();
  for (const view of views || []) {
    if (view?.defined_by_formula_id) ids.add(view.defined_by_formula_id);
    for (const reference of view?.formula_references || []) {
      if (reference?.formula_id) ids.add(reference.formula_id);
    }
  }
  return ids;
}

function coverageConceptNameForFormula(formula = {}) {
  const latex = String(formula.latex || '');
  if (/\\Pr\b|\\Pr\(|\bPr\(/.test(latex)) return 'Probability Relation';
  if (/\\(?:mathbb\{E\}|mathrm\{E\})\b|(^|[^A-Za-z])E\\left|(^|[^A-Za-z])E\[|expected/i.test(latex)) return 'Expected Value Relation';
  if (/\\(?:mathrm\{Var\}|operatorname\{Var\})|\\sigma\^\{?2\}?|variance/i.test(latex)) return 'Variance Relation';
  if (/\\sim|\\chi|\\mathrm\{N\}|\\mathbf\{t\}|Beta|Poisson|binomial/i.test(latex)) return 'Distribution Relation';
  if (/\\int|\\iint|\\iiint/.test(latex)) return 'Integral Identity';
  if (/\\sum|\\prod/.test(latex)) return 'Summation Identity';
  if (/\\begin\{(?:pmatrix|bmatrix|matrix|array)\}|\\mathbf|\\boldsymbol/.test(latex)) return 'Matrix Relation';
  if (/\\simeq|\\approx|\\leq|\\geq|<|>/.test(latex)) return 'Approximation Constraint';
  if (/\\frac|\/.+?=|=.+?\//.test(latex)) return 'Ratio Relation';
  return 'Mathematical Relation';
}

function coverageConceptTypeForName(name = '') {
  if (/probability|expected|variance|distribution/i.test(name)) return 'quantity_relation';
  if (/integral|summation|matrix|constraint/i.test(name)) return 'math_relation';
  return 'formula_relation';
}

function coverageSymbolForFormula(formula = {}) {
  const label = slug(String(formula.id || formula.label || 'formula').replace(/^formula_/, ''));
  const prefix = /probability/i.test(coverageConceptNameForFormula(formula)) ? 'P' : 'R';
  return `\\mathcal{${prefix}}_{${label}}`;
}

function coverageSourceSentence(formula = {}) {
  return cleanPublicConceptText(formula.context_text || formula.context || formula.section || formula.subsection || formula.label || '');
}

function coverageDefinition(name, formula = {}) {
  const section = cleanPublicConceptText(formula.subsection || formula.section || 'this chapter');
  return `${name} keeps ${formula.label || 'this formula'} connected to the ${section} derivation path by recording the relation, constraint, or transformation expressed by the displayed equation.`;
}

function coverageDefinitionZh(name, formula = {}) {
  const label = cleanPublicConceptText(formula.label || '当前公式');
  return `${label} 的这个关系节点把概率、约束或变换接入同一小节的概念路径，帮助读者沿着推导顺序理解它的作用。`;
}

function conceptViewForFormulaCoverage(formula, chapterId) {
  const name = coverageConceptNameForFormula(formula);
  const symbol = coverageSymbolForFormula(formula);
  const sourceSentence = coverageSourceSentence(formula);
  const conceptId = `concept_${slug(chapterId)}_${slug(formula.id)}_coverage`;
  return {
    chapter_id: chapterId,
    concept_id: conceptId,
    view_id: conceptId,
    name,
    definition: coverageDefinition(name, formula),
    definition_zh: coverageDefinitionZh(name, formula),
    source_sentence: sourceSentence,
    concept_type: coverageConceptTypeForName(name),
    defined_by_formula_id: formula.id,
    defined_symbol: symbol,
    supporting_formula_label: formula.label,
    supporting_formula_latex: formula.latex,
    formula_position: formula.position,
    formula_section: formula.section,
    formula_subsection: formula.subsection,
    evidence: [{
      chunk_id: `${formula.id}:coverage`,
      sentence: sourceSentence || `${formula.label || formula.id} belongs to the ${formula.subsection || formula.section || 'chapter'} derivation path.`,
      formula_id: formula.id,
      symbol,
      role: 'defined',
    }],
    confidence: 0.82,
    review_status: 'edited',
    review_flags: ['coverage_backfill'],
    canonical_concept_id: canonicalIdForDisplayName(chapterId, name),
    canonical_concept_name: name,
    prerequisite_concepts: [],
    introduced_concepts: [],
    edges: [],
  };
}

function addFormulaCoverageViews(views, conceptGraph) {
  const representedFormulaIds = representedFormulaIdsForViews(views);
  const additions = [];
  for (const formula of conceptGraph.formulas || []) {
    if (!formula?.id || representedFormulaIds.has(formula.id)) continue;
    additions.push(conceptViewForFormulaCoverage(formula, conceptGraph.chapter_id));
  }
  if (!additions.length) return views || [];
  return [...(views || []), ...additions].sort((left, right) => (
    viewSortValue(left) - viewSortValue(right)
      || String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
  ));
}

function viewIdentityKey(view) {
  return conceptEdgeEndpoint(view) || view?.concept_id || view?.view_id || '';
}

function hasDifferentFormula(left, right) {
  return Boolean(left?.defined_by_formula_id && right?.defined_by_formula_id && left.defined_by_formula_id !== right.defined_by_formula_id);
}

function findPriorContextAnchor(views, index) {
  const current = views[index];
  const currentSection = normalizeSpaces(current?.formula_subsection || current?.formula_section || '');
  const prior = views.slice(0, index).reverse();
  return prior.find((candidate) => hasDifferentFormula(candidate, current) && normalizeSpaces(candidate.formula_subsection || candidate.formula_section || '') === currentSection)
    || prior.find((candidate) => hasDifferentFormula(candidate, current));
}

function findNextContextDependent(views, index) {
  const current = views[index];
  const currentSection = normalizeSpaces(current?.formula_subsection || current?.formula_section || '');
  const next = views.slice(index + 1);
  return next.find((candidate) => hasDifferentFormula(candidate, current) && normalizeSpaces(candidate.formula_subsection || candidate.formula_section || '') === currentSection)
    || next.find((candidate) => hasDifferentFormula(candidate, current));
}

function existingSuccessorCounts(views) {
  const counts = new Map();
  for (const view of views || []) {
    for (const reference of view.prerequisite_concepts || []) {
      const key = conceptEdgeEndpoint(reference);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function addContextPrerequisite(view, anchor) {
  if (!view || !anchor || !hasDifferentFormula(view, anchor)) return view;
  const anchorKey = viewIdentityKey(anchor);
  if (!anchorKey) return view;
  if ((view.prerequisite_concepts || []).some((reference) => conceptEdgeEndpoint(reference) === anchorKey)) return view;
  const reference = conceptReferenceFromProductView(anchor, 'context_prerequisite', 0.74);
  const prerequisiteConcepts = sanitizePrerequisiteReferences([
    ...(view.prerequisite_concepts || []),
    reference,
  ], view);
  const contextEdge = {
    from: conceptEdgeEndpoint(reference),
    to: conceptEdgeEndpoint(view),
    relation: 'context_prerequisite',
    derived_from_formula_edge: {
      from: anchor.defined_by_formula_id,
      to: view.defined_by_formula_id,
      via_symbol: anchor.defined_symbol,
    },
    clickable: true,
    confidence: reference.confidence,
  };
  return {
    ...view,
    prerequisite_concepts: prerequisiteConcepts,
    edges: [...(view.edges || []), contextEdge],
  };
}

function addContextualLineagePrerequisites(views) {
  const sorted = (views || []).slice().sort((left, right) => (
    viewSortValue(left) - viewSortValue(right)
      || String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
  ));
  let output = sorted.map((view) => ({ ...view }));
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < output.length; index += 1) {
      const view = output[index];
      if ((view.prerequisite_concepts || []).length) continue;
      const prior = findPriorContextAnchor(output, index);
      if (prior) {
        output[index] = addContextPrerequisite(view, prior);
        continue;
      }
      const next = findNextContextDependent(output, index);
      if (next) {
        const nextIndex = output.findIndex((candidate) => viewIdentityKey(candidate) === viewIdentityKey(next));
        if (nextIndex >= 0) output[nextIndex] = addContextPrerequisite(output[nextIndex], view);
      }
    }
  }
  return output;
}

function remapAggregatedConceptReference(reference, idRemap, aggregateViewsById) {
  if (!reference) return reference;
  const aggregateId = idRemap.get(reference.view_id) || idRemap.get(reference.concept_id);
  const aggregateView = aggregateId ? aggregateViewsById.get(aggregateId) : null;
  const next = aggregateView
    ? {
        ...reference,
        concept_id: aggregateView.concept_id,
        view_id: aggregateView.view_id || aggregateView.concept_id,
        name: aggregateView.name,
        canonical_concept_id: aggregateView.canonical_concept_id,
        canonical_concept_name: aggregateView.canonical_concept_name,
        defined_by_formula_id: aggregateView.defined_by_formula_id,
        formula_label: aggregateView.supporting_formula_label,
        symbol: aggregateView.defined_symbol,
        definition: aggregateView.definition,
        definition_zh: aggregateView.definition_zh,
        review_status: aggregateView.review_status,
        review_flags: aggregateView.review_flags,
      }
    : { ...reference };
  if (Array.isArray(reference.prerequisite_concepts)) {
    next.prerequisite_concepts = reference.prerequisite_concepts.map((item) => remapAggregatedConceptReference(item, idRemap, aggregateViewsById));
  }
  if (Array.isArray(reference.introduced_concepts)) {
    next.introduced_concepts = reference.introduced_concepts.map((item) => remapAggregatedConceptReference(item, idRemap, aggregateViewsById));
  }
  if (Array.isArray(reference.successor_concepts)) {
    next.successor_concepts = reference.successor_concepts.map((item) => remapAggregatedConceptReference(item, idRemap, aggregateViewsById));
  }
  return next;
}

function remapAggregatedConceptEdge(edge, idRemap) {
  if (!edge) return edge;
  return {
    ...edge,
    from: idRemap.get(edge.from) || edge.from,
    to: idRemap.get(edge.to) || edge.to,
  };
}

function mergeCanonicalConceptViews(views) {
  const groups = new Map();
  for (const view of views || []) {
    const key = canonicalAggregationKey(view);
    if (!key) continue;
    const current = groups.get(key) || [];
    current.push(view);
    groups.set(key, current);
  }
  const aggregateGroups = [...groups.values()].filter((group) => group.length > 1);
  if (!aggregateGroups.length) return views;

  const aggregateByMemberId = new Map();
  const aggregateViewsById = new Map();
  const aggregateViews = [];
  for (const group of aggregateGroups) {
    const sorted = [...group].sort((left, right) => (
      viewSortValue(left) - viewSortValue(right)
        || String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
    ));
    const representative = sorted[0];
    const aggregateId = representative.canonical_concept_id || representative.concept_id;
    const aggregateView = {
      ...representative,
      concept_id: aggregateId,
      view_id: aggregateId,
      confidence: Math.max(...sorted.map((view) => Number(view.confidence || 0))),
      evidence: sorted.flatMap((view) => view.evidence || []).slice(0, 12),
      formula_references: sorted.flatMap(formulaReferencesFromView),
      review_status: sorted.reduce((status, view) => mergeReviewStatus(status, view.review_status), 'unreviewed'),
      review_flags: Array.from(new Set(sorted.flatMap((view) => view.review_flags || []))),
      prerequisite_concepts: [],
      introduced_concepts: [],
      edges: [],
    };
    aggregateViews.push({ aggregateView, members: sorted });
    aggregateViewsById.set(aggregateId, aggregateView);
    for (const member of sorted) {
      aggregateByMemberId.set(member.concept_id, aggregateId);
      if (member.view_id) aggregateByMemberId.set(member.view_id, aggregateId);
    }
  }

  const memberIds = new Set(aggregateByMemberId.keys());
  const remapView = (view) => {
    const aggregateId = aggregateByMemberId.get(view.concept_id) || aggregateByMemberId.get(view.view_id);
    const current = aggregateId ? aggregateViewsById.get(aggregateId) : view;
    const prerequisite_concepts = sanitizePrerequisiteReferences(
      (view.prerequisite_concepts || []).map((reference) => remapAggregatedConceptReference(reference, aggregateByMemberId, aggregateViewsById)),
      current,
    );
    const introduced_concepts = sortConceptReferencesForDisplay(dedupeConceptReferences(
      filterProductConceptReferences((view.introduced_concepts || [])
        .map((reference) => remapAggregatedConceptReference(reference, aggregateByMemberId, aggregateViewsById)))
        .filter((reference) => !isSameConceptReference(reference, current))
        .filter((reference) => !isSameConceptMeaning(reference, current)),
    ));
    return {
      ...view,
      prerequisite_concepts,
      introduced_concepts,
      edges: (view.edges || []).map((edge) => remapAggregatedConceptEdge(edge, aggregateByMemberId)),
    };
  };

  for (const item of aggregateViews) {
    const mergedPrerequisites = item.members.flatMap((view) => remapView(view).prerequisite_concepts || []);
    const mergedIntroduced = item.members.flatMap((view) => remapView(view).introduced_concepts || []);
    const prerequisite_concepts = sanitizePrerequisiteReferences(mergedPrerequisites, item.aggregateView);
    const introduced_concepts = sortConceptReferencesForDisplay(dedupeConceptReferences(
      filterProductConceptReferences(mergedIntroduced)
        .filter((reference) => !isSameConceptReference(reference, item.aggregateView))
        .filter((reference) => !isSameConceptMeaning(reference, item.aggregateView)),
    ));
    Object.assign(item.aggregateView, {
      prerequisite_concepts,
      introduced_concepts,
      edges: rebuildConceptViewEdges({
        ...item.aggregateView,
        prerequisite_concepts,
        introduced_concepts,
      }),
    });
  }

  return [
    ...(views || [])
      .filter((view) => !memberIds.has(view.concept_id) && !memberIds.has(view.view_id))
      .map(remapView),
    ...aggregateViews.map((item) => item.aggregateView),
  ].sort((left, right) => (
    viewSortValue(left) - viewSortValue(right)
      || String(left.concept_id || '').localeCompare(String(right.concept_id || ''), undefined, { numeric: true, sensitivity: 'base' })
  ));
}

const FORMULA_ARTIFACT_CONCEPT_NAME = /^formula\s+\S+\s+(?:relationship|result|concept)$/i;
const SYMBOL_FRAGMENT_CONCEPT_NAME = /(?:\b(?:simeq|frac|left|right|mathrm|simmathrm|simleft)\b)/i;
const RAW_SYMBOL_CONCEPT_NAME = /^(?:[A-Za-z]|[A-Za-z]_[A-Za-z0-9]+|[A-Za-z]\s+Sub\s+[A-Za-z0-9]+|[A-Za-z]\s+Power\s+[A-Za-z0-9]+)$/i;
const GENERIC_SYMBOL_CONCEPT_NAME = /^(?:pi constant|order term|nablaw-bar|d-hat)$/i;

function isSymbolOnlyConcept(value) {
  const name = normalizeSpaces(value?.name || value?.concept_name || value?.title || '');
  const symbol = normalizeSpaces(value?.defined_symbol || value?.symbol || '');
  const compactSymbol = symbol.replace(/\s+/g, '');
  if (!name) return false;
  if (/^updated\s+/i.test(name)) return true;
  if (RAW_SYMBOL_CONCEPT_NAME.test(name)) return true;
  if (SYMBOL_FRAGMENT_CONCEPT_NAME.test(name)) return true;
  if (GENERIC_SYMBOL_CONCEPT_NAME.test(name)) return true;
  if (/[=<>]|\\(?:left|right|simeq|approx|frac|sum|prod|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/\\(?:left|right|simeq|frac|sum|int)(?=[^A-Za-z]|$)/i.test(compactSymbol)) return true;
  if (/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|_[A-Za-z0-9]+)$/.test(compactSymbol) && /^(?:[A-Za-z]_|[A-Za-z]\s+Sub\b)/i.test(name)) return true;
  if (/^[A-Za-z](?:\^\{?(?:\\prime|')\}?|')/.test(compactSymbol) && /^updated\b/i.test(name)) return true;
  return false;
}

function isFormulaArtifactConcept(value) {
  const conceptId = normalizeSpaces(value?.concept_id || '').toLowerCase();
  const name = normalizeSpaces(value?.name || value?.concept_name || value?.title || '');
  const symbol = normalizeSpaces(value?.defined_symbol || value?.symbol || '');
  const type = normalizeSpaces(value?.concept_type || '').toLowerCase();
  return (
    conceptId.endsWith('_statement') ||
    type === 'formula_evidence_view' ||
    type === 'formula_symbol' ||
    isSymbolOnlyConcept(value) ||
    FORMULA_ARTIFACT_CONCEPT_NAME.test(name) ||
    (/^formula\s+\S+$/i.test(symbol) && /relationship|result/i.test(name))
  );
}

function filterProductConceptReferences(references) {
  return (references || []).filter((reference) => (
    !isFormulaArtifactConcept(reference)
    && !isFormulaReferenceDependency(reference)
    && isPublicReadyConceptReference(reference)
  ));
}

function filterPrerequisiteConceptReferences(references) {
  return (references || []).filter((reference) => {
    if (
      reference?.formula_dependency_anchor === true
      && reference?.concept_id
      && !isFormulaArtifactConcept(reference)
      && !isFormulaReferenceDependency(reference)
    ) {
      return true;
    }
    return (
      !isFormulaArtifactConcept(reference)
      && !isFormulaReferenceDependency(reference)
      && isPublicReadyConceptReference(reference)
    );
  });
}

function filterRealConceptReferences(references) {
  return (references || []).filter((reference) => (
    !isFormulaArtifactConcept(reference)
    && isPublicReadyConceptReference(reference)
  ));
}

function appendReviewNote(existing, note) {
  const current = normalizeSpaces(existing || '');
  const next = normalizeSpaces(note || '');
  if (!current) return next;
  if (!next || current.includes(next)) return current;
  return `${current} ${next}`;
}

function isProductGradeSymbolConcept(concept) {
  if (!concept) return false;
  if ((concept.review_status || 'unreviewed') === 'rejected') return false;
  if (isFormulaArtifactConcept(concept)) return false;
  return true;
}

function dependencyTargetFormulaIds(chapterDoc) {
  const targets = new Set();
  for (const dependency of chapterDoc.dependencies || []) {
    for (const prereq of acceptedFormulaPrerequisites(dependency)) {
      if (prereq.target_id) targets.add(prereq.target_id);
    }
  }
  return targets;
}

function dependencyDependentFormulaIds(chapterDoc) {
  const dependents = new Set();
  for (const dependency of chapterDoc.dependencies || []) {
    if (!dependency?.dependent_id) continue;
    if (acceptedFormulaPrerequisites(dependency).length) dependents.add(dependency.dependent_id);
  }
  return dependents;
}

function dependencyAnchorConceptScore(concept, index) {
  let score = Number.isFinite(concept.confidence) ? concept.confidence : 0;
  const name = normalizeSpaces(concept.concept_name || '').toLowerCase();
  const symbol = normalizeSpaces(concept.symbol || '');
  const flags = new Set(concept.review_flags || []);
  if ((concept.review_status || 'unreviewed') === 'approved') score += 0.1;
  if ((concept.review_status || 'unreviewed') === 'edited') score += 0.06;
  if (CONCEPT_DEFINITIONS.has(name)) score += 0.08;
  if (symbolSpecificConcept(symbol)) score += 0.06;
  if (COMMON_SYMBOL_NAMES.has(symbol) || COMMON_SYMBOL_NAMES.has(baseSymbol(symbol))) score += 0.04;
  if (flags.has('template_definition')) score -= 0.12;
  if (flags.has('formula_or_symbol_artifact')) score -= 0.2;
  if (flags.has('low_confidence')) score -= 0.08;
  if (/^(?:index|variable|count|coefficient|parameter|function)$/i.test(name)) score -= 0.08;
  if (/^(?:i|j|k|l|t)$/i.test(symbol)) score -= 0.1;
  return score - index * 0.0001;
}

function dependencyAnchorConceptForFormula(formulaId, symbolConceptsByFormula) {
  const concepts = (symbolConceptsByFormula.get(formulaId) || []).filter(isProductGradeSymbolConcept);
  if (!concepts.length) return null;
  return concepts
    .map((concept, index) => ({ concept, score: dependencyAnchorConceptScore(concept, index) }))
    .sort((left, right) => right.score - left.score)[0]?.concept || null;
}

function ensureDependencyAnchorConcept({
  chapterId,
  formulaId,
  reason,
  symbolConceptsByFormula,
  definedByFormula,
  symbolConceptByFormulaSymbolRole,
  registerConcept,
}) {
  if ((definedByFormula.get(formulaId) || []).some((concept) => isProductGradeSymbolConcept(concept))) return null;
  const anchor = dependencyAnchorConceptForFormula(formulaId, symbolConceptsByFormula);
  if (!anchor) return null;
  const anchorConcept = registerConcept({
    ...anchor,
    concept_id: `concept_${chapterId}_${slug(formulaId)}_dependency_anchor_${slug(anchor.symbol || anchor.concept_name || 'concept')}`,
    review_notes: appendReviewNote(anchor.review_notes, reason),
    review_flags: Array.from(new Set([...(anchor.review_flags || []), 'dependency_anchor'])),
    confidence: Math.max(Number(anchor.confidence || 0), 0.78),
  });
  const definedList = definedByFormula.get(formulaId) || [];
  definedList.push(anchorConcept);
  definedByFormula.set(formulaId, definedList);
  const formulaConcepts = symbolConceptsByFormula.get(formulaId) || [];
  formulaConcepts.push(anchorConcept);
  symbolConceptsByFormula.set(formulaId, formulaConcepts);
  symbolConceptByFormulaSymbolRole.set(`${formulaId}:${anchorConcept.symbol}:defined`, anchorConcept);
  return anchorConcept;
}

function conceptIdentityKey(value) {
  return normalizeSpaces(value?.name || value?.concept_name || value?.title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function viewPosition(view) {
  return Number.isFinite(view?.formula_position) ? Number(view.formula_position) : Number.MAX_SAFE_INTEGER;
}

function conceptReferenceFromView(view, relation = 'concept_prerequisite', confidence = 0.76) {
  return {
    concept_id: view.concept_id,
    view_id: view.view_id || view.concept_id,
    name: view.name,
    canonical_concept_id: view.canonical_concept_id,
    canonical_concept_name: view.canonical_concept_name,
    defined_by_formula_id: view.defined_by_formula_id,
    from_formula_id: view.defined_by_formula_id,
    formula_label: view.supporting_formula_label,
    symbol: view.defined_symbol,
    via_symbol: view.defined_symbol,
    clickable: true,
    confidence: Math.max(confidence, view.confidence || 0),
    relation,
    concept_type: view.concept_type,
    definition: view.definition,
    definition_zh: view.definition_zh,
    source_sentence: view.source_sentence,
    review_status: view.review_status,
    review_flags: view.review_flags,
  };
}

function buildConceptIdentityLookup(views) {
  const lookup = new Map();
  for (const view of views || []) {
    if (isFormulaArtifactConcept(view)) continue;
    const key = conceptIdentityKey(view);
    if (!key) continue;
    const current = lookup.get(key) || [];
    current.push(view);
    lookup.set(key, current);
  }
  for (const list of lookup.values()) {
    list.sort((left, right) => viewPosition(left) - viewPosition(right));
  }
  return lookup;
}

function inferPrerequisitesFromUsedConcepts(view, conceptLookup) {
  const currentPosition = viewPosition(view);
  const candidates = [];
  for (const reference of filterProductConceptReferences(view.introduced_concepts || [])) {
    const key = conceptIdentityKey(reference);
    if (!key || isSameConceptReference(reference, view)) continue;
    const matches = conceptLookup.get(key) || [];
    const prior = matches
      .filter((match) => match.concept_id !== view.concept_id && viewPosition(match) <= currentPosition)
      .sort((left, right) => viewPosition(right) - viewPosition(left))[0];
    if (!prior) continue;
    candidates.push(conceptReferenceFromView(
      prior,
      'concept_prerequisite',
      reference.confidence || prior.confidence || 0.76,
    ));
  }
  return candidates;
}

function addInferredConceptPrerequisites(views) {
  const lookup = buildConceptIdentityLookup(views);
  return (views || []).map((view) => {
    const inferred = inferPrerequisitesFromUsedConcepts(view, lookup);
    const prerequisite_concepts = sanitizePrerequisiteReferences([
      ...(view.prerequisite_concepts || []),
      ...inferred,
    ], view);
    const prerequisiteEdges = prerequisite_concepts.map((concept) => ({
      from: conceptEdgeEndpoint(concept),
      to: conceptEdgeEndpoint(view),
      relation: concept.relation || 'prerequisite_for',
      derived_from_formula_edge: {
        from: concept.from_formula_id || concept.defined_by_formula_id,
        to: view.defined_by_formula_id,
        via_symbol: concept.via_symbol,
      },
      clickable: true,
      confidence: concept.confidence,
    }));
    const introducedEdges = (view.edges || []).filter((edge) => edge.relation === 'introduced_for');
    return {
      ...view,
      prerequisite_concepts,
      edges: [...prerequisiteEdges, ...introducedEdges],
    };
  });
}

const REVIEWED_USED_CONCEPT_VIEW_NAMES = new Set([
  'additive matrix exponentiation',
  'preselection offspring-on-parent regression',
]);

function shouldExposeReviewedUsedConcept(concept) {
  if (!concept || concept.role !== 'used') return false;
  const publicName = productConceptName(concept.concept_name, concept.formula_label, concept.symbol);
  if (!REVIEWED_USED_CONCEPT_VIEW_NAMES.has(normalizeSpaces(publicName).toLowerCase())) return false;
  const status = concept.review_status || 'unreviewed';
  if (!['approved', 'edited', 'reviewed'].includes(status)) return false;
  const flags = new Set(concept.review_flags || []);
  if (flags.has('formula_or_symbol_artifact') || flags.has('template_definition') || flags.has('low_confidence')) return false;
  const name = publicName;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(normalizeSpaces(name).toLowerCase())) return false;
  const candidate = { ...concept, name, concept_name: name, defined_symbol: concept.symbol };
  if (isFormulaArtifactConcept(candidate)) return false;
  const definition = productDefinition(concept.definition, concept.source_sentence, firstEvidenceSentence(concept.evidence));
  return Boolean(definition && !isTemplateDefinitionText(definition));
}

function conceptViewFromUsedSymbolConcept(chapterId, formula, concept) {
  const name = productConceptName(concept.concept_name, formula.label, concept.symbol);
  return {
    chapter_id: chapterId,
    concept_id: cleanPublicConceptId(concept.concept_id),
    name,
    definition: concept.definition,
    definition_zh: concept.definition_zh,
    teaching_move: concept.teaching_move,
    teaching_move_zh: concept.teaching_move_zh,
    source_sentence: concept.source_sentence,
    concept_type: concept.concept_type,
    defined_by_formula_id: formula.id,
    defined_symbol: concept.symbol,
    supporting_formula_label: formula.label,
    supporting_formula_latex: formula.latex,
    formula_position: formula.position,
    formula_section: formula.section,
    formula_subsection: formula.subsection,
    evidence: concept.evidence,
    confidence: concept.confidence,
    review_status: concept.review_status,
    review_flags: concept.review_flags,
    ...defaultCanonicalMetadata({ ...concept, name, concept_name: name, defined_symbol: concept.symbol }),
    prerequisite_concepts: [],
    introduced_concepts: [],
    edges: [],
  };
}

function addReviewedUsedConceptViews(views, conceptGraph, symbolConcepts) {
  const formulaById = new Map((conceptGraph.formulas || []).map((formula) => [formula.id, formula]));
  const existingIds = new Set((views || []).map((view) => view.concept_id));
  const additions = [];
  for (const concept of symbolConcepts || []) {
    if (!shouldExposeReviewedUsedConcept(concept)) continue;
    if (existingIds.has(concept.concept_id)) continue;
    const formula = formulaById.get(concept.formula_id);
    if (!formula) continue;
    const view = conceptViewFromUsedSymbolConcept(conceptGraph.chapter_id, formula, concept);
    if (!isPublicReadyConceptView(view)) continue;
    additions.push(view);
    existingIds.add(view.concept_id);
  }
  return additions.length ? dedupeConceptViewsById([...(views || []), ...additions]) : views;
}

function reviewStatusCounts(symbolConcepts) {
  return symbolConcepts.reduce((counts, concept) => {
    const status = REVIEW_STATUSES.includes(concept.review_status) ? concept.review_status : 'unreviewed';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function semanticConceptIdForSymbolConcept(concept) {
  const canonicalId = cleanPublicConceptId(concept?.canonical_concept_id || '');
  if (canonicalId) return canonicalId;
  const publicName = productConceptName(concept?.concept_name, concept?.formula_label, concept?.symbol);
  const cleanName = cleanPublicConceptText(publicName);
  const candidate = { ...concept, name: cleanName, defined_symbol: concept?.symbol };
  if (
    cleanName
    && !PRODUCT_GENERIC_CONCEPT_NAMES.has(cleanName.toLowerCase())
    && !isGenericSymbolConceptName(cleanName)
    && !isFormulaArtifactConcept(candidate)
  ) {
    return canonicalIdForDisplayName(concept?.chapter_id, cleanName);
  }
  const symbol = symbolKey(concept?.symbol || '');
  if (symbol) return `semantic_${slug(concept?.chapter_id || 'chapter')}_${slug(concept?.role || 'symbol')}_${slug(symbol)}`;
  return cleanPublicConceptId(concept?.concept_id || symbolConceptStableKey(concept || {}));
}

function withSemanticConceptIdentity(concept) {
  const semanticConceptId = semanticConceptIdForSymbolConcept(concept);
  return {
    ...concept,
    semantic_concept_id: semanticConceptId,
  };
}

function symbolConceptMapSummary(chapterId, symbolConcepts) {
  const status_counts = reviewStatusCounts(symbolConcepts);
  const reviewed_entries = symbolConcepts.filter((item) => (item.review_status || 'unreviewed') !== 'unreviewed').length;
  return {
    chapter_id: chapterId,
    symbol_concept_entries: symbolConcepts.length,
    unique_concepts: new Set(symbolConcepts.map((item) => item.semantic_concept_id || semanticConceptIdForSymbolConcept(item))).size,
    occurrence_concepts: new Set(symbolConcepts.map((item) => item.concept_id)).size,
    canonical_concepts: new Set(symbolConcepts.map((item) => item.canonical_concept_id).filter(Boolean)).size,
    low_confidence_entries: symbolConcepts.filter((item) => item.confidence < 0.72).length,
    reviewed_entries,
    unreviewed_entries: symbolConcepts.length - reviewed_entries,
    status_counts,
  };
}

function buildSymbolConceptMapPayload(chapterId, symbolConcepts, source, generatedAt) {
  const semanticSymbolConcepts = symbolConcepts.map(withSemanticConceptIdentity);
  return {
    chapter_id: chapterId,
    version: 1,
    generated_at: generatedAt,
    source: {
      ...source,
      method: 'reviewable symbol-concept map seeded from formula dependencies, formula-symbol maps, and structured block evidence',
    },
    summary: symbolConceptMapSummary(chapterId, semanticSymbolConcepts),
    symbol_concepts: semanticSymbolConcepts,
  };
}

function conceptDedupKey(concept) {
  const name = normalizeSpaces(concept.name || concept.concept_name || '').toLowerCase();
  const symbol = baseSymbol(concept.symbol || concept.via_symbol || '').toLowerCase();
  const formulaId = normalizeSpaces(concept.defined_by_formula_id || concept.from_formula_id || '');
  const viewId = normalizeSpaces(concept.view_id || '');
  return `${name}:${symbol}:${formulaId}:${viewId}`;
}

function conceptDisplayDedupKey(concept) {
  const name = normalizeSpaces(concept?.canonical_concept_name || concept?.name || concept?.concept_name || '').toLowerCase();
  const canonical = normalizeSpaces(concept?.canonical_concept_id || '');
  const family = baseSymbol(concept?.symbol || concept?.via_symbol || concept?.defined_symbol || '').toLowerCase();
  return canonical || `${name}:${family}`;
}

function isFormulaReferenceText(value) {
  return /^(?:equation|formula)\s+[A-Za-z]?\d+(?:\.\d+)?[a-z]?$/i.test(normalizeSpaces(value));
}

function isFormulaReferenceDependency(reference) {
  return normalizeSpaces(reference?.relation || '') === 'explicit_reference'
    || isFormulaReferenceText(reference?.via_symbol)
    || isFormulaReferenceText(reference?.derived_from_formula_edge?.via_symbol);
}

function conceptMeaningKey(value) {
  const name = normalizeSpaces(value?.name || value?.concept_name || value?.title || '').toLowerCase();
  const symbol = baseSymbol(value?.defined_symbol || value?.symbol || value?.via_symbol || '').toLowerCase();
  return `${name}:${symbol}`;
}

function conceptNameKey(value) {
  return normalizeSpaces(value?.name || value?.concept_name || value?.title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isSameConceptMeaning(left, right) {
  const leftKey = conceptMeaningKey(left);
  const rightKey = conceptMeaningKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function sanitizePrerequisiteReferences(references, currentView) {
  return sortConceptReferencesForDisplay(dedupeConceptReferencesByDisplay(dedupeConceptReferences(
    filterPrerequisiteConceptReferences(references)
      .filter((reference) => !isSameConceptReference(reference, currentView)),
  ))).filter((reference) => !isSameFormulaDifferentSymbolPrerequisite(reference, currentView));
}

function isSameConceptReference(reference, currentView) {
  if (!reference || !currentView) return false;
  const referenceViewId = normalizeSpaces(reference.view_id || '');
  const currentViewId = normalizeSpaces(currentView.view_id || '');
  if (referenceViewId && currentViewId) return referenceViewId === currentViewId;
  const referenceFormulaId = normalizeSpaces(reference.defined_by_formula_id || reference.from_formula_id || '');
  const currentFormulaId = normalizeSpaces(currentView.defined_by_formula_id || '');
  if (reference.concept_id && currentView.concept_id && reference.concept_id === currentView.concept_id) {
    return Boolean(referenceFormulaId && currentFormulaId && referenceFormulaId === currentFormulaId);
  }
  if (referenceFormulaId && currentFormulaId && referenceFormulaId !== currentFormulaId) return false;
  return isSameConceptMeaning(reference, currentView);
}

function isSameFormulaDifferentSymbolPrerequisite(reference, currentView) {
  const referenceFormulaId = normalizeSpaces(reference?.defined_by_formula_id || reference?.from_formula_id || '');
  const currentFormulaId = normalizeSpaces(currentView?.defined_by_formula_id || '');
  if (!referenceFormulaId || !currentFormulaId || referenceFormulaId !== currentFormulaId) return false;
  const referenceSymbol = symbolKey(reference?.symbol || reference?.via_symbol || '');
  const currentSymbol = symbolKey(currentView?.defined_symbol || currentView?.symbol || '');
  return Boolean(referenceSymbol && currentSymbol && referenceSymbol !== currentSymbol);
}

function asConceptPrerequisiteReference(reference) {
  if (!isFormulaReferenceDependency(reference)) return reference;
  const viaSymbol = isFormulaReferenceText(reference.via_symbol) ? reference.symbol || '' : reference.via_symbol;
  const derivedFromFormulaEdge = reference.derived_from_formula_edge
    ? {
        ...reference.derived_from_formula_edge,
        via_symbol: isFormulaReferenceText(reference.derived_from_formula_edge.via_symbol)
          ? reference.symbol || ''
          : reference.derived_from_formula_edge.via_symbol,
      }
    : undefined;
  return {
    ...reference,
    relation: 'formula_prerequisite_concept',
    via_symbol: viaSymbol,
    ...(derivedFromFormulaEdge ? { derived_from_formula_edge: derivedFromFormulaEdge } : {}),
  };
}

function mergeConceptReference(existing, incoming) {
  return {
    ...existing,
    view_id: existing.view_id || incoming.view_id,
    canonical_concept_id: existing.canonical_concept_id || incoming.canonical_concept_id,
    canonical_concept_name: existing.canonical_concept_name || incoming.canonical_concept_name,
    definition: existing.definition || incoming.definition,
    definition_zh: existing.definition_zh || incoming.definition_zh,
    teaching_move: existing.teaching_move || incoming.teaching_move,
    teaching_move_zh: existing.teaching_move_zh || incoming.teaching_move_zh,
    source_sentence: existing.source_sentence || incoming.source_sentence,
    confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
    review_status: mergeReviewStatus(existing.review_status, incoming.review_status),
    review_flags: Array.from(new Set([...(existing.review_flags || []), ...(incoming.review_flags || [])])),
  };
}

function dedupeConceptReferences(references) {
  const byKey = new Map();
  for (const reference of references) {
    const key = conceptDedupKey(reference);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeConceptReference(existing, reference) : reference);
  }
  return [...byKey.values()];
}

function dedupeConceptReferencesByDisplay(references) {
  const byKey = new Map();
  for (const reference of references || []) {
    const key = conceptDisplayDedupKey(reference);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, reference);
      continue;
    }
    const merged = mergeConceptReference(existing, reference);
    byKey.set(key, conceptReferenceDisplayScore(reference, 0) > conceptReferenceDisplayScore(existing, 0) ? { ...merged, ...reference } : merged);
  }
  return [...byKey.values()];
}

function acceptedFormulaPrerequisites(dependency) {
  return (dependency?.prerequisites || []).filter(
    (item) => item.type === 'formula'
      && item.target_id
      && !item.cross_chapter
      && (item.edge_status || 'accepted') === 'accepted',
  ).filter(
    (item) => item.relation !== 'compound_group',
  );
}

function conceptEdgeEndpoint(value) {
  return cleanPublicConceptId(value?.view_id || value?.concept_id || '');
}

function conceptReferenceFromProductView(view, relation = 'concept_prerequisite', confidence = 0.76) {
  return {
    concept_id: view.concept_id,
    view_id: view.view_id || view.concept_id,
    name: view.name,
    canonical_concept_id: view.canonical_concept_id,
    canonical_concept_name: view.canonical_concept_name,
    defined_by_formula_id: view.defined_by_formula_id,
    from_formula_id: view.defined_by_formula_id,
    formula_label: view.supporting_formula_label,
    symbol: view.defined_symbol,
    via_symbol: view.defined_symbol,
    clickable: true,
    confidence: Math.max(confidence, view.confidence || 0),
    relation,
    concept_type: view.concept_type,
    definition: view.definition,
    definition_zh: view.definition_zh,
    source_sentence: view.source_sentence,
    review_status: view.review_status,
    review_flags: view.review_flags,
  };
}

function viewSortValue(view) {
  return Number.isFinite(view?.formula_position) ? Number(view.formula_position) : Number.MAX_SAFE_INTEGER;
}

function nearestPriorView(candidates, currentView) {
  const currentPosition = viewSortValue(currentView);
  return (candidates || [])
    .filter((candidate) => (
      candidate.concept_id !== currentView.concept_id
      && viewSortValue(candidate) <= currentPosition
    ))
    .sort((left, right) => viewSortValue(right) - viewSortValue(left))[0] || null;
}

function buildProductConceptLookups(views) {
  const byMeaning = new Map();
  const byName = new Map();
  const byBaseSymbol = new Map();
  for (const view of views || []) {
    if (isFormulaArtifactConcept(view)) continue;
    const meaning = conceptMeaningKey(view);
    const name = conceptNameKey(view);
    const symbol = baseSymbol(view.defined_symbol || '').toLowerCase();
    if (meaning) {
      const current = byMeaning.get(meaning) || [];
      current.push(view);
      byMeaning.set(meaning, current);
    }
    if (name) {
      const current = byName.get(name) || [];
      current.push(view);
      byName.set(name, current);
    }
    if (symbol && symbol.length > 1) {
      const current = byBaseSymbol.get(symbol) || [];
      current.push(view);
      byBaseSymbol.set(symbol, current);
    }
  }
  return { byMeaning, byName, byBaseSymbol };
}

function inferPrerequisitesFromCurrentFormulaSymbols(view, lookups) {
  const candidates = [];
  for (const reference of filterProductConceptReferences(view.introduced_concepts || [])) {
    const meaning = conceptMeaningKey(reference);
    const name = conceptNameKey(reference);
    const symbol = baseSymbol(reference.symbol || reference.via_symbol || '').toLowerCase();
    const pools = [
      ...(meaning ? lookups.byMeaning.get(meaning) || [] : []),
      ...(name ? lookups.byName.get(name) || [] : []),
      ...(symbol ? lookups.byBaseSymbol.get(symbol) || [] : []),
    ];
    const prior = nearestPriorView(pools, view);
    if (!prior) continue;
    candidates.push(conceptReferenceFromProductView(
      prior,
      'symbol_concept_prerequisite',
      reference.confidence || prior.confidence || 0.76,
    ));
  }
  return candidates;
}

function inferContinuationPrerequisites(view, lookups) {
  const name = conceptNameKey(view);
  if (!name) return [];
  if (/^(?:response|change|mean|count|index|time|probability|coefficient|parameter|variable|function|rate|value)$/i.test(name)) return [];
  const prior = nearestPriorView(lookups.byName.get(name) || [], view);
  if (!prior) return [];
  return [conceptReferenceFromProductView(prior, 'concept_continuation', Math.min(0.82, Math.max(0.72, view.confidence || 0)))];
}

function strengthenConceptPrerequisites(views) {
  const lookups = buildProductConceptLookups(views);
  return (views || []).map((view) => {
    const prerequisite_concepts = sanitizePrerequisiteReferences([
      ...(view.prerequisite_concepts || []),
      ...inferPrerequisitesFromCurrentFormulaSymbols(view, lookups),
      ...inferContinuationPrerequisites(view, lookups),
    ], view);
    const prerequisiteEdges = prerequisite_concepts.map((concept) => ({
      from: conceptEdgeEndpoint(concept),
      to: conceptEdgeEndpoint(view),
      relation: concept.relation || 'prerequisite_for',
      derived_from_formula_edge: {
        from: concept.from_formula_id || concept.defined_by_formula_id,
        to: view.defined_by_formula_id,
        via_symbol: concept.via_symbol,
      },
      clickable: true,
      confidence: concept.confidence,
    }));
    const introducedEdges = (view.edges || []).filter((edge) => edge.relation === 'introduced_for');
    return {
      ...view,
      prerequisite_concepts,
      edges: [...prerequisiteEdges, ...introducedEdges],
    };
  });
}

function addCuratedPublicConceptPrerequisites(views) {
  const byFormulaName = new Map();
  for (const view of views || []) {
    byFormulaName.set(`${view.defined_by_formula_id}::${conceptNameKey(view)}`, view);
    for (const reference of view.formula_references || []) {
      if (reference?.formula_id) byFormulaName.set(`${reference.formula_id}::${conceptNameKey(view)}`, view);
    }
  }
  return (views || []).map((view) => {
    const representsFormula = view.defined_by_formula_id === 'formula_18.25b'
      || (view.formula_references || []).some((reference) => reference?.formula_id === 'formula_18.25b');
    const representsCumulativeResponse = conceptNameKey(view) === 'cumulative response'
      || symbolKey(view.defined_symbol || '') === symbolKey('R_{C}')
      || (view.formula_references || []).some((reference) => (
        reference?.formula_id === 'formula_18.25b'
        && symbolKey(reference.symbol || '') === symbolKey('R_{C}')
      ));
    if (view.chapter_id !== 'chapter18' || !representsFormula || !representsCumulativeResponse) {
      return view;
    }
    const curatedTargets = [
      byFormulaName.get('formula_18.23a::selected population mean trait value')
        || (views || []).find((candidate) => (
          candidate.defined_by_formula_id === 'formula_18.23a'
          && symbolKey(candidate.defined_symbol || '') === symbolKey('\\overline{z}_{s,t}')
        )),
      byFormulaName.get('formula_18.23b::control population mean trait value')
        || (views || []).find((candidate) => (
          candidate.defined_by_formula_id === 'formula_18.23b'
          && symbolKey(candidate.defined_symbol || '') === symbolKey('\\overline{z}_{c,t}')
        )),
    ].filter(Boolean);
    if (!curatedTargets.length) return view;
    const prerequisite_concepts = sanitizePrerequisiteReferences([
      ...(view.prerequisite_concepts || []),
      ...curatedTargets.map((target) => conceptReferenceFromProductView(target, 'formula_prerequisite_concept', 0.94)),
    ], view);
    return {
      ...view,
      prerequisite_concepts,
      edges: rebuildConceptViewEdges({
        ...view,
        prerequisite_concepts,
      }),
    };
  });
}

function addFinalCuratedPublicConceptPrerequisites(views) {
  const selectedMean = (views || []).find((candidate) => (
    candidate.chapter_id === 'chapter18'
    && candidate.defined_by_formula_id === 'formula_18.23a'
    && symbolKey(candidate.defined_symbol || '') === symbolKey('\\overline{z}_{s,t}')
  ));
  const controlMean = (views || []).find((candidate) => (
    candidate.chapter_id === 'chapter18'
    && candidate.defined_by_formula_id === 'formula_18.23b'
    && symbolKey(candidate.defined_symbol || '') === symbolKey('\\overline{z}_{c,t}')
  ));
  const curatedTargets = [selectedMean, controlMean].filter(Boolean);
  if (curatedTargets.length !== 2) return views;

  return (views || []).map((view) => {
    const representsCumulativeResponse = view.chapter_id === 'chapter18'
      && (
        view.concept_id === 'canonical_cumulative_response'
        || view.view_id === 'canonical_cumulative_response'
        || (view.formula_references || []).some((reference) => (
          reference?.formula_id === 'formula_18.25b'
          && symbolKey(reference.symbol || '') === symbolKey('R_{C}')
        ))
      );
    if (!representsCumulativeResponse) return view;
    const prerequisite_concepts = sortConceptReferencesForDisplay(dedupeConceptReferencesByDisplay(dedupeConceptReferences([
      ...(view.prerequisite_concepts || []),
      ...curatedTargets.map((target) => conceptReferenceFromProductView(target, 'formula_prerequisite_concept', 0.94)),
    ])));
    return {
      ...view,
      prerequisite_concepts,
      edges: rebuildConceptViewEdges({
        ...view,
        prerequisite_concepts,
      }),
    };
  });
}

function bestFormulaDependencyTargetView(targetViews, prereq) {
  const viaKey = symbolKey(prereq?.via_symbol || '');
  const exact = (targetViews || []).find((view) => symbolKey(view.defined_symbol || '') === viaKey);
  if (exact) return exact;
  return (targetViews || [])
    .map((view, index) => ({ view, score: conceptReferenceDisplayScore(view, index) }))
    .sort((left, right) => right.score - left.score)[0]?.view || null;
}

function conceptReferenceFromFormulaDependencyTarget(targetView, prereq, dependentFormulaId) {
  const viaSymbol = isFormulaReferenceText(prereq?.via_symbol)
    ? targetView.defined_symbol
    : prereq?.via_symbol || targetView.defined_symbol;
  return {
    ...conceptReferenceFromProductView(targetView, 'formula_prerequisite_concept', prereq?.confidence || targetView.confidence || 0.76),
    via_symbol: viaSymbol,
    relation: 'formula_prerequisite_concept',
    formula_dependency_anchor: true,
    derived_from_formula_edge: {
      from: prereq?.target_id || targetView.defined_by_formula_id,
      to: dependentFormulaId,
      via_symbol: viaSymbol,
    },
  };
}

function fillEmptyFormulaDependencyPrerequisites(views, dependencies) {
  const viewsByFormula = new Map();
  for (const view of views || []) {
    const list = viewsByFormula.get(view.defined_by_formula_id) || [];
    list.push(view);
    viewsByFormula.set(view.defined_by_formula_id, list);
  }
  const dependencyByFormula = new Map((dependencies || []).map((dependency) => [dependency.dependent_id, dependency]));
  const fallbackReferencesByFormula = new Map();

  for (const [formulaId, dependency] of dependencyByFormula) {
    const prereqs = acceptedFormulaPrerequisites(dependency);
    if (!prereqs.length) continue;
    const fallbackReferences = [];
    for (const prereq of prereqs) {
      const targetView = bestFormulaDependencyTargetView(viewsByFormula.get(prereq.target_id) || [], prereq);
      if (!targetView) continue;
      fallbackReferences.push(conceptReferenceFromFormulaDependencyTarget(targetView, prereq, formulaId));
    }
    if (fallbackReferences.length) fallbackReferencesByFormula.set(formulaId, fallbackReferences);
  }

  return (views || []).map((view) => {
    const sameFormulaReferences = (viewsByFormula.get(view.defined_by_formula_id) || [])
      .filter((candidate) => candidate.concept_id !== view.concept_id)
      .flatMap((candidate) => candidate.prerequisite_concepts || []);
    const fallbackReferences = [
      ...sameFormulaReferences,
      ...(fallbackReferencesByFormula.get(view.defined_by_formula_id) || []),
    ];
    if ((view.prerequisite_concepts || []).length && !sameFormulaReferences.length) return view;
    if (!fallbackReferences.length) return view;
    const prerequisite_concepts = sanitizePrerequisiteReferences([
      ...(view.prerequisite_concepts || []),
      ...fallbackReferences,
    ], view);
    const prerequisiteEdges = prerequisite_concepts.map((concept) => ({
      from: concept.concept_id,
      to: view.concept_id,
      relation: concept.relation || 'prerequisite_for',
      derived_from_formula_edge: {
        from: concept.from_formula_id || concept.defined_by_formula_id,
        to: view.defined_by_formula_id,
        via_symbol: concept.via_symbol,
      },
      clickable: true,
      confidence: concept.confidence,
    }));
    const introducedEdges = (view.edges || []).filter((edge) => edge.relation === 'introduced_for');
    return {
      ...view,
      prerequisite_concepts,
      edges: [...prerequisiteEdges, ...introducedEdges],
    };
  });
}

function dependencyAnchorCandidateScore(concept, index) {
  const publicName = productConceptName(concept.concept_name, concept.formula_label, concept.symbol);
  const normalizedName = normalizeSpaces(publicName).toLowerCase();
  const flags = new Set(concept.review_flags || []);
  let score = Number.isFinite(concept.confidence) ? concept.confidence : 0;
  if (concept.review_status === 'approved') score += 0.2;
  if (concept.review_status === 'edited' || concept.review_status === 'reviewed') score += 0.16;
  if (concept.role === 'defined') score += 0.08;
  if (concept.concept_type === 'quantity_concept') score += 0.06;
  if (CONCEPT_DEFINITIONS.has(normalizedName)) score += 0.06;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(normalizedName)) score -= 0.12;
  if (flags.has('weak_evidence')) score -= 0.03;
  return score - index * 0.0001;
}

function isDependencyAnchorCandidate(concept) {
  if (!concept) return false;
  const status = concept.review_status || 'unreviewed';
  if (status === 'rejected') return false;
  if (['ambiguous', 'needs_revision'].includes(status)) return false;
  const flags = new Set(concept.review_flags || []);
  if (flags.has('formula_or_symbol_artifact') || flags.has('low_confidence')) return false;
  const publicName = productConceptName(concept.concept_name, concept.formula_label, concept.symbol);
  if (normalizeSpaces(publicName).toLowerCase() === 'model quantity') return false;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(normalizeSpaces(publicName).toLowerCase())) return false;
  if (isFormulaArtifactConcept({ ...concept, name: publicName, concept_name: publicName })) return false;
  return true;
}

function bestDependencyAnchorCandidate(symbolConcepts, formulaId) {
  return (symbolConcepts || [])
    .filter((concept) => concept.formula_id === formulaId)
    .filter(isDependencyAnchorCandidate)
    .map((concept, index) => ({ concept, score: dependencyAnchorCandidateScore(concept, index) }))
    .sort((left, right) => right.score - left.score)[0]?.concept || null;
}

function formulaAnchorConceptName(formula) {
  const latex = normalizeSpaces(formula?.latex || '');
  const label = normalizeSpaces(formula?.label || formula?.id || 'Formula');
  if (/\\Pr|\\mathrm\{?\s*P\s*r\s*\}?|\\binom/.test(latex)) return `${label} Probability Relation`;
  if (/K_\{?\d+\}?|cumulant|\\mu_\{?\d+\}?/.test(latex)) return `${label} Cumulant Relation`;
  if (/\\Theta|\\Delta/.test(latex)) return `${label} Covariance Decomposition`;
  return `${label} Mathematical Relation`;
}

function formulaAnchorConcept(chapterId, formula, reason) {
  const name = formulaAnchorConceptName(formula);
  const sourceSentence = sentenceWindow(formulaContext(formula), formula.label || formula.id);
  return {
    chapter_id: chapterId,
    formula_id: formula.id,
    formula_label: formula.label,
    formula_latex: formula.latex,
    formula_section: formula.section,
    formula_subsection: formula.subsection,
    symbol: formula.label || formula.id,
    role: 'defined',
    concept_id: `concept_${chapterId}_${slug(formula.id)}_dependency_anchor_formula_relation`,
    concept_name: name,
    concept_type: 'math_concept',
    definition: `${name} is the mathematical relation introduced by ${formula.label || formula.id} and used as a prerequisite by later formulas in this chapter.`,
    source_sentence: sourceSentence,
    aliases: [formula.label || formula.id, name],
    evidence: sourceSentence ? [{
      chunk_id: formula.id,
      block_index: formula.position ?? 0,
      block_type: formula.context_text ? 'derivation' : 'formula',
      sentence: sourceSentence,
    }] : [],
    confidence: 0.78,
    review_status: 'reviewed',
    review_flags: ['dependency_anchor'],
    review_notes: reason,
  };
}

function conceptViewFromDependencyAnchor(chapterId, formula, concept) {
  const name = productConceptName(concept.concept_name, formula.label, concept.symbol);
  const cleanConcept = {
    ...concept,
    concept_id: `concept_${chapterId}_${slug(formula.id)}_dependency_anchor_${slug(concept.symbol || concept.concept_name || 'concept')}`,
    name,
    concept_name: name,
  };
  return {
    chapter_id: chapterId,
    concept_id: cleanPublicConceptId(cleanConcept.concept_id),
    name,
    definition: concept.definition,
    definition_zh: concept.definition_zh,
    teaching_move: concept.teaching_move,
    teaching_move_zh: concept.teaching_move_zh,
    source_sentence: concept.source_sentence,
    concept_type: concept.concept_type,
    defined_by_formula_id: formula.id,
    defined_symbol: concept.symbol,
    supporting_formula_label: formula.label,
    supporting_formula_latex: formula.latex,
    formula_position: formula.position,
    formula_section: formula.section,
    formula_subsection: formula.subsection,
    evidence: concept.evidence,
    confidence: Math.max(Number(concept.confidence || 0), 0.78),
    review_status: concept.review_status,
    review_flags: Array.from(new Set([...(concept.review_flags || []), 'dependency_anchor'])),
    ...defaultCanonicalMetadata(cleanConcept),
    prerequisite_concepts: [],
    introduced_concepts: [],
    edges: [],
  };
}

function addMissingDependencyAnchorViews(views, conceptGraph, symbolConcepts) {
  const formulaById = new Map((conceptGraph.formulas || []).map((formula) => [formula.id, formula]));
  const existingFormulaIds = new Set((views || []).map((view) => view.defined_by_formula_id));
  const dependencyFormulaIds = new Set([
    ...dependencyTargetFormulaIds(conceptGraph),
    ...dependencyDependentFormulaIds(conceptGraph),
  ]);
  const anchors = [];

  for (const formulaId of dependencyFormulaIds) {
    if (existingFormulaIds.has(formulaId)) continue;
    const formula = formulaById.get(formulaId);
    if (!formula) continue;
    const candidate = bestDependencyAnchorCandidate(symbolConcepts, formulaId)
      || formulaAnchorConcept(conceptGraph.chapter_id, formula, 'Formula-level dependency anchor added for an accepted same-chapter prerequisite without a public symbol concept.');
    const anchorView = conceptViewFromDependencyAnchor(conceptGraph.chapter_id, formula, candidate);
    if (isFormulaArtifactConcept(anchorView)) continue;
    anchors.push(anchorView);
    existingFormulaIds.add(formulaId);
  }

  return anchors.length ? dedupeConceptViewsById([...(views || []), ...anchors]) : views;
}

function rebuildPrerequisiteEdges(view, prerequisiteConcepts) {
  const prerequisiteEdges = prerequisiteConcepts.map((concept) => ({
    from: conceptEdgeEndpoint(concept),
    to: conceptEdgeEndpoint(view),
    relation: concept.relation || 'prerequisite_for',
    derived_from_formula_edge: {
      from: concept.from_formula_id || concept.defined_by_formula_id,
      to: view.defined_by_formula_id,
      via_symbol: concept.via_symbol,
    },
    clickable: true,
    confidence: concept.confidence,
  }));
  const introducedEdges = (view.edges || []).filter((edge) => edge.relation === 'introduced_for');
  return [...prerequisiteEdges, ...introducedEdges];
}

function rebuildConceptViewEdges(view) {
  const prerequisiteEdges = (view.prerequisite_concepts || []).map((concept) => ({
    from: conceptEdgeEndpoint(concept),
    to: conceptEdgeEndpoint(view),
    relation: concept.relation || 'prerequisite_for',
    derived_from_formula_edge: {
      from: concept.from_formula_id || concept.defined_by_formula_id,
      to: view.defined_by_formula_id,
      via_symbol: concept.via_symbol,
    },
    clickable: true,
    confidence: concept.confidence,
  }));
  const introducedEdges = (view.introduced_concepts || []).map((concept) => ({
    from: conceptEdgeEndpoint(concept),
    to: conceptEdgeEndpoint(view),
    relation: 'introduced_for',
    symbol: concept.symbol,
    clickable: false,
    confidence: concept.confidence,
  }));
  return [...prerequisiteEdges, ...introducedEdges];
}

function repairDanglingPrerequisiteReferences(views) {
  const validIds = new Set((views || []).map((view) => view.concept_id));
  const viewsByFormula = new Map();
  for (const view of views || []) {
    const list = viewsByFormula.get(view.defined_by_formula_id) || [];
    list.push(view);
    viewsByFormula.set(view.defined_by_formula_id, list);
  }

  return (views || []).map((view) => {
    const repaired = [];
    for (const reference of view.prerequisite_concepts || []) {
      if (validIds.has(reference.concept_id)) {
        repaired.push(reference);
        continue;
      }
      const formulaId = reference.from_formula_id || reference.defined_by_formula_id;
      const targetView = bestFormulaDependencyTargetView(viewsByFormula.get(formulaId) || [], {
        via_symbol: reference.via_symbol || reference.symbol,
        confidence: reference.confidence,
      });
      if (!targetView) continue;
      repaired.push(conceptReferenceFromFormulaDependencyTarget(targetView, {
        target_id: formulaId,
        via_symbol: reference.via_symbol || reference.symbol,
        confidence: reference.confidence,
      }, view.defined_by_formula_id));
    }
    const prerequisite_concepts = sanitizePrerequisiteReferences(repaired, view)
      .filter((reference) => validIds.has(reference.concept_id));
    return {
      ...view,
      prerequisite_concepts,
      edges: rebuildPrerequisiteEdges(view, prerequisite_concepts),
    };
  });
}

function formulaOrderForView(view) {
  return Number.isFinite(view?.formula_position) ? Number(view.formula_position) : Number.POSITIVE_INFINITY;
}

function shouldDropReciprocalPrerequisite(view, reference, sourceView) {
  if (!view || !reference || !sourceView) return false;
  const sourceOrder = formulaOrderForView(sourceView);
  const targetOrder = formulaOrderForView(view);
  if (sourceOrder !== targetOrder) return sourceOrder > targetOrder;
  return (reference.confidence || 0) < (view.confidence || 0);
}

function isFormulaDependencyAnchorReference(reference) {
  return reference?.formula_dependency_anchor === true
    || normalizeSpaces(reference?.relation || '') === 'formula_prerequisite_concept';
}

function removeReciprocalPrerequisiteReferences(views) {
  const byViewEndpoint = new Map((views || []).map((view) => [conceptEdgeEndpoint(view), view]));
  const edgeByKey = new Map();
  for (const view of views || []) {
    const targetEndpoint = conceptEdgeEndpoint(view);
    for (const reference of view.prerequisite_concepts || []) {
      const sourceEndpoint = conceptEdgeEndpoint(reference);
      if (!sourceEndpoint || sourceEndpoint === targetEndpoint) continue;
      edgeByKey.set(`${sourceEndpoint}->${targetEndpoint}`, reference);
    }
  }

  return (views || []).map((view) => {
    const targetEndpoint = conceptEdgeEndpoint(view);
    const prerequisite_concepts = (view.prerequisite_concepts || []).filter((reference) => {
      const sourceEndpoint = conceptEdgeEndpoint(reference);
      if (!sourceEndpoint || sourceEndpoint === targetEndpoint) return false;
      const reverseKey = `${targetEndpoint}->${sourceEndpoint}`;
      const reverseReference = edgeByKey.get(reverseKey);
      if (!reverseReference) return true;
      if (isFormulaDependencyAnchorReference(reference) && !isFormulaDependencyAnchorReference(reverseReference)) return true;
      if (!isFormulaDependencyAnchorReference(reference) && isFormulaDependencyAnchorReference(reverseReference)) return false;
      return !shouldDropReciprocalPrerequisite(view, reference, byViewEndpoint.get(sourceEndpoint));
    });
    return {
      ...view,
      prerequisite_concepts,
      edges: rebuildPrerequisiteEdges(view, prerequisite_concepts),
    };
  });
}

function removeSelfIntroducedConceptReferences(views) {
  return (views || []).map((view) => {
    const introduced_concepts = sortConceptReferencesForDisplay(dedupeConceptReferences(
      filterProductConceptReferences(view.introduced_concepts || [])
        .filter((reference) => !isSameConceptReference(reference, view))
        .filter((reference) => !isSameConceptMeaning(reference, view)),
    ));
    return {
      ...view,
      introduced_concepts,
      edges: rebuildConceptViewEdges({
        ...view,
        introduced_concepts,
      }),
    };
  });
}

function finalizeConceptViewStructure(views, dependencies) {
  const withNoSelfIntroduced = removeSelfIntroducedConceptReferences(views);
  const withFilledPrerequisites = fillEmptyFormulaDependencyPrerequisites(withNoSelfIntroduced, dependencies || []);
  const repaired = repairDanglingPrerequisiteReferences(withFilledPrerequisites);
  const withoutReciprocal = removeReciprocalPrerequisiteReferences(repaired);
  const refilledAfterReciprocalCleanup = fillEmptyFormulaDependencyPrerequisites(withoutReciprocal, dependencies || []);
  const repairedAfterRefill = repairDanglingPrerequisiteReferences(refilledAfterReciprocalCleanup);
  return removeReciprocalPrerequisiteReferences(repairedAfterRefill);
}

function lhsTopLevelFunctionCall(latex) {
  const lhs = lhsExpression(latex);
  let braceDepth = 0;
  for (let index = 0; index < lhs.length; index += 1) {
    const char = lhs[index];
    if (char === '{') braceDepth += 1;
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (char !== '(' || braceDepth !== 0) continue;
    const name = normalizeSpaces(lhs.slice(0, index));
    if (!/^(?:\\[A-Za-z]+|[A-Za-z])/.test(name)) return null;
    let parenDepth = 1;
    for (let end = index + 1; end < lhs.length; end += 1) {
      const next = lhs[end];
      if (next === '(') parenDepth += 1;
      if (next === ')') parenDepth -= 1;
      if (parenDepth === 0) {
        return {
          name,
          args: lhs.slice(index + 1, end),
        };
      }
    }
    return null;
  }
  return null;
}

function lhsFunctionArguments(latex) {
  const call = lhsTopLevelFunctionCall(latex);
  if (!call?.args) return new Set();
  return new Set(call.args.split(',').map((item) => normalizeSpaces(item)).filter(Boolean));
}

function lhsFunctionName(latex) {
  return lhsTopLevelFunctionCall(latex)?.name || '';
}

function lhsExpression(latex) {
  return String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .replace(/&/g, '')
    .split(/(?:=|\\(?:simeq|approx|sim|leq|geq|lt|gt|equiv)(?=[^A-Za-z]|$)|[<>])/)[0] || '';
}

function lhsNamedStatistic(latex) {
  const lhs = lhsExpression(latex);
  const match = lhs.match(/^\s*([A-Za-z][A-Za-z0-9]{1,8})\s*$/);
  return match?.[1] || '';
}

function lhsPrimarySymbol(latex) {
  const lhs = lhsExpression(latex);
  const normalized = normalizeSpaces(lhs);
  if (!normalized || /[+\-*/(),]/.test(stripLatex(normalized))) return '';
  if (!/^[\\A-Za-z]/.test(normalized)) return '';
  if (/(?:\\sum|\\prod|\\int|\\frac|\\sqrt|\\left|\\right)/.test(normalized)) return '';
  return normalized;
}

function lhsIsExpression(latex) {
  const lhs = normalizeSpaces(lhsExpression(latex));
  if (!lhs) return false;
  if (/(?:\\frac|\\sum|\\prod|\\int|\\sqrt|\\left|\\right)/.test(lhs)) return true;
  return /[+\-*/(),]/.test(stripLatex(lhs));
}

function whereDefinedSymbols(latex) {
  const text = String(latex || '');
  const whereIndex = text.search(/\\(?:mathrm|text)\{[^{}]*w\s*h\s*e\s*r\s*e[^{}]*\}|\bwhere\b/i);
  if (whereIndex < 0) return [];
  const tail = text.slice(whereIndex)
    .replace(/^\\(?:mathrm|text)\{[^{}]*w\s*h\s*e\s*r\s*e[^{}]*\}/i, ' ')
    .replace(/^\bwhere\b/i, ' ')
    .replace(/\\(?:quad|qquad|;|,|:|!)\b/g, ' ');
  const symbols = [];
  for (const match of tail.matchAll(/(?:^|[,\s])((?:\\[A-Za-z]+(?:\{[^{}]+\})?|[A-Za-z])(?:_\{[^{}]+\}|_[A-Za-z0-9]|\^\{[^{}]+\})?)\s*=/g)) {
    if (match[1] && !isIgnoredSymbol(match[1])) symbols.push(normalizeSpaces(match[1]));
  }
  return uniqueFormulaSymbols(symbols);
}

function lhsRatioConceptSymbol(latex) {
  const lhs = normalizeSpaces(lhsExpression(latex));
  if (/^\\frac\{H_\{?h\}?\}\{H_\{?0\}?\}$/.test(lhs)) return '\\frac{H_{h}}{H_{0}}';
  if (/^\\frac\{\\pi\}\{\\pi_\{?0\}?\}$/.test(lhs)) return '\\frac{\\pi}{\\pi_{0}}';
  return '';
}

function isMixedModelStructureFormula(formula, lhsPrimary) {
  const lhsKey = symbolKey(lhsPrimary);
  if (lhsKey !== 'y') return false;
  const latex = String(formula?.latex || '').replace(/\s+/g, '');
  const context = formulaContext(formula, null);
  if (!/mixed model|simple model|fixed effect|random effect|reducing Equation 19\.1|vector of observations/i.test(context)) {
    return false;
  }
  return (
    /\\mathbf\{X\}\\boldsymbol\{\\beta\}\+\\mathbf\{Z\}\\mathbf\{a\}\+\\mathbf\{e\}/.test(latex)
    || /\\boldsymbol\{\\mu\}\\cdot\\mathbf\{1\}\+\\mathbf\{a\}\+\\mathbf\{e\}/.test(latex)
  );
}

function symbolKey(value) {
  return String(value || '')
    .replace(/&/g, '')
    .replace(/\s+/g, '')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathbb|mathcal|mathit|mathsf|mathrm)(\\?[A-Za-z])/g, '$1')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function isSplitFromWholeSymbol(symbol, whole) {
  const symbolValue = symbolKey(symbol);
  const wholeValue = symbolKey(whole);
  return Boolean(/^[A-Z]$/.test(symbolValue) && wholeValue && wholeValue !== symbolValue && wholeValue.includes(symbolValue));
}

function isRedundantWithDefinedSymbol(symbol, definedSymbols) {
  const key = symbolKey(symbol);
  if (!key) return false;
  return definedSymbols.some((defined) => {
    const definedKey = symbolKey(defined);
    if (!definedKey || definedKey === key) return false;
    if (/^[A-Z]$/.test(key) && definedKey.includes(key)) return true;
    if (/^\\(?:overline|bar)\{?\\alpha\}?$/.test(key) && /\\widehat.*\\alpha/.test(definedKey)) return true;
    if (/^\\widehat\{?\\overline\{?\\alpha\}?\}?$/.test(key) && /\\widehat.*\\alpha/.test(definedKey)) return true;
    return false;
  });
}

function symbolContainsSubscriptParts(symbol, candidate) {
  const candidateKey = symbolKey(candidate);
  if (!candidateKey || !/^[A-Za-z]+$/.test(candidateKey)) return false;
  const symbolValue = String(symbol || '');
  const subscriptParts = [...symbolValue.matchAll(/_\{([^{}]+)\}/g)]
    .flatMap((match) => match[1].split(',').map((part) => symbolKey(part).replace(/[^A-Za-z]/g, '')).filter(Boolean));
  return subscriptParts.includes(candidateKey);
}

function isSubscriptPartOfDefinedSymbol(symbol, definedSymbols) {
  return definedSymbols.some((defined) => symbolContainsSubscriptParts(defined, symbol));
}

function typesetWordLetters(latex) {
  const letters = new Set();
  for (const match of String(latex || '').matchAll(/\\(?:mathrm|text)\{([^{}]+)\}/g)) {
    const compact = normalizeSpaces(match[1]).replace(/\s+/g, '').toLowerCase();
    if (/^(?:where|then|with|and|for|if|the)$/.test(compact)) {
      compact.split('').forEach((char) => letters.add(char));
    }
  }
  return letters;
}

function removeTypesetWords(latex) {
  return String(latex || '').replace(/\\(?:mathrm|text)\{[^{}]+\}/g, ' ');
}

function topLevelSingleLetterAppears(latex, symbol) {
  const clean = removeTypesetWords(latex)
    .replace(/_\{[^{}]*\}/g, ' ')
    .replace(/_[A-Za-z0-9]/g, ' ')
    .replace(/\\[A-Za-z]+/g, ' ');
  return new RegExp(`(^|[^A-Za-z])${escapeRegExp(symbol)}([^A-Za-z]|$)`).test(clean);
}

function isTypesetWordArtifact(symbol, formula) {
  const clean = normalizeSpaces(symbol);
  if (!/^[a-z]$/.test(clean)) return false;
  if (!typesetWordLetters(formula.latex).has(clean.toLowerCase())) return false;
  return !topLevelSingleLetterAppears(formula.latex, clean);
}

function formulaSymbols(formula) {
  const functionArguments = lhsFunctionArguments(formula.latex);
  const argumentSymbols = uniqueFormulaSymbols([...functionArguments]);
  const argumentSet = new Set(argumentSymbols);
  const functionName = lhsFunctionName(formula.latex);
  const lhsPrimary = lhsPrimarySymbol(formula.latex);
  const ratioSymbol = lhsRatioConceptSymbol(formula.latex);
  let defined = ratioSymbol ? [ratioSymbol] : lhsIsExpression(formula.latex) ? whereDefinedSymbols(formula.latex) : uniqueFormulaSymbols(formula.symbols_defined || [])
    .filter((symbol) => !argumentSet.has(symbol))
    .filter((symbol) => !lhsPrimary || !isSplitFromWholeSymbol(symbol, lhsPrimary));
  if (lhsPrimary && isMixedModelStructureFormula(formula, lhsPrimary)) {
    defined = [];
  }
  if (functionName) {
    defined = uniqueFormulaSymbols([functionName]);
  }
  if (lhsPrimary && (lhsPrimary.includes('_') || /\\(?:widehat|hat|overline|bar|widetilde|tilde)/.test(lhsPrimary))) {
    defined = [lhsPrimary];
  }
  defined = defined.filter((symbol) => !isSubscriptPartOfDefinedSymbol(symbol, defined));
  const lhsSymbol = lhsNamedStatistic(formula.latex);
  if (!lhsPrimary && lhsSymbol && COMMON_SYMBOL_NAMES.has(lhsSymbol)) {
    defined = [lhsSymbol];
  }
  const definedSet = new Set(defined);
  const definedLetters = lhsSymbol ? new Set(lhsSymbol.split('')) : null;
  let used = uniqueFormulaSymbols([...(formula.symbols_used || []), ...argumentSymbols]).filter((symbol) => {
    if (isTypesetWordArtifact(symbol, formula)) return false;
    if (definedSet.has(symbol)) return false;
    if (lhsPrimary && isSplitFromWholeSymbol(symbol, lhsPrimary)) return false;
    if (isRedundantWithDefinedSymbol(symbol, defined)) return false;
    if (lhsSymbol && definedLetters?.has(symbol)) return false;
    return true;
  });
  if (/NI_\{?TG\}?/.test(String(formula.latex || ''))) {
    used = used.filter((symbol) => symbol !== 'N' && symbol !== 'I' && !/^I_\{?[A-Za-z]+\}?$/.test(symbol) && symbol !== 'G' && symbol !== 'T');
    if (!definedSet.has('NI_{TG}')) used.push('NI_{TG}');
  } else if (/\bN\s*I\b/.test(String(formula.latex || '')) && COMMON_SYMBOL_NAMES.has('NI')) {
    used = used.filter((symbol) => symbol !== 'N' && symbol !== 'I');
    if (!definedSet.has('NI')) used.push('NI');
  }
  return { defined, used };
}

const CHAPTER_STORYLINE_TEMPLATES = {
  chapter6: [
    {
      id: 'population_averages',
      name: 'Mean Trait Value and Mean Fitness',
      name_zh: '平均性状值与平均适合度',
      concept_names: ['Mean Trait Value', 'Mean Fitness'],
      formula_ids: ['formula_6.1', 'formula_6.2a', 'formula_6.2b'],
      prerequisite_step_ids: [],
    },
    {
      id: 'class_descendant_accounting',
      name: 'Class Descendant Accounting',
      name_zh: '类别后代性状与频率记账',
      concept_names: ['Class Trait Value', 'Class Frequency', 'Class Fitness', 'Trait Response'],
      formula_ids: ['formula_6.3a', 'formula_6.3b', 'formula_6.4', 'formula_6.5a', 'formula_6.5b', 'formula_6.6', 'formula_6.7a', 'formula_6.7b', 'formula_6.7c'],
      prerequisite_step_ids: ['population_averages'],
    },
    {
      id: 'price_trait_response',
      name: 'Price Equation Trait Response',
      name_zh: 'Price 方程下的性状响应',
      concept_names: ['Price Equation', 'Trait Response', 'Selection Differential'],
      formula_ids: ['formula_6.8', 'formula_6.9a', 'formula_6.9b', 'formula_6.10'],
      prerequisite_step_ids: ['class_descendant_accounting'],
    },
    {
      id: 'breeder_equation',
      name: "Breeder's Equation",
      name_zh: '育种家方程',
      concept_names: ['Selection Differential', 'Narrow-Sense Heritability', 'Breeder Equation', 'Trait Breeding Value'],
      formula_ids: ['formula_6.11', 'formula_6.12', 'formula_6.13a', 'formula_6.13b', 'formula_6.13c', 'formula_6.14', 'formula_6.15a', 'formula_6.15b', 'formula_6.15c', 'formula_6.15d', 'formula_6.16a', 'formula_6.16b', 'formula_6.16c', 'formula_6.16d', 'formula_6.16e', 'formula_6.16f'],
      prerequisite_step_ids: ['price_trait_response'],
    },
    {
      id: 'fisher_fitness_response',
      name: 'Fisher Fitness Response',
      name_zh: 'Fisher 适合度响应',
      concept_names: ['Fitness Response', 'Additive Genetic Variance', "Fisher's Fundamental Theorem"],
      formula_ids: ['formula_6.17a', 'formula_6.17b', 'formula_6.17c', 'formula_6.18a', 'formula_6.18b', 'formula_6.18c', 'formula_6.18d', 'formula_6.18e', 'formula_6.18f', 'formula_6.18g', 'formula_6.19', 'formula_6.20a', 'formula_6.20b', 'formula_6.21a', 'formula_6.21b', 'formula_6.21c', 'formula_6.22a', 'formula_6.22b', 'formula_6.23'],
      prerequisite_step_ids: ['breeder_equation'],
    },
    {
      id: 'robertson_theorem',
      name: 'Robertson Theorem',
      name_zh: 'Robertson 定理',
      concept_names: ['Robertson Theorem', 'Fitness Breeding Value', 'Trait Breeding Value'],
      formula_ids: ['formula_6.24a', 'formula_6.24b', 'formula_6.24c', 'formula_6.25a', 'formula_6.25b', 'formula_6.25c', 'formula_6.26', 'formula_6.27', 'formula_6.28', 'formula_6.29'],
      prerequisite_step_ids: ['fisher_fitness_response'],
    },
    {
      id: 'price_frame_breeder_and_heywood',
      name: 'Price-Frame Breeder Equation and Heywood Decomposition',
      name_zh: 'Price 框架育种家方程与 Heywood 分解',
      concept_names: ['Price-Frame Breeder Equation', 'Heywood Decomposition', 'Trait Breeding Value', 'Fitness Breeding Value'],
      formula_ids: ['formula_6.30a', 'formula_6.30b', 'formula_6.30c', 'formula_6.31a', 'formula_6.31b', 'formula_6.32', 'formula_6.33a', 'formula_6.33b', 'formula_6.33c', 'formula_6.33d', 'formula_6.33e', 'formula_6.33f', 'formula_6.34', 'formula_6.35', 'formula_6.36a', 'formula_6.36b', 'formula_6.37', 'formula_6.38', 'formula_6.39', 'formula_6.40', 'formula_6.41'],
      prerequisite_step_ids: ['robertson_theorem'],
    },
  ],
};

function chapterStorylineFor(chapterId, formulas = []) {
  const template = CHAPTER_STORYLINE_TEMPLATES[chapterId] || [];
  if (!template.length) return [];
  const formulaById = new Map((formulas || []).map((formula) => [formula.id, formula]));
  return template
    .map((step, index) => {
      const formulaIds = (step.formula_ids || []).filter((formulaId) => formulaById.has(formulaId));
      return {
        ...step,
        order: index,
        formula_ids: formulaIds,
        formula_labels: formulaIds.map((formulaId) => formulaById.get(formulaId)?.label || formulaId),
      };
    })
    .filter((step) => step.formula_ids.length);
}

function buildChapterConceptGraph(chapterDoc, promptMap, structuredBlocks) {
  const chapterId = chapterDoc.chapter_id;
  const formulaById = new Map((chapterDoc.formulas || []).map((formula) => [formula.id, formula]));
  const dependencyById = new Map((chapterDoc.dependencies || []).map((dependency) => [dependency.dependent_id, dependency]));
  const dependencyTargetIds = dependencyTargetFormulaIds(chapterDoc);
  const dependencyDependentIds = dependencyDependentFormulaIds(chapterDoc);
  const symbolConcepts = [];
  const definedByFormula = new Map();
  const symbolConceptsByFormula = new Map();
  const symbolConceptByFormulaSymbolRole = new Map();
  const conceptIdCounts = new Map();
  const takenConceptIds = new Set();
  const registerConcept = (concept) => {
    const uniqueConcept = withUniqueConceptId(concept, conceptIdCounts, takenConceptIds);
    symbolConcepts.push(uniqueConcept);
    return uniqueConcept;
  };

  for (const formula of chapterDoc.formulas || []) {
    const promptRecord = promptMap.get(formula.id);
    const formulaSymbolSet = formulaSymbols(formula);
    const symbols = [
      ...formulaSymbolSet.defined.map((symbol) => ({ symbol, role: 'defined' })),
      ...formulaSymbolSet.used.map((symbol) => ({ symbol, role: 'used' })),
    ];
    const seen = new Set();
    for (const item of symbols) {
      const key = `${item.role}:${item.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const concept = registerConcept(makeSymbolConcept(chapterId, formula, item.symbol, item.role, promptRecord, structuredBlocks));
      const formulaConcepts = symbolConceptsByFormula.get(formula.id) || [];
      formulaConcepts.push(concept);
      symbolConceptsByFormula.set(formula.id, formulaConcepts);
      symbolConceptByFormulaSymbolRole.set(`${formula.id}:${item.symbol}:${item.role}`, concept);
      if (item.role === 'defined') {
        const list = definedByFormula.get(formula.id) || [];
        list.push(concept);
        definedByFormula.set(formula.id, list);
      }
    }
  }

  for (const formulaId of new Set([...dependencyTargetIds, ...dependencyDependentIds])) {
    const role = dependencyTargetIds.has(formulaId) && dependencyDependentIds.has(formulaId)
      ? 'Dependency anchor concept added so accepted formula prerequisites and dependent formulas can reach the concept layer.'
      : dependencyTargetIds.has(formulaId)
        ? 'Dependency anchor concept added so accepted formula prerequisites can reach the concept layer.'
        : 'Dependency anchor concept added so a dependent formula with accepted prerequisites can appear in the concept layer.';
    ensureDependencyAnchorConcept({
      chapterId,
      formulaId,
      reason: role,
      symbolConceptsByFormula,
      definedByFormula,
      symbolConceptByFormulaSymbolRole,
      registerConcept,
    });
  }

  for (const missingConcept of missingCalibratedConceptEntries(symbolConcepts, chapterDoc, promptMap, structuredBlocks)) {
    const concept = registerConcept(missingConcept);
    const formulaConcepts = symbolConceptsByFormula.get(concept.formula_id) || [];
    formulaConcepts.push(concept);
    symbolConceptsByFormula.set(concept.formula_id, formulaConcepts);
    symbolConceptByFormulaSymbolRole.set(`${concept.formula_id}:${concept.symbol}:${concept.role}`, concept);
    if (concept.role === 'defined') {
      const list = definedByFormula.get(concept.formula_id) || [];
      list.push(concept);
      definedByFormula.set(concept.formula_id, list);
    }
  }

  const conceptViews = [];
  for (const formula of chapterDoc.formulas || []) {
    let currentConcepts = definedByFormula.get(formula.id) || [];
    if (!currentConcepts.length) {
      continue;
    }

    const dependency = dependencyById.get(formula.id);
    const prereqFormulaEdges = acceptedFormulaPrerequisites(dependency);
    const prereqFormulaIds = new Set(prereqFormulaEdges.map((item) => item.target_id));
    const prerequisiteConcepts = [];
    for (const prereq of prereqFormulaEdges) {
      const prereqFormula = formulaById.get(prereq.target_id);
      const concepts = definedByFormula.get(prereq.target_id) || [];
      for (const concept of concepts) {
        prerequisiteConcepts.push({
          concept_id: concept.concept_id,
          name: productConceptName(concept.concept_name, prereqFormula?.label || prereq.target_id, concept.symbol),
          defined_by_formula_id: concept.formula_id,
          from_formula_id: prereq.target_id,
          formula_label: prereqFormula?.label || prereq.target_id,
          symbol: concept.symbol,
          via_symbol: prereq.via_symbol || concept.symbol,
          clickable: true,
          confidence: prereq.confidence || concept.confidence || 0.76,
          relation: prereq.relation || 'formula_prerequisite',
          concept_type: concept.concept_type,
          definition: concept.definition,
          definition_zh: concept.definition_zh,
          teaching_move: concept.teaching_move,
          teaching_move_zh: concept.teaching_move_zh,
          source_sentence: concept.source_sentence,
          review_flags: concept.review_flags,
        });
      }
    }

    const prereqDefinedSymbols = new Set(
      [...prereqFormulaIds]
        .flatMap((formulaId) => formulaSymbols(formulaById.get(formulaId) || {}).defined),
    );
    const formulaSymbolSet = formulaSymbols(formula);
    const introducedConcepts = [];
    for (const symbol of formulaSymbolSet.used) {
      if (formulaSymbolSet.defined.includes(symbol)) continue;
      if (prereqDefinedSymbols.has(symbol)) continue;
      const concept = symbolConceptByFormulaSymbolRole.get(`${formula.id}:${symbol}:used`);
      if (!concept) continue;
      introducedConcepts.push({
        concept_id: concept.concept_id,
        name: productConceptName(concept.concept_name, formula.label, concept.symbol),
        symbol,
        defined_by_formula_id: null,
        formula_label: formula.label,
        clickable: false,
        confidence: concept.confidence,
        concept_type: concept.concept_type,
        definition: concept.definition,
        definition_zh: concept.definition_zh,
        teaching_move: concept.teaching_move,
        teaching_move_zh: concept.teaching_move_zh,
        source_sentence: concept.source_sentence,
        review_flags: concept.review_flags,
      });
    }

    const uniqueIntroducedConcepts = sortConceptReferencesForDisplay(dedupeConceptReferences(introducedConcepts));

    for (const current of currentConcepts) {
      const uniquePrerequisiteConcepts = sanitizePrerequisiteReferences(
        prerequisiteConcepts.map(asConceptPrerequisiteReference),
        current,
      );
      const prereqEdges = uniquePrerequisiteConcepts.map((concept) => ({
        from: conceptEdgeEndpoint(concept),
        to: conceptEdgeEndpoint(current),
        relation: 'prerequisite_for',
        derived_from_formula_edge: {
          from: concept.from_formula_id,
          to: formula.id,
          via_symbol: concept.via_symbol,
        },
        clickable: true,
        confidence: concept.confidence,
      }));
      const introducedEdges = uniqueIntroducedConcepts.map((concept) => ({
        from: conceptEdgeEndpoint(concept),
        to: conceptEdgeEndpoint(current),
        relation: 'introduced_for',
        symbol: concept.symbol,
        clickable: false,
        confidence: concept.confidence,
      }));
      conceptViews.push({
        chapter_id: chapterId,
        concept_id: current.concept_id,
        name: productConceptName(current.concept_name, formula.label, current.symbol),
        definition: current.definition,
        definition_zh: current.definition_zh,
        teaching_move: current.teaching_move,
        teaching_move_zh: current.teaching_move_zh,
        source_sentence: current.source_sentence,
        concept_type: current.concept_type,
        defined_by_formula_id: formula.id,
        defined_symbol: current.symbol,
        supporting_formula_label: formula.label,
        supporting_formula_latex: formula.latex,
        formula_position: formula.position,
        formula_section: formula.section,
        formula_subsection: formula.subsection,
        evidence: current.evidence,
        confidence: current.confidence,
        review_status: current.review_status,
        review_flags: current.review_flags,
        prerequisite_concepts: uniquePrerequisiteConcepts,
        introduced_concepts: uniqueIntroducedConcepts.slice(0, MAX_INTRODUCED_REFERENCES_PER_VIEW),
        edges: [...prereqEdges, ...introducedEdges],
      });
    }
  }

  const summary = {
    chapter_id: chapterId,
    formulas_processed: chapterDoc.formulas?.length || 0,
    symbol_concept_entries: symbolConcepts.length,
    unique_concepts: new Set(symbolConcepts.map((item) => item.concept_id)).size,
    concept_views: conceptViews.length,
    prerequisite_edges: conceptViews.reduce((sum, view) => sum + view.prerequisite_concepts.length, 0),
    introduced_edges: conceptViews.reduce((sum, view) => sum + view.introduced_concepts.length, 0),
    low_confidence_entries: symbolConcepts.filter((item) => item.confidence < 0.72).length,
    formula_edges_used: conceptViews.reduce((sum, view) => sum + view.prerequisite_concepts.length, 0),
  };

  return {
    chapter_id: chapterId,
    version: 1,
    generated_at: new Date().toISOString(),
    source: {
      formula_dependency_graph: `data/frontend/dependency/${chapterId}_dependencies.json`,
      symbol_sense_prompts: `data/frontend/symbol_sense/prompts/${chapterId}.jsonl`,
      structured_blocks: `data/structured/${chapterId}_*.json`,
      method: 'deterministic concept views from formula dependencies, formula-symbol maps, and structured block evidence',
    },
    summary,
    chapter_storyline: chapterStorylineFor(chapterId, chapterDoc.formulas || []),
    formulas: chapterDoc.formulas || [],
    dependencies: chapterDoc.dependencies || [],
    symbol_concepts: symbolConcepts,
    views: conceptViews,
  };
}

function symbolConceptLookup(symbolConcepts) {
  return {
    byStableKey: new Map(symbolConcepts.map((concept) => [symbolConceptStableKey(concept), concept])),
    byConceptId: new Map(symbolConcepts.map((concept) => [concept.concept_id, concept])),
  };
}

function reviewedConceptForView(view, lookup) {
  const defined = lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: view.chapter_id,
    formula_id: view.defined_by_formula_id,
    role: 'defined',
    symbol: view.defined_symbol,
  })) || lookup.byConceptId.get(view.concept_id);
  if (defined) return defined;
  const used = lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: view.chapter_id,
    formula_id: view.defined_by_formula_id,
    role: 'used',
    symbol: view.defined_symbol,
  }));
  if (used) return used;
  if (!isDependencyAnchorConceptId(view.concept_id)) return null;
  return lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: view.chapter_id,
    formula_id: view.defined_by_formula_id,
    role: 'used',
    symbol: view.defined_symbol,
  })) || null;
}

function reviewedConceptForReference(chapterId, formulaId, role, symbol, conceptId, lookup) {
  const concept = lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: chapterId,
    formula_id: formulaId,
    role,
    symbol,
  })) || lookup.byConceptId.get(conceptId);
  if (concept) return concept;
  if (role !== 'defined' || !isDependencyAnchorConceptId(conceptId)) return null;
  return lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: chapterId,
    formula_id: formulaId,
    role: 'used',
    symbol,
  })) || null;
}

function isDependencyAnchorConceptId(conceptId) {
  return String(conceptId || '').includes('_dependency_anchor_');
}

function applyConceptToReference(reference, concept, clickable) {
  const publicReference = sanitizePublicConceptReference(reference);
  if (!concept) {
    return {
      ...publicReference,
      clickable,
    };
  }
    const publicFlags = new Set(concept.review_flags || []);
    const rawPublicName = productConceptName(concept.concept_name, reference.formula_label || concept.formula_label, concept.symbol);
  const conceptForPublicName = {
    ...concept,
    name: rawPublicName,
    formula_label: reference.formula_label || concept.formula_label,
    supporting_formula_label: reference.formula_label || concept.formula_label,
    defined_by_formula_id: reference.defined_by_formula_id || reference.from_formula_id || concept.formula_id,
  };
  const publicName = canonicalMergePublicName(conceptForPublicName, concept.canonical_merge_basis)
    || publicPlaceholderConceptName(conceptForPublicName);
  if (publicName !== cleanPublicConceptText(rawPublicName)) publicFlags.add('generic_defined_concept_name');
  const publicStatus = publicReviewStatus(concept.review_status || 'unreviewed', [...publicFlags]);
  const publicDefinition = productDefinitionForConcept({ ...concept, name: publicName, review_flags: [...publicFlags] }, concept.definition, concept.source_sentence, publicReference.definition);
  const publicDefinitionZh = productDefinitionZhForConcept(
    { ...concept, name: publicName, review_flags: [...publicFlags], review_status: publicStatus },
    concept.definition_zh,
    publicDefinition,
    concept.source_sentence,
    publicReference.definition_zh,
  );
  return {
    ...publicReference,
    name: publicName,
    ...defaultCanonicalMetadata({
      ...concept,
      name: publicName,
      canonical_concept_name: publicName,
    }),
    symbol: cleanPublicConceptText(concept.symbol || reference.symbol),
    clickable,
    confidence: concept.confidence,
    concept_type: concept.concept_type,
    canonical_sense_id: concept.canonical_sense_id,
    canonical_merge_basis: concept.canonical_merge_basis,
    definition: publicDefinition,
    definition_zh: publicDefinitionZh,
    source_sentence: cleanPublicConceptText(concept.source_sentence || publicReference.source_sentence || ''),
    review_status: publicStatus,
    review_flags: Array.from(publicFlags),
  };
}

function sanitizePublicConceptReference(reference) {
  if (!reference) return reference;
  const {
    review_flags: reviewFlags,
    review_status: reviewStatus,
    canonical_sense_id: _canonicalSenseId,
    canonical_merge_basis: canonicalMergeBasis,
    teaching_move: _teachingMove,
    teaching_move_zh: _teachingMoveZh,
    source_sentence: sourceSentence,
    extraction_model: _extractionModel,
    ...publicReference
  } = reference;
  const cleanReference = cleanPublicConceptFields(publicReference);
  const publicFlags = new Set(reviewFlags || []);
  const originalName = cleanPublicConceptText(cleanReference.name || cleanReference.concept_name || cleanReference.title || '');
  const publicName = canonicalMergePublicName(cleanReference, canonicalMergeBasis) || publicPlaceholderConceptName(cleanReference);
  if (publicName !== originalName) publicFlags.add('generic_defined_concept_name');
  cleanReference.name = publicName;
  cleanReference.canonical_concept_name = publicName;
  const publicStatus = publicReviewStatus(reviewStatus || cleanReference.review_status || 'unreviewed', [...publicFlags]);
  cleanReference.definition = productDefinitionForConcept(cleanReference, cleanReference.definition, sourceSentence);
  cleanReference.definition_zh = productDefinitionZhForConcept(cleanReference, cleanReference.definition_zh, cleanReference.definition, sourceSentence);
  return {
    ...cleanReference,
    ...defaultCanonicalMetadata(cleanReference),
    source_sentence: cleanPublicConceptText(sourceSentence || ''),
    review_status: publicStatus,
    review_flags: Array.from(publicFlags),
    ...(Array.isArray(publicReference.prerequisite_concepts)
      ? { prerequisite_concepts: publicReference.prerequisite_concepts.map(sanitizePublicConceptReference) }
      : {}),
    ...(Array.isArray(publicReference.introduced_concepts)
      ? { introduced_concepts: publicReference.introduced_concepts.map(sanitizePublicConceptReference) }
      : {}),
    ...(Array.isArray(publicReference.successor_concepts)
      ? { successor_concepts: publicReference.successor_concepts.map(sanitizePublicConceptReference) }
      : {}),
  };
}

function sanitizeConceptViewForProduct(view) {
  const {
    review_flags: reviewFlags,
    review_status: reviewStatus,
    canonical_sense_id: _canonicalSenseId,
    canonical_merge_basis: canonicalMergeBasis,
    symbol_concepts: _symbolConcepts,
    teaching_move: _teachingMove,
    teaching_move_zh: _teachingMoveZh,
    source_sentence: sourceSentence,
    extraction_model: _extractionModel,
    evidence,
    ...publicView
  } = view;
  const cleanView = cleanPublicConceptFields(publicView);
  const publicFlags = new Set(reviewFlags || []);
  const originalName = cleanPublicConceptText(cleanView.name || cleanView.concept_name || cleanView.title || '');
  const publicName = canonicalMergePublicName(cleanView, canonicalMergeBasis) || publicPlaceholderConceptName(cleanView);
  if (publicName !== originalName) publicFlags.add('generic_defined_concept_name');
  cleanView.name = publicName;
  cleanView.canonical_concept_name = publicName;
  const publicStatus = publicReviewStatus(reviewStatus || cleanView.review_status || 'unreviewed', [...publicFlags]);
  cleanView.definition = productDefinitionForConcept(cleanView, cleanView.definition, sourceSentence, firstEvidenceSentence(evidence));
  cleanView.definition_zh = productDefinitionZhForConcept(cleanView, cleanView.definition_zh, cleanView.definition, sourceSentence, firstEvidenceSentence(evidence));
  return {
    ...cleanView,
    ...defaultCanonicalMetadata(cleanView),
    source_sentence: cleanPublicConceptText(sourceSentence || ''),
    review_status: publicStatus,
    review_flags: Array.from(publicFlags),
    evidence: sanitizePublicEvidence(evidence || []),
  };
}

function sanitizePublicConceptView(view) {
  const publicView = sanitizeConceptViewForProduct(view);
  return {
    ...publicView,
    prerequisite_concepts: sanitizePrerequisiteReferences(
      (view.prerequisite_concepts || []).map(sanitizePublicConceptReference),
      publicView,
    ),
    successor_concepts: sortConceptReferencesForDisplay(dedupeConceptReferencesByDisplay(
      (view.successor_concepts || []).map(sanitizePublicConceptReference),
    )),
    introduced_concepts: sortConceptReferencesForDisplay(dedupeConceptReferencesByDisplay(
      (view.introduced_concepts || []).map(sanitizePublicConceptReference),
    )).slice(0, MAX_INTRODUCED_REFERENCES_PER_VIEW),
  };
}

function sanitizePublicConceptGraph(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicConceptGraph);
  if (!value || typeof value !== 'object') return value;

  const cleaned = { ...value };
  if (typeof cleaned.definition_zh === 'string' && !containsChinese(cleaned.definition_zh)) {
    cleaned.definition_zh = productDefinitionZhForConcept(cleaned, cleaned.definition_zh, cleaned.definition);
  }
  if (typeof cleaned.definition_zh === 'string' && cleaned.definition_zh.includes('解读尚在审核中')) {
    cleaned.definition_zh = productDefinitionZhForConcept({ ...cleaned, definition_zh: '' }, '', cleaned.definition);
  }
  for (const [key, child] of Object.entries(cleaned)) {
    if (child && typeof child === 'object') cleaned[key] = sanitizePublicConceptGraph(child);
  }
  return cleaned;
}

function sanitizePublicEvidence(evidence) {
  return (evidence || []).map((item) => {
    const {
      sentence,
      teaching_move: _teachingMove,
      teaching_move_zh: _teachingMoveZh,
      source_sentence: sourceSentence,
      ...publicEvidence
    } = item;
    return {
      ...publicEvidence,
      sentence: cleanPublicConceptText(sentence || sourceSentence || ''),
    };
  });
}

function attachNestedConceptReferences(views) {
  const byConceptId = new Map((views || []).map((view) => [view.concept_id, view]));
  const enrichReference = (reference) => {
    const nestedView = byConceptId.get(reference.concept_id);
    if (!nestedView) return reference;
    return {
      ...reference,
      prerequisite_concepts: sanitizePrerequisiteReferences(nestedView.prerequisite_concepts || [], nestedView)
        .slice(0, 6)
        .map(sanitizePublicConceptReference),
      introduced_concepts: filterProductConceptReferences(nestedView.introduced_concepts || [])
        .filter((item) => !isSameConceptMeaning(item, nestedView))
        .slice(0, 4)
        .map(sanitizePublicConceptReference),
    };
  };
  return (views || []).map((view) => ({
    ...view,
    prerequisite_concepts: (view.prerequisite_concepts || []).map(enrichReference),
  }));
}

function firstEvidenceSentence(evidence) {
  return (evidence || []).map((item) => item?.sentence).find(Boolean) || '';
}

function isTemplateDefinitionText(value = '') {
  const text = normalizeSpaces(value);
  if (!text) return true;
  if (definitionLooksFallback(text)) return true;
  if (isMechanicalReadableName(text)) return true;
  if (/(?:\[formula\]|\b(?:frac|left|right|leq|quad|bigg|mathrm)\b|^[A-Z]apter\b|^[A-Za-z]\s*=)/i.test(text)) return true;
  return /(?:is a supporting quantity in this equation|is the main quantity to read from this equation|right-hand side shows|names the biological object|operation or transformation rule used by the equation|model parameter conventionally denoted|is a coefficient or parameter attached|local context|是这条公式要读出的核心量|表示本式讨论的生物学对象或模型条件|表示本式中的运算或转换规则|是本式中的辅助量|是调节关系强弱或方向的参数)/i.test(text);
}

function evidenceDefinitionSentence(...candidates) {
  for (const candidate of candidates) {
    const sentence = cleanDefinition(stripLatex(candidate), '');
    if (usefulDefinitionSentence(sentence)) return sentence;
  }
  return '';
}

function productDefinition(definition, ...evidenceCandidates) {
  const clean = cleanPublicConceptText(definition);
  if (clean && !isTemplateDefinitionText(clean)) return clean;
  return evidenceDefinitionSentence(...evidenceCandidates) || '';
}

function containsChinese(value = '') {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function productDefinitionZhForConcept(value, definitionZh, definition, ...evidenceCandidates) {
  const cleanZh = cleanPublicConceptText(definitionZh);
  if (cleanZh && containsChinese(cleanZh) && !isTemplateDefinitionText(cleanZh)) return cleanZh;
  const name = cleanPublicConceptText(value?.name || value?.concept_name || value?.title || value?.canonical_concept_name || '');
  const stable = CONCEPT_DEFINITIONS_ZH.get(name.toLowerCase());
  if (stable && containsChinese(stable)) return stable;
  const english = productDefinition(definition, ...evidenceCandidates);
  if (containsChinese(english) && !isTemplateDefinitionText(english)) return english;
  return conceptDefinitionZh(name || '这个概念', value?.role || 'defined', value?.concept_type || '');
}

function publicDefinitionFallback(name, conceptType = '') {
  const cleanName = cleanPublicConceptText(name);
  const key = cleanName.toLowerCase();
  if (!cleanName) return '';
  const stable = CONCEPT_DEFINITIONS.get(key);
  if (stable) return stable;
  if (/^(?:alpha|beta|gamma|theta|lambda|kappa|tau|phi|psi|omega)$/i.test(cleanName)) {
    return `${cleanName} is a Greek-letter model quantity whose interpretation is determined by the equation family and nearby variables.`;
  }
  if (/likelihood|density|probability|expectation|expected/i.test(cleanName)) {
    return `${cleanName} is a probabilistic quantity used to summarize likelihood, chance, or expected value under the model.`;
  }
  if (/variance|sigma|covariance|correlation|deviation/i.test(cleanName)) {
    return `${cleanName} describes dispersion or joint movement among the modeled variables.`;
  }
  if (/change|response|differential/i.test(cleanName)) {
    return `${cleanName} measures a shift in the modeled quantity between states, generations, or comparison groups.`;
  }
  if (/mean|time|rate|coefficient|gradient|parameter|effect|component/i.test(cleanName)) {
    return `${cleanName} is a named model quantity used to compare the relevant biological or statistical process.`;
  }
  if (conceptType === 'math_concept' || /relation|matrix|operator|function|integral|cumulant/i.test(cleanName)) {
    return `${cleanName} is a mathematical object or relation used to transform, organize, or compare model quantities.`;
  }
  return `${cleanName} is a named concept used by this formula and its same-chapter dependencies.`;
}

function productDefinitionForConcept(value, definition, ...evidenceCandidates) {
  const clean = productDefinition(definition, ...evidenceCandidates);
  if (clean) return clean;
  return publicDefinitionFallback(value?.name || value?.concept_name || value?.title || value?.canonical_concept_name || '', value?.concept_type || '');
}

function isPublicReadyConceptReference(reference) {
  const name = normalizeSpaces(reference?.name || reference?.concept_name || reference?.title || '');
  if (!name) return false;
  if ((reference?.review_status || 'unreviewed') === 'rejected') return false;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(name.toLowerCase())) return false;
  if (isFormulaArtifactConcept(reference)) return false;
  const definition = productDefinition(reference?.definition, reference?.source_sentence);
  if (isTemplateDefinitionText(definition)) return false;
  return true;
}

function isPublicReadyConceptView(view) {
  const name = normalizeSpaces(view?.name || '');
  if (!name) return false;
  if ((view?.review_status || 'unreviewed') === 'rejected') return false;
  if (PRODUCT_GENERIC_CONCEPT_NAMES.has(name.toLowerCase())) return false;
  if (isFormulaArtifactConcept(view)) return false;
  return true;
}

function filterPublicReadyConceptViews(views) {
  return repairDanglingPrerequisiteReferences((views || []).filter(isPublicReadyConceptView));
}

function attachSuccessorConceptReferences(views) {
  const successorsById = new Map();
  for (const view of views || []) {
    for (const reference of view.prerequisite_concepts || []) {
      if (!reference.concept_id || reference.clickable === false) continue;
      const current = successorsById.get(reference.concept_id) || [];
      current.push(conceptReferenceFromProductView(view, 'successor_for', reference.confidence || view.confidence || 0.76));
      successorsById.set(reference.concept_id, current);
    }
  }
  return (views || []).map((view) => ({
    ...view,
    successor_concepts: sortConceptReferencesForDisplay(dedupeConceptReferences(successorsById.get(view.concept_id) || []))
      .slice(0, 8)
      .map(sanitizePublicConceptReference),
  }));
}

function conceptGraphSummary(chapterId, formulasProcessed, symbolConcepts, views) {
  return {
    chapter_id: chapterId,
    formulas_processed: formulasProcessed,
    symbol_concept_entries: symbolConcepts.length,
    unique_concepts: new Set(symbolConcepts.map((item) => item.concept_id)).size,
    concept_views: views.length,
    prerequisite_edges: views.reduce((sum, view) => sum + view.prerequisite_concepts.length, 0),
    introduced_edges: views.reduce((sum, view) => sum + view.introduced_concepts.length, 0),
    low_confidence_entries: symbolConcepts.filter((item) => item.confidence < 0.72).length,
    formula_edges_used: views.reduce((sum, view) => sum + view.prerequisite_concepts.length, 0),
  };
}

function applySymbolConceptsToGraph(conceptGraph, symbolConcepts) {
  const lookup = symbolConceptLookup(symbolConcepts);
  const views = [];

  for (const view of conceptGraph.views || []) {
    const current = reviewedConceptForView(view, lookup);
    if ((current?.review_status || 'unreviewed') === 'rejected') continue;

    const updatedView = current
      ? {
          ...view,
          concept_id: current.concept_id,
          name: productConceptName(current.concept_name, view.supporting_formula_label, current.symbol),
          definition: current.definition,
          definition_zh: current.definition_zh,
          teaching_move: current.teaching_move,
          teaching_move_zh: current.teaching_move_zh,
          source_sentence: current.source_sentence,
          concept_type: current.concept_type,
          canonical_concept_id: current.canonical_concept_id,
          canonical_concept_name: current.canonical_concept_name,
          canonical_sense_id: current.canonical_sense_id,
          canonical_merge_basis: current.canonical_merge_basis,
          defined_symbol: current.symbol,
          evidence: current.evidence,
          confidence: current.confidence,
          review_status: current.review_status,
          review_flags: current.review_flags,
        }
      : view;
    if (isFormulaArtifactConcept(updatedView)) continue;

    const prerequisiteConcepts = [];
    for (const reference of filterRealConceptReferences(view.prerequisite_concepts)) {
      const concept = reviewedConceptForReference(
        view.chapter_id,
        reference.defined_by_formula_id || reference.from_formula_id,
        'defined',
        reference.symbol || reference.via_symbol,
        reference.concept_id,
        lookup,
      );
      prerequisiteConcepts.push(asConceptPrerequisiteReference(applyConceptToReference(reference, concept, true)));
    }

    const introducedConcepts = [];
    for (const reference of filterProductConceptReferences(view.introduced_concepts)) {
      const concept = reviewedConceptForReference(
        view.chapter_id,
        view.defined_by_formula_id,
        'used',
        reference.symbol,
        reference.concept_id,
        lookup,
      );
      introducedConcepts.push(applyConceptToReference(reference, concept, false));
    }

    const uniquePrerequisiteConcepts = sanitizePrerequisiteReferences(prerequisiteConcepts, updatedView);
    const uniqueIntroducedConcepts = sortConceptReferencesForDisplay(dedupeConceptReferences(
      filterProductConceptReferences(introducedConcepts)
        .filter((concept) => !isSameConceptReference(concept, updatedView))
        .filter((concept) => !isSameConceptMeaning(concept, updatedView)),
    ));

    const prerequisiteEdges = uniquePrerequisiteConcepts.map((concept) => ({
      from: conceptEdgeEndpoint(concept),
      to: conceptEdgeEndpoint(updatedView),
      relation: 'prerequisite_for',
      derived_from_formula_edge: {
        from: concept.from_formula_id,
        to: updatedView.defined_by_formula_id,
        via_symbol: concept.via_symbol,
      },
      clickable: true,
      confidence: concept.confidence,
    }));
    const introducedEdges = uniqueIntroducedConcepts.map((concept) => ({
      from: conceptEdgeEndpoint(concept),
      to: conceptEdgeEndpoint(updatedView),
      relation: 'introduced_for',
      symbol: concept.symbol,
      clickable: false,
      confidence: concept.confidence,
    }));

    views.push({
      ...sanitizeConceptViewForProduct(updatedView),
      prerequisite_concepts: uniquePrerequisiteConcepts.map(sanitizePublicConceptReference),
      introduced_concepts: uniqueIntroducedConcepts.map(sanitizePublicConceptReference),
      edges: [...prerequisiteEdges, ...introducedEdges],
    });
  }

  const seededViews = addMissingDependencyAnchorViews(
    dedupeConceptViewsById(views),
    conceptGraph,
    symbolConcepts,
  );
  const strengthenedViews = strengthenConceptPrerequisites(addInferredConceptPrerequisites(seededViews));
  const withFilledPrerequisites = fillEmptyFormulaDependencyPrerequisites(
    strengthenedViews,
    conceptGraph.dependencies || [],
  );
  const publicReadyViews = addReviewedUsedConceptViews(
    filterPublicReadyConceptViews(repairDanglingPrerequisiteReferences(withFilledPrerequisites)),
    conceptGraph,
    symbolConcepts,
  );
  const publicReadyWithAnchors = addMissingDependencyAnchorViews(
    publicReadyViews,
    conceptGraph,
    symbolConcepts,
  );
  const finalViews = addCuratedPublicConceptPrerequisites(
    finalizeConceptViewStructure(publicReadyWithAnchors, conceptGraph.dependencies || []),
  );
  const publicIdentityViews = finalizeConceptViewStructure(
    mergeCanonicalConceptViews(applyPublicConceptIdentity(finalViews)),
    [],
  );
  const publicConceptViews = addContextualLineagePrerequisites(addFormulaCoverageViews(
    addCuratedPublicConceptPrerequisites(publicIdentityViews),
    conceptGraph,
  ));
  const cleanedPublicConceptViews = finalizeConceptViewStructure(mergeCanonicalConceptViews(publicConceptViews), []);
  const curatedPublicConceptViews = addCuratedPublicConceptPrerequisites(cleanedPublicConceptViews);
  const finalPublicViews = addFinalCuratedPublicConceptPrerequisites(
    attachSuccessorConceptReferences(attachNestedConceptReferences(curatedPublicConceptViews))
    .map(sanitizePublicConceptView)
    .map(sanitizePublicConceptGraph),
  );

  return {
    ...conceptGraph,
    formulas: undefined,
    source: {
      ...conceptGraph.source,
      method: 'concept views from formula dependencies, formula-symbol maps, and structured evidence',
    },
    summary: conceptGraphSummary(
      conceptGraph.chapter_id,
      conceptGraph.summary.formulas_processed,
      symbolConcepts,
      finalPublicViews,
    ),
    dependencies: undefined,
    symbol_concepts: undefined,
    views: finalPublicViews,
  };
}


async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(REVIEW_OUTPUT_DIR, { recursive: true });
  const dependencyFiles = (await readdir(DEPENDENCY_DIR)).filter((file) => file.endsWith('_dependencies.json')).sort();
  const index = {
    version: 1,
    generated_at: new Date().toISOString(),
    chapters: [],
  };

  for (const file of dependencyFiles) {
    const chapterDoc = JSON.parse(await readFile(resolve(DEPENDENCY_DIR, file), 'utf8'));
    const promptMap = await nearbyPromptMap(chapterDoc.chapter_id);
    const structuredBlocks = await structuredBlocksForChapter(chapterDoc.chapter_id);
    const generatedConceptGraph = buildChapterConceptGraph(chapterDoc, promptMap, structuredBlocks);
    const symbolConceptMapPath = resolve(REVIEW_OUTPUT_DIR, `${chapterDoc.chapter_id}${SYMBOL_CONCEPT_MAP_SUFFIX}`);
    const reviewedSymbolConceptMap = await readJsonIfExists(symbolConceptMapPath);
    const symbolConcepts = applySymbolSenseClusterCanonicalConcepts(
      applyConceptCalibrations(
        mergeReviewedSymbolConcepts(
          appendMissingCalibratedConcepts(generatedConceptGraph.symbol_concepts, chapterDoc, promptMap, structuredBlocks),
          reviewedSymbolConceptMap,
        ),
      ),
      chapterDoc,
    );
    const symbolConceptMap = buildSymbolConceptMapPayload(
      chapterDoc.chapter_id,
      symbolConcepts,
      generatedConceptGraph.source,
      generatedConceptGraph.generated_at,
    );
    const conceptGraph = applySymbolConceptsToGraph(generatedConceptGraph, symbolConceptMap.symbol_concepts);
    await writeFile(symbolConceptMapPath, `${JSON.stringify(symbolConceptMap, null, 2)}\n`, 'utf8');
    await writeFile(resolve(OUTPUT_DIR, `${chapterDoc.chapter_id}_concept_graph.json`), `${JSON.stringify(conceptGraph, null, 2)}\n`, 'utf8');
    index.chapters.push({
      chapter_id: chapterDoc.chapter_id,
      file: `${chapterDoc.chapter_id}_concept_graph.json`,
      ...conceptGraph.summary,
    });
  }

  index.summary = {
    chapters: index.chapters.length,
    formulas_processed: index.chapters.reduce((sum, item) => sum + item.formulas_processed, 0),
    symbol_concept_entries: index.chapters.reduce((sum, item) => sum + item.symbol_concept_entries, 0),
    concept_views: index.chapters.reduce((sum, item) => sum + item.concept_views, 0),
    prerequisite_edges: index.chapters.reduce((sum, item) => sum + item.prerequisite_edges, 0),
    introduced_edges: index.chapters.reduce((sum, item) => sum + item.introduced_edges, 0),
  };
  await writeFile(resolve(OUTPUT_DIR, 'concept_graph_index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`Generated concept graphs for ${index.chapters.length} chapters in ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
