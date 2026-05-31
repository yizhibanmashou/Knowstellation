const GREEK_COMMANDS: Array<[RegExp, string]> = [
  [/\\sigma(?=[\s_^{]|$)/g, 'σ'],
  [/\\Delta(?=[\s_^{]|$)/g, 'Δ'],
  [/\\mu(?=[\s_^{]|$)/g, 'μ'],
  [/\\pi(?=[\s_^{]|$)/g, 'π'],
  [/\\beta(?=[\s_^{]|$)/g, 'β'],
  [/\\alpha(?=[\s_^{]|$)/g, 'α'],
  [/\\theta(?=[\s_^{]|$)/g, 'θ'],
  [/\\rho(?=[\s_^{]|$)/g, 'ρ'],
  [/\\varphi(?=[\s_^{]|$)/g, 'ϕ'],
  [/\\phi(?=[\s_^{]|$)/g, 'ϕ'],
  [/\\imath(?=[\s_^{]|$)/g, 'ı'],
];

export function compactMathText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[′’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/φ/g, 'ϕ')
    .replace(/[\u02c9\u0304]/g, '')
    .replace(/[\s\u200b]/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

function unwrapSimpleScripts(value: string): string {
  return value
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\^\{([^{}]+)\}/g, '^$1');
}

function replaceSimpleFractions(value: string): string {
  return value
    .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\{([^{}]+)\\over([^{}]+)\}/g, '$1/$2');
}

function replaceLatexCommands(value: string): string {
  let next = replaceSimpleFractions(value)
    .replace(/\\(?:left|right)(?=[()[\]{}|.]|\\[{}])/g, '')
    .replace(/\\(?:lvert|rvert)/g, '|')
    .replace(/\\(?:langle|rangle)/g, '')
    .replace(/\\(?:mathrm|mathbf|mathit|operatorname)\{([^{}]+)\}/g, '$1')
    .replace(/\\(?:overline|bar|hat|tilde)\{([^{}]+)\}/g, '$1')
    .replace(/\\prime(?=[\s_^{]|$)/g, "'");

  GREEK_COMMANDS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  return next
    .replace(/\\Pr(?=[\s_^{]|$)/g, 'Pr')
    .replace(/\\E(?=[\s_^{]|$)/g, 'E')
    .replace(/\\partial(?=[\s_^{]|$)/g, '∂')
    .replace(/\\imath(?=[\s_^{]|$)/g, 'ı')
    .replace(/\\simeq(?=[\s_^{]|$)/g, '≃')
    .replace(/\\approx(?=[\s_^{]|$)/g, '≈')
    .replace(/\\cdots(?=[\s_^{]|$)/g, '⋯')
    .replace(/\\ldots(?=[\s_^{]|$)/g, '⋯')
    .replace(/\\times(?=[\s_^{]|$)/g, '×')
    .replace(/\\/g, '');
}

function scriptless(value: string): string {
  return value.replace(/[_^]/g, '');
}

function addCandidate(candidates: Set<string>, value: string) {
  const compacted = compactMathText(value);
  if (compacted) candidates.add(compacted);
}

export function latexToReadableCandidates(symbol: string): string[] {
  const candidates = new Set<string>();
  const raw = symbol.trim();
  if (!raw) return [];

  const unwrapped = unwrapSimpleScripts(raw);
  const readable = replaceLatexCommands(unwrapped);
  const fractionReadable = replaceSimpleFractions(unwrapped);
  const literal = unwrapped.replace(/\\/g, '');
  const withoutPowers = readable.replace(/\^/g, '');

  [
    raw,
    unwrapped,
    readable,
    fractionReadable,
    withoutPowers,
    scriptless(readable),
    scriptless(literal),
  ].forEach((candidate) => addCandidate(candidates, candidate));

  if (/\\imath(?=[\s_^{]|$)/.test(raw)) {
    addCandidate(candidates, '\ue131');
  }

  const overlineMatch = raw.match(/\\(?:overline|bar)\{([^{}]+)\}/);
  if (overlineMatch?.[1]) {
    const hasOutsideScript = /\\(?:overline|bar)\{[^{}]+\}[_^]/.test(raw);
    const inner = replaceLatexCommands(overlineMatch[1]);
    if (!hasOutsideScript) {
      addCandidate(candidates, inner);
      if (inner === 'ı') {
        addCandidate(candidates, 'i');
        addCandidate(candidates, '\ue131');
      }
    }
    addCandidate(candidates, `${inner}bar`);
    addCandidate(candidates, `${inner}\u0305`);
  }

  return [...candidates].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function latexForTokenScan(value: string): string {
  let next = unwrapSimpleScripts(value)
    .replace(/\\partial(?=[\s_^{]|$)/g, '∂')
    .replace(/\\(?:dfrac|tfrac|frac)\b/g, ' ')
    .replace(/\\(?:left|right)(?=[()[\]{}|.]|\\[{}])/g, ' ')
    .replace(/\\(?:mathrm|mathbf|mathit|operatorname|boldsymbol|overline|bar|hat|tilde)\b/g, ' ')
    .replace(/\\bf\b/g, ' ');

  GREEK_COMMANDS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  return next
    .replace(/\\[A-Za-z]+/g, ' ')
    .replace(/[{}_^()[\],;:+\-−=*/|]/g, ' ');
}

export function latexToMathTokens(symbol: string): string[] {
  const tokens = new Set<string>();
  const source = latexForTokenScan(symbol);
  const rawTokens = source.match(/[0-9]+[A-Za-z]+|[A-Za-z]+|[0-9]+|[∂Α-Ωα-ω]/gu) || [];

  rawTokens.forEach((token) => {
    const compacted = compactMathText(token);
    if (!compacted) return;
    tokens.add(compacted);

    const parts = compacted.match(/[0-9]+|[A-Za-z]+|[∂Α-Ωα-ω]/gu) || [];
    parts.forEach((part) => {
      const compactedPart = compactMathText(part);
      if (compactedPart) tokens.add(compactedPart);
    });
  });

  return [...tokens].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function symbolRequiresOverline(symbol: string): boolean {
  return /\\(?:overline|bar)\s*\{/.test(symbol);
}
