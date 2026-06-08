export type RichTextPart =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; raw?: string; implicit?: boolean };

const INLINE_MATH_RE = /(\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;

const GREEK_NAME_PATTERN =
  '(?:Alpha|Beta|Epsilon|Zeta|Eta|Iota|Kappa|Mu|Nu|Rho|Tau|Chi|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|varrho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)';
const MATH_WORD_BASE_PATTERN = '(?:Widetildesigma|Widetildep|Changemu|DCMS|rEHH|AIC|Aic|EHH|iHS|cdf|CL|NI|Change|Fracf|Prime|Msh)';
const BASE_PATTERN = `(?:\\\\${GREEK_NAME_PATTERN}|${GREEK_NAME_PATTERN}|${MATH_WORD_BASE_PATTERN}|[A-Za-z\\u0370-\\u03FF])`;
const ASCII_SCRIPT_PATTERN = '(?:[_^](?:\\{[^{}]{1,24}\\}|\\\\(?:prime|mathrm\\{[A-Za-z]{1,12}\\})|[A-Za-z0-9]{1,12}))';
const ASCII_EXPONENT_PATTERN = '(?:\\^(?:\\{[^{}]{1,24}\\}|[A-Za-z0-9]{1,12}))';
const UNICODE_SUPERSCRIPT_PATTERN = '[\\u00B2\\u00B3\\u00B9\\u2070-\\u2079\\u207A-\\u207E]+';
const UNICODE_SUBSCRIPT_PATTERN = '[\\u2080-\\u209C]+';
const SCRIPT_PATTERN = `(?:${ASCII_SCRIPT_PATTERN}|${UNICODE_SUPERSCRIPT_PATTERN}|${UNICODE_SUBSCRIPT_PATTERN})`;
const PAREN_ARGUMENT_PATTERN = '(?:\\([A-Za-z0-9_.+\\-*/|\\\\\\u0370-\\u03FF\\u2080-\\u209C]{1,24}\\))?';
const TRAILING_EXPONENT_PATTERN = `(?:${ASCII_EXPONENT_PATTERN}|${UNICODE_SUPERSCRIPT_PATTERN})?`;
const SCRIPTED_TOKEN_PATTERN = `${BASE_PATTERN}${SCRIPT_PATTERN}{1,4}${PAREN_ARGUMENT_PATTERN}${TRAILING_EXPONENT_PATTERN}`;
const ACCENTED_SCRIPTED_TOKEN_PATTERN = `${BASE_PATTERN}-(?:bar|hat)${SCRIPT_PATTERN}{1,4}${PAREN_ARGUMENT_PATTERN}`;
const SCRIPTED_GROUP_PATTERN = `\\((?=[^)]*(?:[_^\\u00B2\\u00B3\\u00B9\\u2070-\\u2079\\u2080-\\u209C]))[A-Za-z0-9_{}'\\u0370-\\u03FF\\\\\\s+\\-*/=|,.\\u00B2\\u00B3\\u00B9\\u2070-\\u2079\\u2080-\\u209C]{1,64}\\)(?:${ASCII_EXPONENT_PATTERN}|${UNICODE_SUPERSCRIPT_PATTERN})?`;
const POWERED_GROUP_PATTERN = `\\([A-Za-z0-9_{}'\\u0370-\\u03FF\\\\\\s+\\-*/=|,.]{1,64}\\)(?:${ASCII_EXPONENT_PATTERN}|${UNICODE_SUPERSCRIPT_PATTERN})`;
const TRAILING_POWERED_GROUP_RE = new RegExp(`^(${POWERED_GROUP_PATTERN})`, 'u');
const NUMBER_PATTERN = '\\d+(?:\\.\\d+)?';
const MATH_ATOM_PATTERN = `(?:${NUMBER_PATTERN})?(?:${SCRIPTED_TOKEN_PATTERN}|${BASE_PATTERN})`;
const SCRIPTED_RATIO_PATTERN = `(?:${NUMBER_PATTERN})?${SCRIPTED_TOKEN_PATTERN}(?:\\s*[*/]\\s*${MATH_ATOM_PATTERN})+`;
const SCRIPTED_PRODUCT_PATTERN = `(?:${NUMBER_PATTERN})?${SCRIPTED_TOKEN_PATTERN}(?:${SCRIPTED_TOKEN_PATTERN})+`;
const SINGLE_PREFIX_SCRIPTED_PATTERN = `(?:${NUMBER_PATTERN})?[a-z]${SCRIPTED_TOKEN_PATTERN}`;
const SINGLE_SUFFIX_SCRIPTED_PATTERN = `(?:${NUMBER_PATTERN})?${SCRIPTED_TOKEN_PATTERN}[a-z]`;
const COEFFICIENT_SCRIPTED_PATTERN = `(?:${NUMBER_PATTERN})${SCRIPTED_TOKEN_PATTERN}`;
const IMPLICIT_PRODUCT_BASE_RUN_PATTERN = `(?:(?:\\\\${GREEK_NAME_PATTERN}|${GREEK_NAME_PATTERN}|[A-Z\\u0370-\\u03FF]){1,5})`;
const IMPLICIT_PRODUCT_PREFIX_PATTERN = `(?:${NUMBER_PATTERN})?${IMPLICIT_PRODUCT_BASE_RUN_PATTERN}${SCRIPTED_TOKEN_PATTERN}(?:${SCRIPTED_TOKEN_PATTERN}|${IMPLICIT_PRODUCT_BASE_RUN_PATTERN})*`;
const IMPLICIT_PRODUCT_SUFFIX_PATTERN = `(?:${NUMBER_PATTERN})?${SCRIPTED_TOKEN_PATTERN}${IMPLICIT_PRODUCT_BASE_RUN_PATTERN}(?:${SCRIPTED_TOKEN_PATTERN}|${IMPLICIT_PRODUCT_BASE_RUN_PATTERN})*`;
const BARE_MATH_TOKEN_RE = new RegExp(
  `(^|[^A-Za-z0-9_\\\\\\u0370-\\u03FF])(${ACCENTED_SCRIPTED_TOKEN_PATTERN}|${POWERED_GROUP_PATTERN}|${SCRIPTED_GROUP_PATTERN}|${SCRIPTED_RATIO_PATTERN}|${SCRIPTED_PRODUCT_PATTERN}|${IMPLICIT_PRODUCT_PREFIX_PATTERN}|${IMPLICIT_PRODUCT_SUFFIX_PATTERN}|${SINGLE_PREFIX_SCRIPTED_PATTERN}|${SINGLE_SUFFIX_SCRIPTED_PATTERN}|${COEFFICIENT_SCRIPTED_PATTERN}|${SCRIPTED_TOKEN_PATTERN})(?=$|[^A-Za-z0-9_\\u0370-\\u03FF])`,
  'gu',
);
const SCRIPTED_TOKEN_RE = new RegExp(SCRIPTED_TOKEN_PATTERN, 'gu');
const EXACT_SCRIPTED_TOKEN_RE = new RegExp(`^${SCRIPTED_TOKEN_PATTERN}$`, 'u');
const ACCENTED_SCRIPTED_TOKEN_RE = new RegExp(`^(${BASE_PATTERN})-(bar|hat)(.+)$`, 'u');
const BASE_MATCH_RE = new RegExp(`^(\\\\${GREEK_NAME_PATTERN}|${GREEK_NAME_PATTERN}|${MATH_WORD_BASE_PATTERN}|[A-Za-z\\u0370-\\u03FF])`, 'u');
const GREEK_CHAR_OR_NAME_RE = new RegExp(`\\\\${GREEK_NAME_PATTERN}|${GREEK_NAME_PATTERN}|[\\u0370-\\u03FF]`, 'gu');
const ROMAN_MATH_BASES = new Set(['AIC', 'Aic', 'DCMS', 'rEHH', 'EHH', 'iHS', 'cdf', 'CL', 'NI']);
const NAMED_MATH_BASES: Record<string, string> = {
  Widetildesigma: '\\widetilde{\\sigma}',
  Widetildep: '\\widetilde{p}',
  Changemu: '\\Delta\\mu',
  Change: '\\Delta',
  Fracf: 'F',
  Prime: '\\prime',
  Msh: 'Msh',
};

const GREEK_BY_NAME: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  Alpha: '\\alpha',
  Beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\epsilon',
  Epsilon: '\\epsilon',
  varepsilon: '\\varepsilon',
  zeta: '\\zeta',
  Zeta: '\\zeta',
  eta: '\\eta',
  Eta: '\\eta',
  theta: '\\theta',
  vartheta: '\\vartheta',
  iota: '\\iota',
  Iota: '\\iota',
  kappa: '\\kappa',
  Kappa: '\\kappa',
  lambda: '\\lambda',
  mu: '\\mu',
  Mu: '\\mu',
  nu: '\\nu',
  Nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  Rho: '\\rho',
  varrho: '\\varrho',
  sigma: '\\sigma',
  tau: '\\tau',
  Tau: '\\tau',
  upsilon: '\\upsilon',
  phi: '\\phi',
  varphi: '\\varphi',
  chi: '\\chi',
  Chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
  Gamma: '\\Gamma',
  Delta: '\\Delta',
  Theta: '\\Theta',
  Lambda: '\\Lambda',
  Xi: '\\Xi',
  Pi: '\\Pi',
  Sigma: '\\Sigma',
  Upsilon: '\\Upsilon',
  Phi: '\\Phi',
  Psi: '\\Psi',
  Omega: '\\Omega',
};

