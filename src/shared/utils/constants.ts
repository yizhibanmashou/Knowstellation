export const COLORS = {
  starfieldBg1: '#06060f',
  starfieldBg2: '#0d1117',
  sphereGradient: ['#1a5276', '#2e86c1', '#27ae60', '#8B7355'],
  canvasBg: '#f0f4f8',
  nodeBg: '#ffffff',
  nodeShadow: '0 2px 8px rgba(0,0,0,0.08)',
  focusGlow: '#3b82f6',
  intraChapterEdge: '#94a3b8',
  crossChapterExact: '#6366f1',
  crossChapterFamily: '#a5b4fc',
  viaLabelBg: 'rgba(148, 163, 184, 0.2)',
  variableDefLine: '#d1d5db',
  searchBg: 'rgba(15, 23, 42, 0.85)',
  searchBorder: 'rgba(148, 163, 184, 0.3)',
};

export function chapterColor(chapter: number): string {
  if (chapter <= 6) return '#3b82f6';
  if (chapter <= 12) return '#10b981';
  if (chapter <= 18) return '#f59e0b';
  if (chapter <= 24) return '#ef4444';
  return '#8b5cf6';
}

export function formulaChapter(formulaId: string): string {
  const appendixMatch = formulaId.match(/formula_A(\d+)/i);
  if (appendixMatch) return `appendix${appendixMatch[1]}`;
  const match = formulaId.match(/formula_(\d+)/);
  return match ? `chapter${match[1]}` : 'chapter1';
}

export function displayChapterId(chapterId?: string, fallbackChapter?: number | string): string {
  if (!chapterId) return fallbackChapter ? `Chapter ${fallbackChapter}` : 'Chapter';
  const appendixMatch = chapterId.match(/^appendix(\d+)$/i);
  if (appendixMatch) return `Appendix ${appendixMatch[1]}`;
  const chapterMatch = chapterId.match(/^chapter(\d+)$/i);
  if (chapterMatch) return `Chapter ${chapterMatch[1]}`;
  return chapterId;
}

export function compactChapterId(chapterId?: string, fallbackChapter?: number | string): string {
  if (!chapterId) return fallbackChapter ? String(fallbackChapter) : 'Chapter';
  const appendixMatch = chapterId.match(/^appendix(\d+)$/i);
  if (appendixMatch) return `A${appendixMatch[1]}`;
  const chapterMatch = chapterId.match(/^chapter(\d+)$/i);
  if (chapterMatch) return chapterMatch[1];
  return chapterId;
}

export function chapterRank(chapterId?: string, fallback = 0): number {
  if (!chapterId) return fallback;
  const appendixMatch = chapterId.match(/^appendix(\d+)$/i);
  if (appendixMatch) return 30 + Number(appendixMatch[1]);
  const chapterMatch = chapterId.match(/^chapter(\d+)$/i);
  if (chapterMatch) return Number(chapterMatch[1]);
  return fallback;
}

export function rawFormulaNumber(formulaId: string): string {
  return formulaId.replace(/^formula_/, '');
}
