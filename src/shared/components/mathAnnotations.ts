import { readBracedGroup, skipWhitespace } from '../utils/latexHelpers.ts';
import { compactMathText, latexToMathTokens, latexToReadableCandidates, symbolRequiresOverline } from '../utils/mathSymbolMatching.ts';

export interface MathAnnotation {
  symbol: string;
  note: string;
  text?: string;
  kind?: 'symbol' | 'compound' | 'formula';
  target?: string;
  status?: 'loading' | 'ready' | 'error';
}

interface FractionProfile {
  numeratorCandidates: string[];
  denominatorCandidates: string[];
  numeratorTokens: string[];
  denominatorTokens: string[];
  derivative: boolean;
  part?: 'numerator' | 'denominator';
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
    part: numerator.value ? (denominator.value ? undefined : 'numerator') : 'denominator',
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
  const remainder = text.startsWith(candidate) ? text.slice(candidate.length) : '';
  if (remainder && !/[A-Za-zΑ-Ωα-ω0-9]/u.test(remainder)) return true;
  if (/[=+\-∂/∑×∗()[\]]/.test(text)) return false;
  if (!(candidate.length >= 2 && text.includes(candidate) && text.length <= candidate.length + 3)) return false;
  const extraText = text.replace(candidate, '');
  return !/[A-Za-zΑ-Ωα-ω0-9]/u.test(extraText);
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
  if (isPoweredGroupCandidate(candidate)) return false;
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

function isCompoundCandidateShape(value: string): boolean {
  return /(?:frac|[()\/+\-∑∂=^])/i.test(value);
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
  if (profile.part === 'numerator') {
    return candidateGroupMatchesText(parts.numeratorText, profile.numeratorCandidates, profile.numeratorTokens);
  }
  if (profile.part === 'denominator') {
    return candidateGroupMatchesText(parts.denominatorText, profile.denominatorCandidates, profile.denominatorTokens);
  }
  return (
    candidateGroupMatchesText(parts.numeratorText, profile.numeratorCandidates, profile.numeratorTokens) &&
    candidateGroupMatchesText(parts.denominatorText, profile.denominatorCandidates, profile.denominatorTokens)
  );
}

function compoundStructureMatchesText(text: string, candidate: string, tokens: string[]): boolean {
  if (!isCompoundCandidateShape(candidate)) return false;
  if (!candidateTokensPresent(text, tokens)) return false;
  if (isOneMinusCandidate(candidate)) return /1-/.test(text) && (text.includes('/') || /\d+[A-Za-zΑ-Ωα-ω]/u.test(text) || /-[A-Za-zΑ-Ωα-ω]/u.test(text));
  if (isPoweredGroupCandidate(candidate)) {
    if (/\)[TΤ]/u.test(candidate)) return isTransposeGroupLocalContext(text);
    return isPoweredGroupLocalContext(text);
  }
  if (isDerivativeCandidate(candidate)) return text.includes('∂');
  if (isFractionCandidate(candidate)) return text.includes('/') || text.includes('∂') || candidateTokensPresent(text, tokens);
  return false;
}

function isScriptedInitialValueContext(text: string, candidate: string): boolean {
  return text === candidate && /\(0\)/.test(candidate);
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
  const localText = `${ownText}${neighborhoodText}`;
  if (isOneMinusCandidate(candidate)) {
    if (!isOneMinusLocalContext(localText)) return false;
    if (className.includes('mopen') || className.includes('mclose') || className.includes('mbin')) return true;
    if (className.includes('minner')) return isOneMinusLocalContext(ownText) || isOneMinusLocalContext(neighborhoodText);
    return ownText === '1' && /1-/.test(neighborhoodText);
  }
  if (isFractionCandidate(candidate)) {
    const isFractionElement = className.includes('mfrac') || className.includes('frac-line') || Boolean(element.closest?.('.mfrac'));
    return isFractionElement && isFractionLocalContext(localText);
  }
  if (isPoweredGroupCandidate(candidate)) {
    const hasPoweredContext = /\)[TΤ]/u.test(candidate)
      ? isTransposeGroupLocalContext(localText)
      : isPoweredGroupLocalContext(localText);
    if (!hasPoweredContext) return false;
    if (className.includes('mopen') || className.includes('mclose') || className.includes('mbin')) return true;
    if (className.includes('minner')) return ownText.startsWith('(') && compoundStructureMatchesText(ownText, candidate, latexToMathTokens(candidate));
    return false;
  }
  return ownText === candidate || isScriptedInitialValueContext(ownText, candidate);
}

