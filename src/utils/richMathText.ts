export type RichTextPart =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; raw?: string; implicit?: boolean };

const INLINE_MATH_RE = /(\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

const GREEK_NAME_PATTERN =
  '(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|varrho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)';
const BASE_PATTERN = `(?:\\\\${GREEK_NAME_PATTERN}|${GREEK_NAME_PATTERN}|[A-Za-z\\u0370-\\u03FF])`;
const ASCII_SCRIPT_PATTERN = '(?:[_^](?:\\{[^{}]{1,24}\\}|\\\\(?:prime|mathrm\\{[A-Za-z]{1,12}\\})|[A-Za-z0-9]{1,12}))';
const ASCII_EXPONENT_PATTERN = '(?:\\^(?:\\{[^{}]{1,24}\\}|[A-Za-z0-9]{1,12}))';
const UNICODE_SUPERSCRIPT_PATTERN = '[\\u00B2\\u00B3\\u00B9\\u2070-\\u2079\\u207A-\\u207E]+';
const UNICODE_SUBSCRIPT_PATTERN = '[\\u2080-\\u209C]+';
const SCRIPT_PATTERN = `(?:${ASCII_SCRIPT_PATTERN}|${UNICODE_SUPERSCRIPT_PATTERN}|${UNICODE_SUBSCRIPT_PATTERN})`;
const PAREN_ARGUMENT_PATTERN = '(?:\\([A-Za-z0-9\\u0370-\\u03FF\\u2080-\\u209C]{1,12}\\))?';
const SCRIPTED_TOKEN_PATTERN = `${BASE_PATTERN}${SCRIPT_PATTERN}{1,4}${PAREN_ARGUMENT_PATTERN}`;
const SCRIPTED_GROUP_PATTERN = `\\((?=[^)]*(?:[_^\\u00B2\\u00B3\\u00B9\\u2070-\\u2079\\u2080-\\u209C]))[A-Za-z0-9_\\u0370-\\u03FF\\\\\\s+\\-*/=|,.\\u00B2\\u00B3\\u00B9\\u2070-\\u2079\\u2080-\\u209C]{1,48}\\)(?:${ASCII_EXPONENT_PATTERN}|${UNICODE_SUPERSCRIPT_PATTERN})?`;
const BARE_MATH_TOKEN_RE = new RegExp(
  `(^|[^A-Za-z0-9_\\\\\\u0370-\\u03FF])(${SCRIPTED_GROUP_PATTERN}|${SCRIPTED_TOKEN_PATTERN})(?=$|[^A-Za-z0-9_\\u0370-\\u03FF])`,
  'gu',
);

const GREEK_BY_NAME: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\epsilon',
  varepsilon: '\\varepsilon',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  vartheta: '\\vartheta',
  iota: '\\iota',
  kappa: '\\kappa',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  varrho: '\\varrho',
  sigma: '\\sigma',
  tau: '\\tau',
  upsilon: '\\upsilon',
  phi: '\\phi',
  varphi: '\\varphi',
  chi: '\\chi',
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
    .replace(/^\\\(([\s\S]+)\\\)$/, '$1')
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
  return GREEK_BY_NAME[base] || GREEK_BY_CHAR[base] || base;
}

export function bareMathTokenToLatex(token: string): string {
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

  const baseMatch = new RegExp(`^(\\\\${GREEK_NAME_PATTERN}|${GREEK_NAME_PATTERN}|[A-Za-z\\u0370-\\u03FF])`, 'u').exec(token);
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
  return parts;
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
