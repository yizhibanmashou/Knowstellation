import type { ChapterFormula, FormulaPrerequisite } from '../../shared/types/formula';
import { compactContext } from './formulaInfo.ts';
import { readBracedGroup, skipWhitespace } from '../../shared/utils/latexHelpers.ts';

export type FocusAnnotationKind = 'symbol' | 'compound' | 'formula';

export type FocusAnnotationNote = FormulaPrerequisite & {
  kind?: FocusAnnotationKind;
  shortLabel?: string;
  llmText?: string;
  llmStatus?: 'loading' | 'ready' | 'error';
  target?: string;
};

const MAX_COMPOUND_NOTES = 24;

function normalizeLatex(value = ''): string {
  return value.replace(/\\left|\\right/g, '').replace(/\s+/g, '');
}

function stripOuterBraces(value: string): string {
  let next = value.trim();
  while (next.startsWith('{') && next.endsWith('}') && bracesWrapEntireExpression(next)) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function bracesWrapEntireExpression(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function formatPower(power = ''): string {
  const clean = stripOuterBraces(power).trim();
  if (!clean) return '';
  return /^[A-Za-z0-9]$/.test(clean) ? `^${clean}` : `^{${clean}}`;
}

function normalizeLegacyOver(value: string): string {
  return value.replace(/\{([^{}]+)\\over(?![A-Za-z])([^{}]+)\}/g, '\\frac{$1}{$2}');
}

function normalizeLegacyFontSwitches(value: string): string {
  return value
    .replace(/\{\\bf\s+([^{}]+)\}/g, '\\mathbf{$1}')
    .replace(/\{\\bf\\bar\s+([^{}]+)\}/g, '\\mathbf{\\bar{$1}}')
    .replace(/\{\\bf\\bar\s*([A-Za-z])\}/g, '\\mathbf{\\bar{$1}}')
    .replace(/\{\\bf\\bar\s+([^{}]+)\}/g, '\\mathbf{\\bar{$1}}')
    .replace(/\{\\bf\\bar\s*([A-Za-z])\}/g, '\\mathbf{\\bar{$1}}')
    .replace(/\{\\bf\s*\\bar\s+([^{}]+)\}/g, '\\mathbf{\\bar{$1}}')
    .replace(/\{\\bf\s*\\bar\s*([A-Za-z])\}/g, '\\mathbf{\\bar{$1}}');
}

function canonicalizeDisplaySymbol(value: string): string {
  return normalizeLegacyFontSwitches(normalizeLegacyOver(value))
    .replace(/\\left|\\right/g, '')
    .replace(/\\bf\s+([A-Za-z])(?=[_}\s+\-)])/g, '\\mathbf{$1}')
    .replace(/\\bf\\bar\s+([A-Za-z])(?=[_}\s+\-)])/g, '\\mathbf{\\bar{$1}}')
    .replace(/\\bf\s*\\bar\s+([A-Za-z])(?=[_}\s+\-)])/g, '\\mathbf{\\bar{$1}}')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectFractions(latex: string): Array<{ raw: string; numerator: string; denominator: string }> {
  const fractions: Array<{ raw: string; numerator: string; denominator: string }> = [];
  const commandPattern = /\\(?:dfrac|tfrac|frac)/g;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(latex))) {
    const commandStart = match.index;
    const firstStart = skipWhitespace(latex, commandPattern.lastIndex);
    const numerator = readBracedGroup(latex, firstStart);
    if (!numerator) continue;
    const secondStart = skipWhitespace(latex, numerator.end);
    const denominator = readBracedGroup(latex, secondStart);
    if (!denominator) continue;
    fractions.push({
      raw: latex.slice(commandStart, denominator.end),
      numerator: numerator.value,
      denominator: denominator.value,
    });
    commandPattern.lastIndex = denominator.end;
  }
  return fractions;
}

function addCompound(seen: Set<string>, items: FocusAnnotationNote[], symbol: string, meaning: string, sourceExcerpt?: string, target = symbol) {
  const normalized = normalizeLatex(canonicalizeDisplaySymbol(target));
  if (!normalized || normalized.length < 3 || seen.has(normalized)) return;
  if (!/[A-Za-z\\]/.test(normalized) && !/(?:frac|\/)/.test(normalized)) return;
  seen.add(normalized);
  const displaySymbol = canonicalizeDisplaySymbol(symbol);
  items.push({
    type: 'variable_definition',
    symbol: displaySymbol,
    meaning,
    definition: meaning,
    source: 'formula_structure',
    source_excerpt: sourceExcerpt,
    confidence: 0.76,
    kind: 'compound',
    target: canonicalizeDisplaySymbol(target),
  });
}