function findFractionPartTarget(fraction: HTMLElement, profile: FractionProfile): HTMLElement | null {
  const vlist = fraction.querySelector<HTMLElement>('.vlist');
  if (!vlist || !profile.part) return null;
  const rows = Array.from(vlist.children)
    .map((child) => ({ element: child as HTMLElement, text: compactMathText(child.textContent || '') }))
    .filter((row) => row.text && !/^\u200b?$/.test(row.text) && !/^[-—]+$/.test(row.text));
  if (!rows.length) return null;
  const matchesPart = profile.part === 'numerator'
    ? (text: string) => candidateGroupMatchesText(text, profile.numeratorCandidates, profile.numeratorTokens)
    : (text: string) => candidateGroupMatchesText(text, profile.denominatorCandidates, profile.denominatorTokens);
  const orderedRows = profile.part === 'numerator' ? [...rows].reverse() : rows;
  const row = orderedRows.find((item) => matchesPart(item.text));
  return row ? visibleFractionPartTarget(row.element, matchesPart) : null;
}

function hasUsableTargetRect(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width >= 4 && rect.height >= 4;
}

function visibleFractionPartTarget(row: HTMLElement, matchesPart: (text: string) => boolean): HTMLElement | null {
  if (hasUsableTargetRect(row)) return row;

  const candidates = Array.from(row.querySelectorAll<HTMLElement>('span')).filter((element) => {
    const text = compactMathText(element.textContent || '');
    return text && matchesPart(text) && hasUsableTargetRect(element);
  });
  candidates.sort((a, b) => {
    const score = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const className = String(element.className || '');
      return (className.includes('sizing') ? 80 : 0)
        + (element.children.length ? 16 : 0)
        + (className.includes('mord') ? 8 : 0)
        + rect.width * rect.height;
    };
    return score(b) - score(a);
  });
  return candidates[0] || null;
}

function compoundWindowMatchesElement(
  ownText: string,
  neighborhoodText: string,
  siblingWindowText: string,
  ancestorWindowText: string,
  candidate: string,
  tokens: string[],
): boolean {
  const localText = `${ownText}${neighborhoodText}${siblingWindowText}`;
  if (compoundTextMatchesCandidate(ownText, candidate) || compoundTextMatchesCandidate(neighborhoodText, candidate)) return true;
  if (compoundTextMatchesCandidate(siblingWindowText, candidate) || compoundStructureMatchesText(siblingWindowText, candidate, tokens)) {
    if (isOneMinusCandidate(candidate)) return isOneMinusLocalContext(neighborhoodText) || isOneMinusLocalContext(siblingWindowText);
    if (isFractionCandidate(candidate)) return isFractionLocalContext(neighborhoodText) || isFractionLocalContext(siblingWindowText);
    if (isPoweredGroupCandidate(candidate)) return isPoweredGroupLocalContext(neighborhoodText) || isPoweredGroupLocalContext(siblingWindowText);
    return true;
  }
  if (!compoundStructureMatchesText(localText, candidate, tokens)) return false;
  if (isOneMinusCandidate(candidate)) return isOneMinusLocalContext(neighborhoodText);
  if (isFractionCandidate(candidate)) return isFractionLocalContext(neighborhoodText);
  if (isPoweredGroupCandidate(candidate)) {
    return /\)[TΤ]/u.test(candidate)
      ? isTransposeGroupLocalContext(neighborhoodText)
      : isPoweredGroupLocalContext(neighborhoodText);
  }
  return isScriptedInitialValueContext(neighborhoodText, candidate);
}

function annotationMatchesElement(
  element: HTMLElement,
  annotation: MathAnnotation & { candidates: string[]; tokens: string[]; fractionProfile: FractionProfile | null; requiresOverline: boolean },
): boolean {
  const { candidates, requiresOverline, kind, tokens, fractionProfile } = annotation;
  if (
    requiresOverline &&
    !/(overline|accent)/.test(String(element.className || '')) &&
    !element.querySelector('.accent, .overline')
  ) {
    return false;
  }
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

export const __testing = {
  annotationMatchesElement,
  compactNeighborhoodText,
  compactSiblingWindowText,
  compactAncestorWindowText,
};

function annotationTargetScore(
  element: HTMLElement,
  annotation: MathAnnotation & { candidates: string[] },
): number {
  const rect = element.getBoundingClientRect();
  const className = String(element.className || '');
  const ownText = compactMathText(element.textContent || '');
  let score = 0;
  if (annotation.candidates.some((candidate) => textMatchesCandidate(ownText, candidate))) score += 34;
  if (className.includes('mord')) score += 20;
  if (className.includes('mathnormal')) score -= 8;
  if (className.includes('vlist')) score -= 10;
  if (element.children.length > 0) score += 6;
  if (rect.width >= 8) score += 4;
  if (rect.height >= 8) score += 4;
  return score;
}

function maxTargetsForAnnotation(annotation: MathAnnotation): number {
  if (annotation.kind === 'formula') return 1;
  if (annotation.kind !== 'compound') return 24;
  const candidates = latexToReadableCandidates(annotation.symbol);
  if (candidates.some((candidate) => isStructuredCompoundCandidate(candidate))) return 3;
  return 1;
}

function shouldSkipCandidateElement(
  element: HTMLElement,
  annotation: MathAnnotation & { fractionProfile: FractionProfile | null },
): boolean {
  const ownHotspot = element.classList.contains('math-symbol-hotspot') ? element : null;
  const ancestorHotspot = element.parentElement?.closest<HTMLElement>('.math-symbol-hotspot') || null;
  const descendantHotspot = element.querySelector('.math-symbol-hotspot');

  if (annotation.kind === 'compound') {
    if (annotation.fractionProfile?.part && element.classList.contains('mfrac')) return false;
    return Boolean(ownHotspot || ancestorHotspot || descendantHotspot);
  }

  if (annotation.kind === 'symbol') {
    if (ownHotspot || descendantHotspot) return true;
    return Boolean(ancestorHotspot && ancestorHotspot.dataset.kind !== 'compound');
  }

  return Boolean(ownHotspot || ancestorHotspot || descendantHotspot);
}

function findFractionAnnotationTargets(
  root: HTMLElement,
  annotation: MathAnnotation & { fractionProfile: FractionProfile },
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.katex-html .mfrac')).flatMap((fraction) => {
    if (!fractionProfileMatchesElement(fraction, annotation.fractionProfile)) return [];
    if (annotation.fractionProfile.part) {
      const partTarget = findFractionPartTarget(fraction, annotation.fractionProfile);
      return partTarget ? [partTarget] : [];
    }
    return fraction.classList.contains('math-symbol-hotspot') ? [] : [fraction];
  });
}