const GREEK_BY_CHAR: Record<string, string> = {
  '\u03B1': '\\alpha',
  '\u03B2': '\\beta',
  '\u03B3': '\\gamma',
  '\u03B4': '\\delta',
  '\u03B5': '\\epsilon',
  '\u03B6': '\\zeta',
  '\u03B7': '\\eta',
  '\u03B8': '\\theta',
  '\u03B9': '\\iota',
  '\u03BA': '\\kappa',
  '\u03BB': '\\lambda',
  '\u03BC': '\\mu',
  '\u03BD': '\\nu',
  '\u03BE': '\\xi',
  '\u03C0': '\\pi',
  '\u03C1': '\\rho',
  '\u03C3': '\\sigma',
  '\u03C4': '\\tau',
  '\u03C5': '\\upsilon',
  '\u03C6': '\\phi',
  '\u03D5': '\\varphi',
  '\u03C7': '\\chi',
  '\u03C8': '\\psi',
  '\u03C9': '\\omega',
  '\u0393': '\\Gamma',
  '\u0394': '\\Delta',
  '\u0398': '\\Theta',
  '\u039B': '\\Lambda',
  '\u039E': '\\Xi',
  '\u03A0': '\\Pi',
  '\u03A3': '\\Sigma',
  '\u03A5': '\\Upsilon',
  '\u03A6': '\\Phi',
  '\u03A8': '\\Psi',
  '\u03A9': '\\Omega',
};

