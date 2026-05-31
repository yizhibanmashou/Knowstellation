import { readBracedGroup, skipWhitespace } from '../../utils/latexHelpers.ts';
import { compactMathText, latexToMathTokens, latexToReadableCandidates, symbolRequiresOverline } from '../../utils/mathSymbolMatching';
import type { MathAnnotation } from './MathFormula';

interface FractionProfile {
  numeratorCandidates: string[];
  denominatorCandidates: string[];
  numeratorTokens: string[];
  denominatorTokens: string[];
  derivative: boolean;
}

function buildFractionProfile(symbol: string): FractionProfile | null {
  const match = /\\(?:dfrac|tfrac|frac)\b/.exec(symbol);
  if (!match) return null;
  const numeratorStart = skipWhitespace(symbol, match.index + match[0].length);
  const numerator = readBracedGroup(symbol, numeratorStart);
  if (!numerator) return null;
  const denominatorStart = skipWhitespace(symbol, numerator.end);
  const denominator = readBracedGroup(symbol, denominatorStart);
  if (!denominator) return null;

  return {
    numeratorCandidates: latexToReadableCandidates(numerator.value),
    denominatorCandidates: latexToReadableCandidates(denominator.value),
    numeratorTokens: latexToMathTokens(numerator.value),
    denominatorTokens: latexToMathTokens(denominator.value),
    derivative: /\\partial|∂/.test(numerator.value) || /\\partial|∂/.test(denominator.value),
  };
}

function clearAnnotations(root: HTMLElement) {
  root.querySelectorAll('.math-symbol-hotspot').forEach((node) => {
    node.classList.remove('math-symbol-hotspot');
    node.removeAttribute('data-note');
    node.removeAttribute('data-symbol');
    node.removeAttribute('data-text');
    node.removeAttribute('data-kind');
    node.removeAttribute('data-compound-shape');
    node.removeAttribute('data-status');
    node.removeAttribute('tabindex');
    node.removeAttribute('aria-label');
  });
}

function compactNeighborhoodText(element: HTMLElement): string {
  const parent = element.parentElement;
  const previous = element.previousElementSibling;
  const next = element.nextElementSibling;
  const grandparent = parent?.parentElement;
  const text = [
    previous?.textContent || '',
    element.textContent || '',
    next?.textContent || '',
    parent && parent.children.length <= 4 ? parent.textContent || '' : '',
    grandparent && grandparent.children.length <= 4 ? grandparent.textContent || '' : '',
  ].join('');
  return compactMathText(text);
}

function compactSiblingWindowText(element: HTMLElement): string {
  const parent = element.parentElement;
  if (!parent) return compactNeighborhoodText(element);

  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(element);
  if (index < 0) return compactNeighborhoodText(element);

  const text: string[] = [];
  for (let offset = -5; offset <= 5; offset += 1) {
    const sibling = siblings[index + offset];
    if (sibling) text.push(sibling.textContent || '');
  }

  const parentSiblings = parent.parentElement ? Array.from(parent.parentElement.children) : [];
  const parentIndex = parentSiblings.indexOf(parent);
  if (parentIndex >= 0) {
    for (let offset = -2; offset <= 2; offset += 1) {
      const sibling = parentSiblings[parentIndex + offset];
      if (sibling && sibling !== parent) text.push(sibling.textContent || '');
    }
  }

  return compactMathText(text.join(''));
}

function compactAncestorWindowText(element: HTMLElement): string {
  const text: string[] = [element.textContent || ''];
  let current: HTMLElement = element;

  for (let depth = 0; depth < 4; depth += 1) {
    const parent = current.parentElement;
    if (!parent || parent.classList.contains('katex-html')) break;

    text.push(parent.textContent || '');
    const siblings: Element[] = parent.parentElement ? Array.from(parent.parentElement.children) : [];
    const index = siblings.indexOf(parent);
    if (index >= 0) {
      for (let offset = -3; offset <= 3; offset += 1) {
        const sibling = siblings[index + offset];
        if (sibling) text.push(sibling.textContent || '');
      }
    }

    current = parent;
  }

  return compactMathText(text.join(''));
}

function textMatchesCandidate(text: string, candidate: string): boolean {
  if (!candidate) return false;
  if (text === candidate) return true;
  if (/[=+\-∂/∑×∗()[\]]/.test(text)) return false;
  return candidate.length >= 2 && text.includes(candidate) && text.length <= candidate.length + 3;
}

function compoundTextMatchesCandidate(text: string, candidate: string): boolean {
  if (!candidate) return false;
  if (text === candidate) return true;
  return candidate.length >= 3 && text.includes(candidate);
}