export function annotateRenderedMath(root: HTMLElement, annotations: MathAnnotation[]) {
  clearAnnotations(root);
  const available = annotations
    .filter((item) => item.symbol && item.note)
    .map((item) => ({
      ...item,
      candidates: latexToReadableCandidates(item.target || item.symbol).filter((candidate) => item.kind !== 'compound' || isCompoundCandidateShape(candidate)),
      tokens: item.kind === 'compound' ? latexToMathTokens(item.target || item.symbol) : [],
      fractionProfile: item.kind === 'compound' && /^\\(?:dfrac|tfrac|frac)\b/.test((item.target || item.symbol).trim()) ? buildFractionProfile(item.target || item.symbol) : null,
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

  const formulaFallback = available.find((annotation) => annotation.kind === 'formula') || null;
  const primaryAnnotations = formulaFallback
    ? available.filter((annotation) => annotation.kind !== 'formula')
    : available;

  const applyAnnotationToTargets = (annotation: MathAnnotation, targets: HTMLElement[]) => {
    for (const target of targets) {
      target.classList.add('math-symbol-hotspot');
      target.setAttribute('data-note', annotation.note);
      target.setAttribute('data-symbol', annotation.symbol);
      target.setAttribute('data-text', annotation.text || '');
      target.setAttribute('data-kind', annotation.kind || 'symbol');
      if (annotation.kind === 'compound' && (annotation as MathAnnotation & { fractionProfile?: FractionProfile | null }).fractionProfile) {
        const fractionProfile = (annotation as MathAnnotation & { fractionProfile?: FractionProfile | null }).fractionProfile;
        target.setAttribute('data-compound-shape', fractionProfile?.part ? `fraction-${fractionProfile.part}` : 'fraction');
      }
      target.setAttribute('data-status', annotation.status || 'ready');
      target.setAttribute('tabindex', '0');
      target.setAttribute('aria-label', `${annotation.symbol}: ${annotation.note}`);
    }
  };

  for (const annotation of primaryAnnotations) {
    let matches: HTMLElement[];
    if (annotation.kind === 'compound' && annotation.fractionProfile) {
      matches = findFractionAnnotationTargets(root, { ...annotation, fractionProfile: annotation.fractionProfile });
    } else {
      matches = elements.flatMap<HTMLElement>((element) => {
        if (shouldSkipCandidateElement(element, annotation)) return [];
        if (annotation.kind === 'compound' && element.dataset.kind === 'compound') return [];
        if (annotation.kind === 'symbol' && element.dataset.kind === 'compound') return [];
        if (!annotationMatchesElement(element, annotation)) return [];
        return [element];
      });
    }
    matches.sort((a, b) => annotationTargetScore(b, annotation) - annotationTargetScore(a, annotation));

    const targets: HTMLElement[] = [];
    const maxTargets = maxTargetsForAnnotation(annotation);
    for (const match of matches) {
      if (targets.some((target) => target.contains(match) || match.contains(target))) continue;
      targets.push(match);
      if (targets.length >= maxTargets) break;
    }
    applyAnnotationToTargets(annotation, targets);
  }

  if (formulaFallback && root.querySelectorAll('.math-symbol-hotspot').length === 0) {
    applyAnnotationToTargets(
      formulaFallback,
      Array.from(root.querySelectorAll<HTMLElement>('.katex-html')).slice(0, 1),
    );
  }
}