function addFractionPartCompounds(
  seen: Set<string>,
  items: FocusAnnotationNote[],
  fraction: { raw: string; numerator: string; denominator: string },
  sourceExcerpt?: string,
) {
  const numerator = stripOuterBraces(fraction.numerator);
  const denominator = stripOuterBraces(fraction.denominator);
  if (!shouldAnnotateFractionParts(numerator, denominator)) return;
  if (normalizeLatex(numerator).length >= 1) {
    addCompound(
      seen,
      items,
      numerator,
      '分子整体，表示被分母尺度归一化或比较的变化量、权重或组合项。',
      sourceExcerpt,
      `\\frac{${numerator}}{}`,
    );
  }
  if (normalizeLatex(denominator).length >= 1) {
    addCompound(
      seen,
      items,
      denominator,
      '分母整体，表示分子所参照的变量、尺度或归一化基准。',
      sourceExcerpt,
      `\\frac{}{${denominator}}`,
    );
  }
}

function shouldAnnotateFractionParts(numerator: string, denominator: string): boolean {
  const compactNumerator = normalizeLatex(numerator);
  const compactDenominator = normalizeLatex(denominator);
  const joined = `${compactNumerator}|${compactDenominator}`;
  if (/\\partial/.test(joined)) return true;
  if (/\\sum|\\prod|\\int/.test(joined)) return false;
  if (/[()]/.test(joined) || /[+]/.test(joined)) return false;
  if (compactNumerator.includes('/') || compactDenominator.includes('/')) return false;
  const simpleSymbol = /^\\?[A-Za-z]+(?:_\{?[A-Za-z0-9]+\}?|\^\{?[A-Za-z0-9]+\}?)*$/;
  return simpleSymbol.test(compactNumerator) && simpleSymbol.test(compactDenominator);
}

function describeOneMinusFactor(inner: string): string {
  const compact = normalizeLatex(inner);
  if (/^f_\{?t\}?$/.test(compact)) return '未近交比例';
  if (/^f_\{?0\}?$/.test(compact)) return '初始未近交比例';
  if (/^f_\{?s\}?$/.test(compact)) return '未受扫荡影响比例';
  if (/^q\(?0\)?$/.test(compact)) return '剩余频率份额';
  return '互补比例因子';
}

function isTaroneGreenlandMkFraction(value: string): boolean {
  const compact = normalizeLatex(value).replace(/\\left|\\right/g, '');
  return (
    /\\sum_\{?i\}?D_\{?si\}?P_\{?ai\}?\/\(P_\{?si\}?\+D_\{?si\}?\)/.test(compact) &&
    /\\sum_\{?i\}?P_\{?si\}?D_\{?ai\}?\/\(P_\{?si\}?\+D_\{?si\}?\)/.test(compact)
  );
}

