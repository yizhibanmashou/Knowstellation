export interface KeyConceptAnnotation {
  symbol: string;
  note: string;
  kind?: 'symbol' | 'compound' | 'formula';
}

const KEY_CONCEPT_LIMIT = 4;

function normalizeAnnotationKey(value = ''): string {
  return value
    .replace(/\s+/g, '')
    .replace(/_\{([^{}])\}/g, '_$1')
    .replace(/\^\{([^{}])\}/g, '^$1');
}

function isOrdinaryIndexedTerm(symbol = ''): boolean {
  const compact = normalizeAnnotationKey(symbol);
  return /^[A-Za-z]_[a-z]{1,2}i?$/.test(compact) || /^[A-Za-z]_[a-z]$/.test(compact);
}

function isKeyConceptAnnotation(annotation: KeyConceptAnnotation): boolean {
  const symbol = annotation.symbol || '';
  const compact = normalizeAnnotationKey(symbol);
  if (!symbol || annotation.kind === 'formula') return false;
  if (isOrdinaryIndexedTerm(symbol)) return false;
  if (annotation.kind === 'compound') return false;
  return (
    /\\widehat|\\overline|\\bar|\\tilde/.test(symbol) ||
    /_\{?(?:TG|SEW|Fay|MP|[A-Z]{2,})\}?/.test(compact) ||
    /^[A-Z]{2,}(?:_|$)/.test(compact)
  );
}

function keyConceptRank(annotation: KeyConceptAnnotation): number {
  const symbol = annotation.symbol || '';
  if (/\\widehat/.test(symbol)) return 0;
  if (/\\overline|\\bar|\\tilde/.test(symbol)) return 1;
  if (/^NI|N I|_\{?TG\}?/.test(normalizeAnnotationKey(symbol))) return 2;
  if (annotation.kind === 'compound') return 3;
  return 4;
}

export function selectKeyConcepts<T extends KeyConceptAnnotation>(annotations: T[]): T[] {
  const seenNotes = new Set<string>();
  const result: T[] = [];
  for (const annotation of annotations
    .filter(isKeyConceptAnnotation)
    .sort((a, b) => keyConceptRank(a) - keyConceptRank(b) || b.symbol.length - a.symbol.length)) {
    const noteKey = annotation.note.replace(/\s+/g, ' ').trim();
    if (noteKey && seenNotes.has(noteKey)) continue;
    if (noteKey) seenNotes.add(noteKey);
    result.push(annotation);
    if (result.length >= KEY_CONCEPT_LIMIT) break;
  }
  return result;
}
