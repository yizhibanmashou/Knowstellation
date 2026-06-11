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
  if (conceptType === 'operator_or_function') return `${name} 负责把括号里的输入量转换成公式要使用的输出量，先按“运算规则”来理解。`;
  if (conceptType === 'math_concept') return `${name} 是这条公式借用的数学工具，用来把多个数量整理成更容易比较或计算的形式。`;
  if (conceptType === 'domain_concept') return `${name} 帮你把符号放回模型语境中：它标记的是公式正在描述的对象、类别或条件。`;
  if (role === 'defined') return `${name} 是这条公式要读出的核心量；等号右侧说明它由哪些条件和符号共同决定。`;
  return `${name} 是这条公式里的辅助符号，读公式时先看它和左侧核心量之间的关系。`;
}

function conceptDefinitionEn(name, role, conceptType) {
  const key = normalizeSpaces(name).toLowerCase();
  const stable = CONCEPT_DEFINITIONS.get(key);
  if (stable) return stable;
  if (conceptType === 'operator_or_function') return `${name} is the operation that turns the input terms into the output used by the equation.`;
  if (conceptType === 'math_concept') return `${name} is a mathematical tool the equation uses to organize, transform, or compare quantities.`;
  if (conceptType === 'domain_concept') return `${name} places the symbol back in the model context: it marks the object, class, or condition being described.`;
  if (role === 'defined') return `${name} is the main quantity to read from this equation; the right-hand side shows which terms determine it.`;
  return `${name} is a supporting symbol in this equation; read it through its relationship to the main quantity.`;
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
  value = value.replace(/\\widehat\{\\boldsymbol\{([^{}]+)\}\}/g, '$1 estimator vector');
  value = value.replace(/\\boldsymbol\{([^{}]+)\}/g, '$1 vector');
  value = value.replace(/\\mathbf\{([^{}]+)\}/g, '$1 matrix');
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
  const clean = normalizeSpaces(symbol);
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
    if (!normalized || isIgnoredSymbol(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function isIgnoredSymbol(symbol) {
  const compact = String(symbol || '').replace(/\s+/g, '');
  const commandName = compact.replace(/^\\/, '').replace(/\{.*$/u, '');
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

function evidenceFor(formula, promptRecord, structuredEvidence) {
  const teachingMove = conceptTeachingMoveFromContext(formulaContext(formula, promptRecord));
  const fallback = {
    chunk_id: promptRecord?.formula_id || formula.id,
    block_index: formula.position ?? 0,
    block_type: formula.context_text ? 'derivation' : 'formula',
    sentence: teachingMove?.source_sentence,
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
  const stableDefinition = CONCEPT_DEFINITIONS.get(name.toLowerCase());
  const conceptType = conceptTypeFor(symbol, role, context);
  const fallback = stableDefinition || conceptDefinitionEn(name, role, conceptType);
  const definition = cleanDefinition(stableDefinition ? '' : usefulDefinitionSentence(definitionSource) ? definitionSource : '', fallback);
  const confidence = confidenceFor(symbol, formula, promptRecord, role, structuredEvidence);
  const teachingMove = conceptTeachingMoveFromContext(context);
  return {
    chapter_id: chapterId,
    formula_id: formula.id,
    formula_label: formula.label,
    symbol,
    role,
    concept_id: conceptId(chapterId, formula.id, symbol, role),
    concept_name: name,
    concept_type: conceptType,
    definition,
    definition_zh: conceptDefinitionZh(name, role, conceptType),
    teaching_move: teachingMove?.teaching_move,
    teaching_move_zh: teachingMove?.teaching_move_zh,
    source_sentence: teachingMove?.source_sentence,
    aliases: Array.from(new Set([symbol, readableSymbol(symbol), name])).filter(Boolean),
    evidence: evidenceFor(formula, promptRecord, structuredEvidence),
    confidence,
    review_status: 'unreviewed',
    review_flags: confidence < 0.72 ? ['needs_review'] : [],
    extraction_model: 'deterministic_formula_structured_context_v2',
  };
}

function symbolConceptStableKey(concept) {
  return [
    concept.chapter_id || '',
    concept.formula_id || '',
    concept.role || '',
    concept.symbol || '',
  ].join('::');
}

function valuesDiffer(left, right) {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
}

function hasReviewWork(generated, reviewed) {
  const status = reviewed.review_status || 'unreviewed';
  if (status && status !== 'unreviewed') return true;
  if (reviewed.reviewed_by || reviewed.reviewed_at || reviewed.review_notes) return true;
  if (reviewed.canonical_concept_id || reviewed.canonical_concept_name) return true;
  return REVIEW_PRESERVED_FIELDS.some((field) => (
    reviewed[field] !== undefined && valuesDiffer(reviewed[field], generated[field])
  ));
}

function mergeReviewedSymbolConcepts(generatedConcepts, reviewedPayload) {
  if (!reviewedPayload?.symbol_concepts?.length) return generatedConcepts;
  const byStableKey = new Map();
  const byConceptId = new Map();
  for (const concept of reviewedPayload.symbol_concepts) {
    byStableKey.set(symbolConceptStableKey(concept), concept);
    if (concept.concept_id) byConceptId.set(concept.concept_id, concept);
  }
  return generatedConcepts.map((generated) => {
    const reviewed = byStableKey.get(symbolConceptStableKey(generated)) || byConceptId.get(generated.concept_id);
    if (!reviewed || !hasReviewWork(generated, reviewed)) return generated;
    const preserved = {};
    for (const field of REVIEW_PRESERVED_FIELDS) {
      if (reviewed[field] !== undefined) preserved[field] = reviewed[field];
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
    if (!curated) return concept;
    const { review_notes, ...updates } = curated;
    return {
      ...concept,
      ...updates,
    };
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
  const cleanName = normalizeSpaces(name || '');
  const cleanFormulaLabel = normalizeSpaces(formulaLabel || '');
  if (!cleanName) return cleanFormulaLabel ? `${cleanFormulaLabel} Concept` : 'Formula Concept';
  if (/^formula\s+.+\s+result$/i.test(cleanName)) return `${cleanFormulaLabel || cleanName.replace(/\s+Result$/i, '')} Concept`;
  if (!PRODUCT_GENERIC_CONCEPT_NAMES.has(cleanName.toLowerCase())) return cleanName;
  return `${cleanFormulaLabel || 'Formula'} ${cleanName}`;
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

function sortConceptReferencesForDisplay(references) {
  return references
    .map((reference, index) => ({ reference, score: conceptReferenceDisplayScore(reference, index) }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.reference);
}

function reviewStatusCounts(symbolConcepts) {
  return symbolConcepts.reduce((counts, concept) => {
    const status = REVIEW_STATUSES.includes(concept.review_status) ? concept.review_status : 'unreviewed';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function symbolConceptMapSummary(chapterId, symbolConcepts) {
  const status_counts = reviewStatusCounts(symbolConcepts);
  const reviewed_entries = symbolConcepts.filter((item) => (item.review_status || 'unreviewed') !== 'unreviewed').length;
  return {
    chapter_id: chapterId,
    symbol_concept_entries: symbolConcepts.length,
    unique_concepts: new Set(symbolConcepts.map((item) => item.concept_id)).size,
    low_confidence_entries: symbolConcepts.filter((item) => item.confidence < 0.72).length,
    reviewed_entries,
    unreviewed_entries: symbolConcepts.length - reviewed_entries,
    status_counts,
  };
}

function buildSymbolConceptMapPayload(chapterId, symbolConcepts, source, generatedAt) {
  return {
    chapter_id: chapterId,
    version: 1,
    generated_at: generatedAt,
    source: {
      ...source,
      method: 'reviewable symbol-concept map seeded from formula dependencies, formula-symbol maps, and structured block evidence',
    },
    summary: symbolConceptMapSummary(chapterId, symbolConcepts),
    symbol_concepts: symbolConcepts,
  };
}

function conceptDedupKey(concept) {
  const name = normalizeSpaces(concept.name || concept.concept_name || '').toLowerCase();
  const symbol = baseSymbol(concept.symbol || concept.via_symbol || '').toLowerCase();
  return `${name}:${symbol}`;
}

function mergeConceptReference(existing, incoming) {
  return {
    ...existing,
    definition: existing.definition || incoming.definition,
    definition_zh: existing.definition_zh || incoming.definition_zh,
    teaching_move: existing.teaching_move || incoming.teaching_move,
    teaching_move_zh: existing.teaching_move_zh || incoming.teaching_move_zh,
    source_sentence: existing.source_sentence || incoming.source_sentence,
    confidence: Math.max(existing.confidence || 0, incoming.confidence || 0),
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

function lhsFunctionArguments(latex) {
  const lhs = String(latex || '').split('=')[0] || '';
  const match = lhs.match(/^\s*[\\A-Za-z][\\A-Za-z0-9_{}^]*\s*\(([^)]*)\)/);
  if (!match) return new Set();
  return new Set(match[1].split(',').map((item) => normalizeSpaces(item)).filter(Boolean));
}

function lhsFunctionName(latex) {
  const lhs = String(latex || '').split('=')[0] || '';
  const match = lhs.match(/^\s*([\\A-Za-z][\\A-Za-z0-9_{}^]*)\s*\(/);
  return normalizeSpaces(match?.[1] || '');
}

function lhsNamedStatistic(latex) {
  const lhs = String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '';
  const match = lhs.match(/^\s*([A-Za-z][A-Za-z0-9]{1,8})\s*$/);
  return match?.[1] || '';
}

function lhsPrimarySymbol(latex) {
  const lhs = String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '';
  const normalized = normalizeSpaces(lhs);
  if (!normalized || /[+\-*/(),]/.test(stripLatex(normalized))) return '';
  if (!/^[\\A-Za-z]/.test(normalized)) return '';
  if (/(?:\\sum|\\prod|\\int|\\frac|\\sqrt|\\left|\\right)/.test(normalized)) return '';
  return normalized;
}

function lhsIsExpression(latex) {
  const lhs = normalizeSpaces(String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '');
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
  const lhs = normalizeSpaces(String(latex || '')
    .replace(/\\begin\{[^{}]+\}/g, '')
    .replace(/\\end\{[^{}]+\}/g, '')
    .split('=')[0] || '');
  if (/^\\frac\{H_\{?h\}?\}\{H_\{?0\}?\}$/.test(lhs)) return '\\frac{H_{h}}{H_{0}}';
  if (/^\\frac\{\\pi\}\{\\pi_\{?0\}?\}$/.test(lhs)) return '\\frac{\\pi}{\\pi_{0}}';
  return '';
}

function symbolKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function isSplitFromWholeSymbol(symbol, whole) {
  const symbolValue = symbolKey(symbol);
  const wholeValue = symbolKey(whole);
  return Boolean(/^[A-Z]$/.test(symbolValue) && wholeValue && wholeValue.includes(symbolValue));
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
  if (functionName) {
    defined = uniqueFormulaSymbols([functionName]);
  }
  if (lhsPrimary && (lhsPrimary.includes('_') || /\\(?:widehat|hat|overline|bar)/.test(lhsPrimary))) {
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

function buildChapterConceptGraph(chapterDoc, promptMap, structuredBlocks) {
  const chapterId = chapterDoc.chapter_id;
  const formulaById = new Map((chapterDoc.formulas || []).map((formula) => [formula.id, formula]));
  const dependencyById = new Map((chapterDoc.dependencies || []).map((dependency) => [dependency.dependent_id, dependency]));
  const symbolConcepts = [];
  const definedByFormula = new Map();
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
      symbolConceptByFormulaSymbolRole.set(`${formula.id}:${item.symbol}:${item.role}`, concept);
      if (item.role === 'defined') {
        const list = definedByFormula.get(formula.id) || [];
        list.push(concept);
        definedByFormula.set(formula.id, list);
      }
    }
  }

  for (const missingConcept of missingCalibratedConceptEntries(symbolConcepts, chapterDoc, promptMap, structuredBlocks)) {
    const concept = registerConcept(missingConcept);
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
      const promptRecord = promptMap.get(formula.id);
      const structuredEvidence = bestStructuredEvidence(formula, formula.label, formula.label, structuredBlocks);
      const teachingMove = conceptTeachingMoveFromContext(formulaContext(formula, promptRecord));
      currentConcepts = [registerConcept({
        chapter_id: chapterId,
        formula_id: formula.id,
        formula_label: formula.label,
        symbol: formula.label,
        role: 'defined',
        concept_id: `concept_${chapterId}_${slug(formula.id)}_statement`,
        concept_name: `${formula.label} Relationship`,
        concept_type: 'theorem_or_principle',
        definition: cleanDefinition(
          structuredEvidence?.sentence || sentenceWindow(`${promptRecord?.nearby_text || ''} ${formula.context_text || ''}`, formula.label),
          `${formula.label} relationship.`,
        ),
        definition_zh: '这条关系式把左侧目标量和右侧条件连接起来，适合作为理解本公式符号关系的起点。',
        teaching_move: teachingMove?.teaching_move,
        teaching_move_zh: teachingMove?.teaching_move_zh,
        source_sentence: teachingMove?.source_sentence,
        aliases: [formula.label],
        evidence: evidenceFor(formula, promptRecord, structuredEvidence),
        confidence: structuredEvidence ? 0.68 : 0.62,
        review_status: 'unreviewed',
        review_flags: ['derived_from_formula_without_defined_symbol'],
        extraction_model: 'deterministic_formula_context_v1',
      })];
      definedByFormula.set(formula.id, currentConcepts);
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

    const uniquePrerequisiteConcepts = dedupeConceptReferences(prerequisiteConcepts);
    const uniqueIntroducedConcepts = sortConceptReferencesForDisplay(dedupeConceptReferences(introducedConcepts));

    for (const current of currentConcepts) {
      const prereqEdges = uniquePrerequisiteConcepts.map((concept) => ({
        from: concept.concept_id,
        to: current.concept_id,
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
        from: concept.concept_id,
        to: current.concept_id,
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
        introduced_concepts: uniqueIntroducedConcepts.slice(0, 10),
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
  return lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: view.chapter_id,
    formula_id: view.defined_by_formula_id,
    role: 'defined',
    symbol: view.defined_symbol,
  })) || lookup.byConceptId.get(view.concept_id);
}

function reviewedConceptForReference(chapterId, formulaId, role, symbol, conceptId, lookup) {
  return lookup.byStableKey.get(symbolConceptStableKey({
    chapter_id: chapterId,
    formula_id: formulaId,
    role,
    symbol,
  })) || lookup.byConceptId.get(conceptId);
}

function applyConceptToReference(reference, concept, clickable) {
  const publicReference = sanitizePublicConceptReference(reference);
  if (!concept) {
    return {
      ...publicReference,
      clickable,
    };
  }
  return {
    ...publicReference,
    concept_id: concept.concept_id,
    name: productConceptName(concept.concept_name, reference.formula_label || concept.formula_label, concept.symbol),
    symbol: concept.symbol || reference.symbol,
    clickable,
    confidence: concept.confidence,
    concept_type: concept.concept_type,
    definition: concept.definition,
    definition_zh: concept.definition_zh,
  };
}

function sanitizePublicConceptReference(reference) {
  if (!reference) return reference;
  const {
    review_flags: _reviewFlags,
    review_status: _reviewStatus,
    teaching_move: _teachingMove,
    teaching_move_zh: _teachingMoveZh,
    source_sentence: _sourceSentence,
    extraction_model: _extractionModel,
    ...publicReference
  } = reference;
  return publicReference;
}

function sanitizeConceptViewForProduct(view) {
  const {
    review_flags: _reviewFlags,
    review_status: _reviewStatus,
    symbol_concepts: _symbolConcepts,
    teaching_move: _teachingMove,
    teaching_move_zh: _teachingMoveZh,
    source_sentence: _sourceSentence,
    extraction_model: _extractionModel,
    evidence,
    ...publicView
  } = view;
  return {
    ...publicView,
    evidence: sanitizePublicEvidence(evidence || []),
  };
}

function sanitizePublicEvidence(evidence) {
  return (evidence || []).map((item) => {
    const {
      sentence: _sentence,
      teaching_move: _teachingMove,
      teaching_move_zh: _teachingMoveZh,
      source_sentence: _sourceSentence,
      ...publicEvidence
    } = item;
    return publicEvidence;
  });
}

function attachNestedConceptReferences(views) {
  const byConceptId = new Map((views || []).map((view) => [view.concept_id, view]));
  const enrichReference = (reference) => {
    const nestedView = byConceptId.get(reference.concept_id);
    if (!nestedView) return reference;
    return {
      ...reference,
      prerequisite_concepts: (nestedView.prerequisite_concepts || [])
        .slice(0, 6)
        .map(sanitizePublicConceptReference),
      introduced_concepts: (nestedView.introduced_concepts || [])
        .slice(0, 4)
        .map(sanitizePublicConceptReference),
    };
  };
  return (views || []).map((view) => ({
    ...view,
    prerequisite_concepts: (view.prerequisite_concepts || []).map(enrichReference),
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
          defined_symbol: current.symbol,
          evidence: current.evidence,
          confidence: current.confidence,
        }
      : view;

    const prerequisiteConcepts = [];
    for (const reference of view.prerequisite_concepts || []) {
      const concept = reviewedConceptForReference(
        view.chapter_id,
        reference.defined_by_formula_id || reference.from_formula_id,
        'defined',
        reference.symbol || reference.via_symbol,
        reference.concept_id,
        lookup,
      );
      prerequisiteConcepts.push(applyConceptToReference(reference, concept, true));
    }

    const introducedConcepts = [];
    for (const reference of view.introduced_concepts || []) {
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

    const prerequisiteEdges = prerequisiteConcepts.map((concept) => ({
      from: concept.concept_id,
      to: updatedView.concept_id,
      relation: 'prerequisite_for',
      derived_from_formula_edge: {
        from: concept.from_formula_id,
        to: updatedView.defined_by_formula_id,
        via_symbol: concept.via_symbol,
      },
      clickable: true,
      confidence: concept.confidence,
    }));
    const introducedEdges = introducedConcepts.map((concept) => ({
      from: concept.concept_id,
      to: updatedView.concept_id,
      relation: 'introduced_for',
      symbol: concept.symbol,
      clickable: false,
      confidence: concept.confidence,
    }));

    views.push({
      ...sanitizeConceptViewForProduct(updatedView),
      prerequisite_concepts: prerequisiteConcepts,
      introduced_concepts: introducedConcepts,
      edges: [...prerequisiteEdges, ...introducedEdges],
    });
  }

  return {
    ...conceptGraph,
    source: {
      ...conceptGraph.source,
      method: 'concept views from formula dependencies, formula-symbol maps, and structured evidence',
    },
    summary: conceptGraphSummary(
      conceptGraph.chapter_id,
      conceptGraph.summary.formulas_processed,
      symbolConcepts,
      views,
    ),
    symbol_concepts: undefined,
    views: attachNestedConceptReferences(views),
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
    const symbolConcepts = applyConceptCalibrations(
      appendMissingCalibratedConcepts(generatedConceptGraph.symbol_concepts, chapterDoc, promptMap, structuredBlocks),
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