function isOverbroadCompoundTarget(text: string, candidate: string): boolean {
  if (!candidate) return false;
  if (text.includes('=') && !candidate.includes('=')) return true;
  if (!/[+\-∑/=]/.test(text.replace(candidate, ''))) return false;
  return text.length > Math.max(candidate.length * 2.5, candidate.length + 14);
}

function candidateBase(candidate: string): string {
  return candidate.match(/[A-Za-zΑ-Ωα-ω]/u)?.[0] || candidate[0] || '';
}

function isOneMinusCandidate(candidate: string): boolean {
  return /^\(?1-/.test(candidate);
}

function isFractionCandidate(candidate: string): boolean {
  return /^(?:\\)?(?:dfrac|tfrac|frac)\{/.test(candidate) || candidate.includes('/');
}

function isPoweredGroupCandidate(candidate: string): boolean {
  return /^\(.+\)\^/.test(candidate) || /^\(.+\)\d+$/.test(candidate);
}

function isDerivativeCandidate(candidate: string): boolean {
  return /∂|partial/.test(candidate);
}

function isOneMinusLocalContext(text: string): boolean {
  const normalized = text.replace(/−/g, '-');
  return /(?:1-|\(1|-[A-Za-zΑ-Ωα-ω]|[A-Za-zΑ-Ωα-ω][A-Za-zΑ-Ωα-ω_]*\)\d|\)\d)/u.test(normalized);
}

function isFractionLocalContext(text: string): boolean {
  return /\/|—|∂[A-Za-zΑ-Ωα-ω0-9][A-Za-zΑ-Ωα-ω0-9_]*[A-Za-zΑ-Ωα-ω0-9]/u.test(text);
}

function isPoweredGroupLocalContext(text: string): boolean {
  return /\)\d|\)\^|[+\-∑(][A-Za-zΑ-Ωα-ω0-9]|[A-Za-zΑ-Ωα-ω0-9][+\-∑)]/u.test(text);
}

function isTransposeGroupLocalContext(text: string): boolean {
  return /\)[TΤ]/u.test(text) && /[+\-∑(]/.test(text);
}

function candidateTokensPresent(text: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const meaningful = tokens.filter((token) => token.length > 1 || /[A-Za-zΑ-Ωα-ω∂]/u.test(token));
  if (!meaningful.length) return true;
  return meaningful.every((token) => text.includes(token));
}

function candidateGroupMatchesText(text: string, candidates: string[], tokens: string[]): boolean {
  if (candidates.some((candidate) => compoundTextMatchesCandidate(text, candidate))) return true;
  return tokens.length ? tokens.every((token) => text.includes(token)) : false;
}

function splitFractionElementText(element: HTMLElement): { numeratorText: string; denominatorText: string; fullText: string } | null {
  const fraction = element.classList.contains('mfrac') ? element : null;
  if (!fraction) return null;
  const vlist = fraction.querySelector<HTMLElement>('.vlist');
  if (!vlist) return null;
  const rows = Array.from(vlist.children)
    .map((child) => compactMathText(child.textContent || ''))
    .filter((text) => text && !/^\u200b?$/.test(text) && !/^[-—]+$/.test(text));

  const withoutLine = rows.filter((text) => text !== '—' && text !== '-');
  const denominatorText = withoutLine[0] || '';
  const numeratorText = withoutLine[withoutLine.length - 1] || '';
  return {
    numeratorText,
    denominatorText,
    fullText: compactMathText(fraction.textContent || ''),
  };
}

function fractionProfileMatchesElement(element: HTMLElement, profile?: FractionProfile | null): boolean {
  if (!profile) return true;
  const parts = splitFractionElementText(element);
  if (!parts) return false;
  return (
    candidateGroupMatchesText(parts.numeratorText, profile.numeratorCandidates, profile.numeratorTokens) &&
    candidateGroupMatchesText(parts.denominatorText, profile.denominatorCandidates, profile.denominatorTokens)
  );
}

function compoundStructureMatchesText(text: string, candidate: string, tokens: string[]): boolean {
  if (!candidateTokensPresent(text, tokens)) return false;
  if (isOneMinusCandidate(candidate)) return /1-/.test(text) && (text.includes('/') || /\d+[A-Za-zΑ-Ωα-ω]/u.test(text) || /-[A-Za-zΑ-Ωα-ω]/u.test(text));
  if (isDerivativeCandidate(candidate)) return text.includes('∂');
  if (isFractionCandidate(candidate)) return text.includes('/') || text.includes('∂') || candidateTokensPresent(text, tokens);
  if (isPoweredGroupCandidate(candidate)) {
    if (/\)[TΤ]/u.test(candidate)) return isTransposeGroupLocalContext(text);
    return isPoweredGroupLocalContext(text);
  }
  return false;
}