const SUPERSCRIPT_CHARS: Record<string, string> = {
  '\u2070': '0',
  '\u00B9': '1',
  '\u00B2': '2',
  '\u00B3': '3',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
  '\u207A': '+',
  '\u207B': '-',
  '\u207C': '=',
  '\u207D': '(',
  '\u207E': ')',
};

const SUBSCRIPT_CHARS: Record<string, string> = {
  '\u2080': '0',
  '\u2081': '1',
  '\u2082': '2',
  '\u2083': '3',
  '\u2084': '4',
  '\u2085': '5',
  '\u2086': '6',
  '\u2087': '7',
  '\u2088': '8',
  '\u2089': '9',
  '\u208A': '+',
  '\u208B': '-',
  '\u208C': '=',
  '\u208D': '(',
  '\u208E': ')',
  '\u2090': 'a',
  '\u2091': 'e',
  '\u2095': 'h',
  '\u1D62': 'i',
  '\u2C7C': 'j',
  '\u2096': 'k',
  '\u2097': 'l',
  '\u2098': 'm',
  '\u2099': 'n',
  '\u2092': 'o',
  '\u209A': 'p',
  '\u1D63': 'r',
  '\u209B': 's',
  '\u209C': 't',
  '\u1D64': 'u',
  '\u1D65': 'v',
  '\u2093': 'x',
};

