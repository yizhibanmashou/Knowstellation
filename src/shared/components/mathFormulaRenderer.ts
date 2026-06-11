import katex, { type KatexOptions } from 'katex';
import { DEFAULT_LANGUAGE, getUiCopy } from '../utils/uiCopy';

export interface RenderedFormula {
  html: string;
  displayMode: boolean;
  failed: boolean;
}

const DISPLAY_ENV_RE = /\\begin\{(?:align\*?|aligned|alignedat|gather\*?|split|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases)\}/;
const RAW_LATEX_RE = /\\(?:begin|end|quad|qquad|over|frac|dfrac|tfrac|sqrt|left|right|operatorname|mathrm|mathbb|mathbf|boldsymbol)\b/;

const KATEX_OPTIONS: KatexOptions = {
  displayMode: true,
  errorColor: '#b91c1c',
  output: 'html',
  strict: false,
  throwOnError: true,
  trust: false,
};

function stripMathDelimiters(value: string): string {
  let next = value.trim();
  const wrappers: Array<[RegExp, string]> = [
    [/^\$\$([\s\S]*)\$\$$/, '$1'],
    [/^\\\[([\s\S]*)\\\]$/, '$1'],
    [/^\\\(([\s\S]*)\\\)$/, '$1'],
  ];

  for (const [pattern, replacement] of wrappers) {
    const stripped = next.replace(pattern, replacement).trim();
    if (stripped !== next) next = stripped;
  }

  return next;
}

function normalizeLatex(input: string): string {
  return stripMathDelimiters(input)
    .replace(/\r?\n/g, ' ')
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{gather\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{split\}/g, '\\begin{aligned}')
    .replace(/\\end\{split\}/g, '\\end{aligned}')
    .replace(/\\notag|\\nonumber/g, '')
    .replace(/\{\\rm\s+([^{}]+)\}/g, (_, text: string) => `\\mathrm{${text.trim()}}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutUnsupportedEnvironments(input: string): string {
  return input
    .replace(/\\begin\{(?:aligned|alignedat|gather\*?|split)\}/g, '')
    .replace(/\\end\{(?:aligned|alignedat|gather\*?|split)\}/g, '')
    .replace(/&/g, '')
    .trim();
}

function needsDisplayMode(latex: string, inline: boolean): boolean {
  if (inline && !DISPLAY_ENV_RE.test(latex) && !/\\\\/.test(latex)) return false;
  return DISPLAY_ENV_RE.test(latex) || /\\\\/.test(latex) || latex.length > 72;
}

function fallbackHtml(): string {
  return `<span class="math-formula__fallback">${getUiCopy(DEFAULT_LANGUAGE).app.formulaUnavailable}</span>`;
}

export function renderMathToHtml(latex = '', inline = false): RenderedFormula {
  const normalized = normalizeLatex(latex);
  if (!normalized) {
    return { html: fallbackHtml(), displayMode: false, failed: true };
  }

  const displayMode = needsDisplayMode(normalized, inline);
  const candidates = [normalized, withoutUnsupportedEnvironments(normalized)].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const html = katex.renderToString(candidate, {
        ...KATEX_OPTIONS,
        displayMode: needsDisplayMode(candidate, inline),
      });
      return { html, displayMode: needsDisplayMode(candidate, inline), failed: false };
    } catch {
      continue;
    }
  }

  if (RAW_LATEX_RE.test(normalized)) {
    return { html: fallbackHtml(), displayMode, failed: true };
  }

  try {
    const html = katex.renderToString(normalized, {
      ...KATEX_OPTIONS,
      displayMode,
      throwOnError: false,
    });
    return { html, displayMode, failed: false };
  } catch {
    return { html: fallbackHtml(), displayMode, failed: true };
  }
}
