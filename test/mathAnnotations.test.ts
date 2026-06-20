import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __testing } from '../src/shared/components/mathAnnotations.ts';
import { latexToMathTokens, latexToReadableCandidates } from '../src/shared/utils/mathSymbolMatching.ts';

class FakeMathElement {
  textContent: string;
  className: string;
  children: FakeMathElement[] = [];
  parentElement: FakeMathElement | null = null;
  previousElementSibling: FakeMathElement | null = null;
  nextElementSibling: FakeMathElement | null = null;
  classList: { contains: (name: string) => boolean };
  dataset: Record<string, string> = {};

  constructor(textContent: string, className = '') {
    this.textContent = textContent;
    this.className = className;
    this.classList = {
      contains: (name: string) => this.className.split(/\s+/).includes(name),
    };
  }

  private hasClass(name: string) {
    return this.className.split(/\s+/).includes(name);
  }

  private matchesSelector(selector: string) {
    return selector
      .split(',')
      .map((item) => item.trim())
      .some((item) => item.startsWith('.') && this.hasClass(item.slice(1)));
  }

  querySelector(selector: string): FakeMathElement | null {
    for (const child of this.children) {
      if (child.matchesSelector(selector)) return child;
      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }
    return null;
  }

  closest(selector: string): FakeMathElement | null {
    let current: FakeMathElement | null = this;
    while (current) {
      if (current.matchesSelector(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

function appendChildren(parent: FakeMathElement, children: FakeMathElement[]) {
  parent.children = children;
  children.forEach((child, index) => {
    child.parentElement = parent;
    child.previousElementSibling = children[index - 1] || null;
    child.nextElementSibling = children[index + 1] || null;
  });
}

function compoundAnnotation(symbol: string) {
  return {
    symbol,
    note: 'compound note',
    kind: 'compound' as const,
    candidates: latexToReadableCandidates(symbol),
    tokens: latexToMathTokens(symbol),
    fractionProfile: null,
    requiresOverline: false,
  };
}

function formulaRowWithTarget(target: FakeMathElement) {
  const row = new FakeMathElement('Ht=H0(1-1/2N)t', 'base');
  const equals = new FakeMathElement('=', 'mrel');
  const h0 = new FakeMathElement('H0', 'mord');
  const factor = new FakeMathElement('(1-1/2N)t', 'minner');
  const root = new FakeMathElement(row.textContent, 'katex-html');

  appendChildren(row, [target, equals, h0, factor]);
  appendChildren(root, [row]);

  return { target, factor };
}

function scriptedSymbol(text: string) {
  const element = new FakeMathElement(text, 'mord');
  appendChildren(element, [
    new FakeMathElement(text[0] || '', 'mathnormal'),
    new FakeMathElement(text.slice(1), 'msupsub'),
  ]);
  return element;
}

function symbolAnnotation(symbol: string, requiresOverline = false) {
  return {
    symbol,
    note: 'symbol note',
    kind: 'symbol' as const,
    candidates: latexToReadableCandidates(symbol),
    tokens: [],
    fractionProfile: null,
    requiresOverline,
  };
}

test('compound powered groups do not bind to nearby scripted symbols', () => {
  const annotation = compoundAnnotation('(1-\\frac{1}{2N})^t');
  const ht = formulaRowWithTarget(scriptedSymbol('Ht')).target;
  const h0 = formulaRowWithTarget(scriptedSymbol('H0')).target;
  const factor = formulaRowWithTarget(scriptedSymbol('Ht')).factor;

  assert.equal(__testing.annotationMatchesElement(ht as unknown as HTMLElement, annotation), false);
  assert.equal(__testing.annotationMatchesElement(h0 as unknown as HTMLElement, annotation), false);
  assert.equal(__testing.annotationMatchesElement(factor as unknown as HTMLElement, annotation), true);
});

test('overline symbols match text inside KaTeX accent ancestors only', () => {
  const annotation = symbolAnnotation('\\overline{z}', true);
  const accented = new FakeMathElement('z', 'mord accent');
  const accentBody = new FakeMathElement('z', 'accent-body');
  const z = new FakeMathElement('z', 'mathnormal');
  appendChildren(accentBody, [z]);
  appendChildren(accented, [accentBody]);

  const plain = new FakeMathElement('z', 'mathnormal');

  assert.equal(__testing.annotationMatchesElement(z as unknown as HTMLElement, annotation), true);
  assert.equal(__testing.annotationMatchesElement(plain as unknown as HTMLElement, annotation), false);
});

test('bare symbols do not claim starred script targets', () => {
  const bare = symbolAnnotation('\\mu');
  const starred = symbolAnnotation('\\mu^{*}');
  const target = new FakeMathElement('μ∗', 'mord');

  assert.equal(__testing.annotationMatchesElement(target as unknown as HTMLElement, bare), false);
  assert.equal(__testing.annotationMatchesElement(target as unknown as HTMLElement, starred), true);
});

test('single-letter coefficients can bind when KaTeX joins them to Greek symbols', () => {
  const coefficient = symbolAnnotation('b');
  const joined = new FakeMathElement('bσ', 'mord mathnormal');

  assert.equal(__testing.annotationMatchesElement(joined as unknown as HTMLElement, coefficient), true);
});

test('symbol annotations do not absorb trailing binary operators', () => {
  const timedVariance = symbolAnnotation('\\sigma_{g}^{2}(t)');
  const withOperator = new FakeMathElement('σg2(t)+', 'base');
  const exact = new FakeMathElement('σg2(t)', 'base');
  const base = new FakeMathElement('σg2', 'mord');
  appendChildren(withOperator, [
    base,
    new FakeMathElement('t', 'mord mathnormal'),
    new FakeMathElement('+', 'mbin'),
  ]);

  assert.equal(__testing.annotationMatchesElement(withOperator as unknown as HTMLElement, timedVariance), false);
  assert.equal(__testing.annotationMatchesElement(exact as unknown as HTMLElement, timedVariance), true);
  assert.equal(__testing.annotationMatchesElement(base as unknown as HTMLElement, timedVariance), true);
  assert.equal(__testing.symbolTargetBeforeTrailingOperator(withOperator as unknown as HTMLElement, timedVariance), base);
});

test('component symbols can nest inside composite hotspots without script fallback', () => {
  const product = new FakeMathElement('δi', 'mord math-symbol-hotspot');
  product.dataset = { kind: 'symbol', symbol: 'w_{i}\\overline{\\delta}_{i}' };
  const powered = new FakeMathElement('p3', 'mord math-symbol-hotspot');
  powered.dataset = { kind: 'symbol', symbol: 'p^{3}' };
  const timed = new FakeMathElement('σg2', 'mord math-symbol-hotspot');
  timed.dataset = { kind: 'symbol', symbol: '\\sigma_{g}^{2}(t)' };
  const accented = new FakeMathElement('z', 'mord math-symbol-hotspot');
  accented.dataset = { kind: 'symbol', symbol: '\\overline{z}' };

  assert.equal(__testing.canNestSymbolWithinHotspot(product as unknown as HTMLElement, symbolAnnotation('\\overline{\\delta}_{i}')), true);
  assert.equal(__testing.canNestSymbolWithinHotspot(powered as unknown as HTMLElement, symbolAnnotation('p')), false);
  assert.equal(__testing.canNestSymbolWithinHotspot(timed as unknown as HTMLElement, symbolAnnotation('\\sigma_{g}^{2}')), false);
  assert.equal(__testing.canNestSymbolWithinHotspot(accented as unknown as HTMLElement, symbolAnnotation('z')), false);
});