function stripInlineMathDelimiters(value: string): string {
  return value
    .replace(/^\\\[([\s\S]+)\\\]$/, '$1')
    .replace(/^\\\(([\s\S]+)\\\)$/, '$1')
    .replace(/^\$\$([\s\S]+)\$\$$/, '$1')
    .replace(/^\$([\s\S]+)\$$/, '$1')
    .trim();
}

function isSuperscriptRun(value: string): boolean {
  return /^[\u00B2\u00B3\u00B9\u2070-\u2079\u207A-\u207E]+$/u.test(value);
}

function isSubscriptRun(value: string): boolean {
  return /^[\u2080-\u209C]+$/u.test(value);
}

function decodeScriptRun(value: string, map: Record<string, string>): string {
  return Array.from(value)
    .map((char) => map[char] || char)
    .join('');
}

function normalizeScriptValue(value: string): string {
  return Array.from(value)
    .map((char) => GREEK_BY_CHAR[char] || SUBSCRIPT_CHARS[char] || SUPERSCRIPT_CHARS[char] || char)
    .join('');
}

function readScriptValue(input: string, start: number): { value: string; end: number } | null {
  if (input[start] === '{') {
    const end = input.indexOf('}', start + 1);
    if (end < 0) return null;
    return { value: input.slice(start + 1, end), end: end + 1 };
  }

  const command = /^\\(?:prime|mathrm\{[A-Za-z]{1,12}\})/.exec(input.slice(start));
  if (command) return { value: command[0], end: start + command[0].length };

  const plain = /^[A-Za-z0-9]{1,12}/.exec(input.slice(start));
  if (plain) return { value: plain[0], end: start + plain[0].length };

  return null;
}

function normalizeBase(base: string): string {
  if (base.startsWith('\\')) return base;
  if (NAMED_MATH_BASES[base]) return NAMED_MATH_BASES[base];
  if (ROMAN_MATH_BASES.has(base)) return `\\mathrm{${base}}`;
  return GREEK_BY_NAME[base] || GREEK_BY_CHAR[base] || base;
}