function describeCompound(symbol: string, latex: string): string {
  const compact = normalizeLatex(symbol);
  const whole = normalizeLatex(latex);
  const oneMinus = compact.match(/^\(?1-([^)]+)\)?(?:\^\{?(.+)\}?)?$/);
  if (oneMinus) {
    const label = describeOneMinusFactor(stripOuterBraces(oneMinus[1]));
    if (oneMinus[2]) return `${label}的 ${oneMinus[2]} 次幂，表示这个保留比例连续作用后的缩放强度。`;
    return `${label}，表示总体中没有进入对应状态的剩余份额。`;
  }

  const poweredGroup = compact.match(/^\((.+)\)(?:\^\{?(.+)\}?)$/);
  if (poweredGroup) {
    const inner = poweredGroup[1];
    const power = poweredGroup[2];
    if (/[+\-]/.test(inner)) return `括号内差值或组合项的 ${power} 次幂，需要作为一个整体理解它对本式尺度的贡献。`;
    return `括号内组合项的 ${power} 次幂，表示这个整体重复相乘后的缩放强度。`;
  }

  if (/^f_\{?t\}?\(?1-f_\{?t\}?\)?$/.test(compact) || /^\(?1-f_\{?t\}?\)?f_\{?t\}?$/.test(compact)) {
    return '近交比例与未近交比例的乘积，表示两类状态共同决定的转换权重。';
  }

  if (/^\\(?:dfrac|tfrac|frac)\{/.test(compact)) {
    if (isTaroneGreenlandMkFraction(symbol) || isTaroneGreenlandMkFraction(latex)) {
      return 'TG 加权 MK 比值。Tarone-Greenland 中性指数的核心比例：分子汇总沉默分化与替换多态性，分母汇总沉默多态性与替换分化。';
    }
    if (compact.includes('\\partial')) return '导数分式，表示分子中的变化量相对于分母变量的局部变化率。';
    if (/2N|N_\{?e\}?/.test(compact)) return '按群体大小归一化的分式项，用来把概率、频率或漂变强度缩放到合适尺度。';
    return '分式比值，表示分子这一项相对于分母尺度的归一化结果。';
  }

  if (/^\(?1-\\frac\{?1\}?\{?2N/.test(compact)) {
    return '每一代没有抽到同源拷贝的保留概率，是漂变递推里的单代缩放因子。';
  }

  if (compact.includes('\\sigma') && compact.includes('(0)')) {
    return '初始方差项，表示在 t=0 时保存下来的变异来源。';
  }

  if (whole.includes(compact)) return '公式中的组合项，需要作为一个整体理解它对等式的缩放或贡献。';
  return '公式中的组合项。';
}

export function buildCompoundFocusAnnotations(formula?: Pick<ChapterFormula, 'latex' | 'context_text'> | null): FocusAnnotationNote[] {
  const latex = normalizeLegacyOver(formula?.latex || '');
  const context = formula?.context_text || '';
  const items: FocusAnnotationNote[] = [];
  const seen = new Set<string>();

  const oneMinusPattern = /(?:\\left)?\(\s*1\s*-\s*(\\(?:dfrac|tfrac|frac)\{[^{}]+\}\{[^{}]+\}|[^()]+?)\s*(?:\\right)?\)(?:\^\{([^{}]+)\}|\^([A-Za-z0-9]))?/g;
  let match: RegExpExecArray | null;
  while ((match = oneMinusPattern.exec(latex)) && items.length < MAX_COMPOUND_NOTES) {
    const inner = stripOuterBraces(match[1] || '');
    const power = match[2] || match[3] || '';
    const symbol = `(1-${inner})${formatPower(power)}`;
    addCompound(seen, items, symbol, describeCompound(symbol, latex), context);
  }

  const poweredGroupPattern = /(?:\\left)?\(\s*([^()]{1,90}[+\-][^()]{1,90})\s*(?:\\right)?\)(?:\^\{([^{}]+)\}|\^([A-Za-z0-9])|(T)(?=\\|[\s,;=+\-)]|$))/g;
  while ((match = poweredGroupPattern.exec(latex)) && items.length < MAX_COMPOUND_NOTES) {
    const inner = stripOuterBraces(match[1] || '');
    if (/^1\s*-/.test(inner)) continue;
    const power = match[2] || match[3] || match[4] || '';
    const symbol = `(${inner})${formatPower(power)}`;
    addCompound(seen, items, symbol, describeCompound(symbol, latex), context);
  }

  const ftProductPattern = /(?:f_\{?t\}?\\left\(\s*1\s*-\s*f_\{?t\}?\s*\\right\)|f_\{?t\}?\(\s*1\s*-\s*f_\{?t\}?\s*\)|\\left\(\s*1\s*-\s*f_\{?t\}?\s*\\right\)f_\{?t\}?|\(\s*1\s*-\s*f_\{?t\}?\s*\)f_\{?t\}?)/g;
  while ((match = ftProductPattern.exec(latex)) && items.length < MAX_COMPOUND_NOTES) {
    const raw = match[0].replace(/\\left|\\right/g, '');
    addCompound(seen, items, raw, describeCompound(raw, latex), context);
  }

  const varianceAtZeroPattern = /(\\sigma_(?:\{[^{}]+\}|[A-Za-z]+)(?:\^\{?2\}?)?\(0\))/g;
  while ((match = varianceAtZeroPattern.exec(latex)) && items.length < MAX_COMPOUND_NOTES) {
    addCompound(seen, items, match[1], describeCompound(match[1], latex), context);
  }

  for (const fraction of collectFractions(latex)) {
    if (items.length >= MAX_COMPOUND_NOTES) break;
    addCompound(seen, items, fraction.raw, describeCompound(fraction.raw, latex), context);
    addFractionPartCompounds(seen, items, fraction, context);
  }

  return items.slice(0, MAX_COMPOUND_NOTES);
}

export function buildFormulaWideFocusAnnotation(formula?: Pick<ChapterFormula, 'latex' | 'context_text'> | null): FocusAnnotationNote | null {
  if (!formula?.latex) return null;
  const meaning = `整条公式的结构提示：${compactContext(formula.context_text || '先从等号两侧和括号组合项读起，判断每一项是在定义、递推还是缩放。', 96)}`;
  const readableMeaning = '把整条公式作为一个关系来读：先看等号左侧正在定义或预测的量，再看右侧由哪些函数、条件和小量项共同决定。';
  return {
    type: 'variable_definition',
    symbol: formula.latex,
    meaning: readableMeaning || meaning,
    definition: readableMeaning || meaning,
    source: 'formula_structure',
    source_excerpt: formula.context_text,
    confidence: 0.6,
    kind: 'formula',
  };
}
