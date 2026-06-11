import type { FormulaPrerequisite } from '../types/formula';
import { conciseVariablePrerequisite } from '../../features/graph/formulaInfo.ts';

export interface SymbolAnnotationOptions {
  shortLabel?: string;
  llmText?: string;
}

const FITNESS_SYMBOLS = new Set(['\\overline{W}', '\\bar{W}', '\\barW', '\\overline{w}', '\\bar{w}', '\\barw']);
const FITNESS_BAD_LABEL_RE = /财富|财产|wealth/i;
const BAD_LABEL_RULES: Array<{ symbol: RegExp; label: RegExp }> = [
  { symbol: /^(?:\\(?:overline|bar)\{?[Ww]\}?|[Ww](?:_|$))/, label: FITNESS_BAD_LABEL_RE },
  { symbol: /^(?:\\(?:overline|bar)\{?z\}?|z(?:_|$))/, label: /高度|身高|height/i },
  { symbol: /^\\mu(?:_|$)/, label: /微米|micron|micrometer/i },
  { symbol: /^\\theta(?:_|$)/, label: /角度|angle/i },
];

const GENERIC_LABEL_PATTERNS = [
  /直接使用的符号/,
  /关键符号/,
  /当前公式中的关键符号/,
  /^是这个公式/,
  /^出现在当前公式附近/,
];

const ASCII_MATH_SYMBOL_LABEL = /^(?:[A-Za-z]+(?:_[A-Za-z0-9]+)?(?:\^[0-9A-Za-z]+)?|[A-Za-z]+_[A-Za-z0-9]+\^[0-9A-Za-z]+)$/;
const EXTRA_GENERIC_LABEL_PATTERNS = [
  /这个公式直接使用/,
  /当前公式附近/,
  /关键符号/,
  /^是这个公式/,
  /^出现在当前公式/,
];

export function isGenericAnnotationLabel(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (ASCII_MATH_SYMBOL_LABEL.test(normalized)) return true;
  return GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized)) || EXTRA_GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function compressTextToShortLabel(text: string, maxLength = 16): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const firstClause = cleaned.split(/[。；;.!?]/)[0]?.trim() || cleaned;
  const withoutTrailingDetail = firstClause.replace(/[，,][^，,]+$/, '').trim();
  const candidate = withoutTrailingDetail || firstClause;

  if (candidate.length <= maxLength) return candidate;
  const trimmed = candidate.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
  return trimmed || candidate.slice(0, maxLength);
}

function normalizedSymbol(prereq: FormulaPrerequisite): string {
  return (prereq.symbol || prereq.via_symbol || '').replace(/\s+/g, '');
}

function isBadLabelForSymbol(symbol: string, value: string): boolean {
  return BAD_LABEL_RULES.some((rule) => rule.symbol.test(symbol) && rule.label.test(value));
}

function hasDomainLockedFallback(symbol: string, fallback: string): boolean {
  if (!fallback || isGenericAnnotationLabel(fallback)) return false;
  if (FITNESS_SYMBOLS.has(symbol) || /^W_\{?/.test(symbol) || /^w_\{?/.test(symbol)) return true;
  return [
    '适合度',
    '性状',
    '选择强度',
    '选择梯度',
    '选择响应',
    '选择差',
    '遗传方差',
    '遗传标准差',
    '表型方差',
    '表型标准差',
    '环境方差',
    '环境标准差',
    '标准差',
    '加性遗传',
    '加性×加性',
    '上位性方差',
    '上位性标准差',
    '显性遗传',
    '遗传力',
    '等位基因频率',
    '类别频率',
    '后代频率',
    '位点突变率',
    '位点多样性',
    '位点分化',
    '多态性',
    '沉默位点',
    '替换位点',
    '有效种群大小',
    '中性指数',
    'Tarone-Greenland',
    'MK 比值',
  ].some((keyword) => fallback.includes(keyword));
}

function compoundShortLabel(prereq: FormulaPrerequisite): string {
  if ((prereq as { kind?: string }).kind !== 'compound') return '';
  const meaning = prereq.meaning?.trim() || prereq.definition?.trim() || '';
  const label = compressTextToShortLabel(meaning);
  return label && !isGenericAnnotationLabel(label) ? label : '';
}

function compoundMeaning(prereq: FormulaPrerequisite): string {
  if ((prereq as { kind?: string }).kind !== 'compound') return '';
  return prereq.meaning?.trim() || prereq.definition?.trim() || '';
}

export function resolveSymbolShortLabel(prereq: FormulaPrerequisite, options: SymbolAnnotationOptions = {}): string {
  const compoundLabel = compoundShortLabel(prereq);
  if (compoundLabel) return compoundLabel;

  const localFallback = conciseVariablePrerequisite(prereq);
  const symbol = normalizedSymbol(prereq);
  const isDomainLocked = hasDomainLockedFallback(symbol, localFallback);
  if (isDomainLocked) return localFallback;

  const explicit = options.shortLabel?.trim();
  if (explicit && !isGenericAnnotationLabel(explicit) && !isBadLabelForSymbol(symbol, explicit)) return explicit;

  const llmText = options.llmText?.trim();
  if (llmText) {
    const fromLlm = compressTextToShortLabel(llmText);
    if (fromLlm && !isGenericAnnotationLabel(fromLlm) && !isBadLabelForSymbol(symbol, fromLlm)) return fromLlm;
  }

  const meaning = prereq.meaning?.trim() || prereq.definition?.trim();
  if (meaning) {
    const fromMeaning = compressTextToShortLabel(meaning);
    if (fromMeaning && !isGenericAnnotationLabel(fromMeaning)) return fromMeaning;
  }

  return isGenericAnnotationLabel(localFallback) ? '' : localFallback;
}

export function resolveSymbolMeaning(prereq: FormulaPrerequisite, options: SymbolAnnotationOptions = {}): string {
  const localCompoundMeaning = compoundMeaning(prereq);
  if (localCompoundMeaning) return localCompoundMeaning;

  const localFallback = conciseVariablePrerequisite(prereq);
  const symbol = normalizedSymbol(prereq);
  if (hasDomainLockedFallback(symbol, localFallback)) return localFallback;
  return options.llmText?.trim() || prereq.meaning?.trim() || prereq.definition?.trim() || localFallback;
}

export function isFocusAnnotationLabel(note: string): boolean {
  return Boolean(note.trim()) && !isGenericAnnotationLabel(note);
}