function isScriptedInitialValueContext(text: string, candidate: string): boolean {
  return /\(0\)/.test(candidate) && /(?:\(0|0\)|\(0\))/.test(text) && candidateTokensPresent(text, latexToMathTokens(candidate));
}

function isStructuredCompoundCandidate(candidate: string): boolean {
  return isOneMinusCandidate(candidate) || isFractionCandidate(candidate) || isPoweredGroupCandidate(candidate) || isDerivativeCandidate(candidate);
}

function isCompoundGroupingTarget(
  element: HTMLElement,
  candidate: string,
  ownText: string,
  neighborhoodText: string,
  siblingWindowText: string,
  ancestorWindowText: string,
): boolean {
  const className = String(element.className || '');
  const broadText = `${neighborhoodText}${siblingWindowText}${ancestorWindowText}`;
  if (isOneMinusCandidate(candidate)) {
    if (!isOneMinusLocalContext(broadText)) return false;
    if (className.includes('mopen') || className.includes('mclose') || className.includes('mbin')) return true;
    return className.includes('vlist') || (element.children.length > 0 && !className.includes('mfrac')) || /^[()1+\-∑/^0-9]+$/.test(ownText);
  }
  if (isFractionCandidate(candidate)) {
    if (!isFractionLocalContext(broadText)) return false;
    return className.includes('mfrac') || className.includes('frac-line') || className.includes('vlist') || element.children.length > 0 || ownText.length >= 2;
  }
  if (isPoweredGroupCandidate(candidate)) {
    const hasPoweredContext = /\)[TΤ]/u.test(candidate) ? isTransposeGroupLocalContext(broadText) : isPoweredGroupLocalContext(broadText);
    if (!hasPoweredContext) return false;
    if (className.includes('mopen') || className.includes('mclose') || className.includes('mbin')) return true;
    return element.children.length > 0 || /^[()0-9+\-∑/^]+$/.test(ownText);
  }
  return true;
}

function compoundWindowMatchesElement(
  ownText: string,
  neighborhoodText: string,
  siblingWindowText: string,
  ancestorWindowText: string,
  candidate: string,
  tokens: string[],
): boolean {
  if (compoundTextMatchesCandidate(ownText, candidate) || compoundTextMatchesCandidate(neighborhoodText, candidate)) return true;
  if (compoundTextMatchesCandidate(siblingWindowText, candidate) || compoundStructureMatchesText(siblingWindowText, candidate, tokens)) {
    if (isOneMinusCandidate(candidate)) return isOneMinusLocalContext(neighborhoodText) || isOneMinusLocalContext(siblingWindowText);
    if (isFractionCandidate(candidate)) return isFractionLocalContext(neighborhoodText) || isFractionLocalContext(siblingWindowText);
    if (isPoweredGroupCandidate(candidate)) return isPoweredGroupLocalContext(neighborhoodText) || isPoweredGroupLocalContext(siblingWindowText);
    return true;
  }
  if (!compoundStructureMatchesText(ancestorWindowText, candidate, tokens)) return false;
  if (isOneMinusCandidate(candidate)) return isOneMinusLocalContext(neighborhoodText) || isOneMinusLocalContext(ancestorWindowText);
  if (isFractionCandidate(candidate)) return isFractionLocalContext(neighborhoodText) || isFractionLocalContext(ancestorWindowText);
  if (isPoweredGroupCandidate(candidate)) {
    return /\)[TΤ]/u.test(candidate)
      ? isTransposeGroupLocalContext(neighborhoodText) || isTransposeGroupLocalContext(ancestorWindowText)
      : isPoweredGroupLocalContext(neighborhoodText) || isPoweredGroupLocalContext(ancestorWindowText);
  }
  return isScriptedInitialValueContext(neighborhoodText, candidate) || compoundTextMatchesCandidate(siblingWindowText, candidate);
}