function normalizeCompositeMathToken(token: string): string {
  const placeholders: string[] = [];
  SCRIPTED_TOKEN_RE.lastIndex = 0;
  const protectedToken = token.replace(SCRIPTED_TOKEN_RE, (scriptedToken) => {
    const index = placeholders.push(bareMathTokenToLatex(scriptedToken)) - 1;
    return `\uE000${index}\uE001`;
  });
  SCRIPTED_TOKEN_RE.lastIndex = 0;

  return protectedToken
    .replace(GREEK_CHAR_OR_NAME_RE, (base) => `${normalizeBase(base)} `)
    .replace(/\uE000(\d+)\uE001/g, (_, index: string) => placeholders[Number(index)] || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTrailingPoweredGroups(parts: RichTextPart[]): RichTextPart[] {
  const merged: RichTextPart[] = [];

  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (part.type !== 'text' || previous?.type !== 'math') {
      merged.push(part);
      continue;
    }

    let text = part.value;
    let appendedRaw = '';
    while (text.startsWith('(')) {
      const group = TRAILING_POWERED_GROUP_RE.exec(text)?.[1];
      if (!group) break;
      previous.value += bareMathTokenToLatex(group);
      appendedRaw += group;
      text = text.slice(group.length);
    }
    if (appendedRaw) {
      previous.raw = `${previous.raw || previous.value}${appendedRaw}`;
    }
    if (text) merged.push({ type: 'text', value: text });
  }

  return merged;
}

export function bareMathTokenToLatex(token: string): string {
  const accentedMatch = ACCENTED_SCRIPTED_TOKEN_RE.exec(token);
  if (accentedMatch) {
    const base = normalizeBase(accentedMatch[1]);
    const accent = accentedMatch[2] === 'bar' ? 'overline' : 'widehat';
    const scriptedRest = `${accentedMatch[1]}${accentedMatch[3]}`;
    const normalized = bareMathTokenToLatex(scriptedRest);
    const script = normalized.slice(normalizeBase(accentedMatch[1]).length);
    return `\\${accent}{${base}}${script}`;
  }

  const groupMatch = /^\(([\s\S]+)\)((?:\^(?:\{[^{}]{1,24}\}|[A-Za-z0-9]{1,12})|[\u00B2\u00B3\u00B9\u2070-\u2079\u207A-\u207E]+)?)$/u.exec(token);
  if (groupMatch) {
    const body = splitBareMathText(groupMatch[1])
      .map((part) => part.value)
      .join('');
    const script = groupMatch[2] || '';
    if (!script) return `(${body})`;
    if (isSuperscriptRun(script)) return `(${body})^{${decodeScriptRun(script, SUPERSCRIPT_CHARS)}}`;
    const exponent = readScriptValue(script, 1);
    return exponent ? `(${body})^{${normalizeScriptValue(exponent.value)}}` : `(${body})${script}`;
  }

  if (!EXACT_SCRIPTED_TOKEN_RE.test(token) && SCRIPTED_TOKEN_RE.test(token)) {
    SCRIPTED_TOKEN_RE.lastIndex = 0;
    return normalizeCompositeMathToken(token);
  }
  SCRIPTED_TOKEN_RE.lastIndex = 0;

  const baseMatch = BASE_MATCH_RE.exec(token);
  if (!baseMatch) return token;

  let latex = normalizeBase(baseMatch[0]);
  let cursor = baseMatch[0].length;

  while (cursor < token.length) {
    const char = token[cursor];
    if (char === '_' || char === '^') {
      const script = readScriptValue(token, cursor + 1);
      if (!script) {
        latex += char;
        cursor += 1;
        continue;
      }
      latex += `${char}{${normalizeScriptValue(script.value)}}`;
      cursor = script.end;
      continue;
    }

    const rest = token.slice(cursor);
    const superMatch = /^[\u00B2\u00B3\u00B9\u2070-\u2079\u207A-\u207E]+/u.exec(rest);
    if (superMatch) {
      latex += `^{${decodeScriptRun(superMatch[0], SUPERSCRIPT_CHARS)}}`;
      cursor += superMatch[0].length;
      continue;
    }

    const subMatch = /^[\u2080-\u209C]+/u.exec(rest);
    if (subMatch) {
      latex += `_{${decodeScriptRun(subMatch[0], SUBSCRIPT_CHARS)}}`;
      cursor += subMatch[0].length;
      continue;
    }

    latex += char;
    cursor += 1;
  }

  return latex;
}

function splitBareMathText(text: string): RichTextPart[] {
  const parts: RichTextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(BARE_MATH_TOKEN_RE)) {
    const boundary = match[1] || '';
    const raw = match[2] || '';
    const tokenStart = (match.index ?? 0) + boundary.length;
    if (tokenStart > cursor) parts.push({ type: 'text', value: text.slice(cursor, tokenStart) });
    parts.push({ type: 'math', value: bareMathTokenToLatex(raw), raw, implicit: true });
    cursor = tokenStart + raw.length;
  }

  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return mergeTrailingPoweredGroups(parts);
}

export function splitRichMathText(text = ''): RichTextPart[] {
  const parts: RichTextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_MATH_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parts.push(...splitBareMathText(text.slice(cursor, index)));
    parts.push({ type: 'math', value: stripInlineMathDelimiters(raw) });
    cursor = index + raw.length;
  }

  if (cursor < text.length) parts.push(...splitBareMathText(text.slice(cursor)));
  return parts.filter((part) => part.value.length > 0);
}