function annotationMatchesElement(
  element: HTMLElement,
  annotation: MathAnnotation & { candidates: string[]; tokens: string[]; fractionProfile: FractionProfile | null; requiresOverline: boolean },
): boolean {
  const { candidates, requiresOverline, kind, tokens, fractionProfile } = annotation;
  if (requiresOverline && !/(overline|accent)/.test(String(element.className || ''))) return false;
  const ownText = compactMathText(element.textContent || '');
  if (kind === 'formula') return false;
  const neighborhoodText = compactNeighborhoodText(element);
  const siblingWindowText = kind === 'compound' ? compactSiblingWindowText(element) : '';
  const ancestorWindowText = kind === 'compound' ? compactAncestorWindowText(element) : '';
  return candidates.some((candidate) => {
    if (kind === 'compound') {
      if (fractionProfile && !element.classList.contains('mfrac')) return false;
      if (!fractionProfile && isOverbroadCompoundTarget(ownText, candidate)) return false;
      return (
        fractionProfileMatchesElement(element, fractionProfile) &&
        isCompoundGroupingTarget(element, candidate, ownText, neighborhoodText, siblingWindowText, ancestorWindowText) &&
        compoundWindowMatchesElement(ownText, neighborhoodText, siblingWindowText, ancestorWindowText, candidate, tokens)
      );
    }
    if (textMatchesCandidate(ownText, candidate)) return true;
    const base = candidateBase(candidate);
    return Boolean(base && ownText.includes(base) && textMatchesCandidate(neighborhoodText, candidate));
  });
}

function annotationTargetScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const className = String(element.className || '');
  let score = 0;
  if (className.includes('mord')) score += 20;
  if (className.includes('mathnormal')) score -= 8;
  if (className.includes('vlist')) score -= 10;
  if (element.children.length > 0) score += 6;
  if (rect.width >= 8) score += 4;
  if (rect.height >= 8) score += 4;
  return score;
}

function maxTargetsForAnnotation(annotation: MathAnnotation): number {
  if (annotation.kind !== 'compound') return 24;
  const candidates = latexToReadableCandidates(annotation.symbol);
  if (candidates.some((candidate) => isStructuredCompoundCandidate(candidate))) return 3;
  return 1;
}

export function annotateRenderedMath(root: HTMLElement, annotations: MathAnnotation[]) {
  clearAnnotations(root);
  const available = annotations
    .filter((item) => item.symbol && item.note)
    .map((item) => ({
      ...item,
      candidates: latexToReadableCandidates(item.symbol),
      tokens: item.kind === 'compound' ? latexToMathTokens(item.symbol) : [],
      fractionProfile: item.kind === 'compound' && /^\\(?:dfrac|tfrac|frac)\b/.test(item.symbol.trim()) ? buildFractionProfile(item.symbol) : null,
      requiresOverline: symbolRequiresOverline(item.symbol),
    }))
    .sort((a, b) => {
      const kindRank = (value?: MathAnnotation['kind']) => (value === 'compound' ? 3 : value === 'symbol' ? 2 : 1);
      return kindRank(b.kind) - kindRank(a.kind) || b.symbol.length - a.symbol.length;
    });

  if (!available.length) return;

  const elements = [...root.querySelectorAll<HTMLElement>('.katex-html span')].filter((element) => {
    const text = compactMathText(element.textContent || '');
    if (element.children.length > 16 && text.length > 28) return false;
    return text.length >= 1 && text.length <= 28;
  });

  for (const annotation of available) {
    const matches = elements.filter((element) => {
      if (element.closest('.math-symbol-hotspot') || element.querySelector('.math-symbol-hotspot')) return false;
      if (annotation.kind === 'compound' && element.dataset.kind === 'compound') return false;
      if (annotation.kind === 'symbol' && element.dataset.kind === 'compound') return false;
      return annotationMatchesElement(element, annotation);
    }).sort((a, b) => annotationTargetScore(b) - annotationTargetScore(a));

    const targets: HTMLElement[] = [];
    const maxTargets = maxTargetsForAnnotation(annotation);
    for (const match of matches) {
      if (targets.some((target) => target.contains(match) || match.contains(target))) continue;
      targets.push(match);
      if (targets.length >= maxTargets) break;
    }
    for (const target of targets) {
      target.classList.add('math-symbol-hotspot');
      target.setAttribute('data-note', annotation.note);
      target.setAttribute('data-symbol', annotation.symbol);
      target.setAttribute('data-text', annotation.text || '');
      target.setAttribute('data-kind', annotation.kind || 'symbol');
      if (annotation.kind === 'compound' && annotation.fractionProfile) {
        target.setAttribute('data-compound-shape', 'fraction');
      }
      target.setAttribute('data-status', annotation.status || 'ready');
      target.setAttribute('tabindex', '0');
      target.setAttribute('aria-label', `${annotation.symbol}: ${annotation.note}`);
    }
  }
}
