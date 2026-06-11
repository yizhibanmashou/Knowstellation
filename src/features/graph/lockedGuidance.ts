import type { ChapterDependencies, FormulaPrerequisite } from '../../shared/types/formula';
import { rawFormulaNumber } from '../../shared/utils/constants.ts';

export interface LockedFormulaGuidance {
  formulaId: string;
  label: string;
  viaSymbol?: string;
}

function isAcceptedSameChapterFormulaPrerequisite(prereq: FormulaPrerequisite): boolean {
  return (
    prereq.type === 'formula' &&
    (prereq.edge_status ?? 'accepted') === 'accepted' &&
    Boolean(prereq.target_id) &&
    !prereq.cross_chapter
  );
}

export function resolveLockedFormulaGuidance(
  chapter: ChapterDependencies | null | undefined,
  lockedFormulaId: string,
  learnedFormulaIds: ReadonlySet<string> = new Set(),
): LockedFormulaGuidance | null {
  const dependency = chapter?.dependencies.find((item) => item.dependent_id === lockedFormulaId);
  if (!dependency) return null;

  const blocker = dependency.prerequisites.find(
    (prereq) => isAcceptedSameChapterFormulaPrerequisite(prereq) && prereq.target_id && !learnedFormulaIds.has(prereq.target_id),
  );
  if (!blocker?.target_id) return null;

  const formula = chapter?.formulas.find((item) => item.id === blocker.target_id);
  return {
    formulaId: blocker.target_id,
    label: formula?.label || `Formula ${rawFormulaNumber(blocker.target_id)}`,
    viaSymbol: blocker.via_symbol || blocker.symbol,
  };
}

export function formatLockedFormulaReason(
  fallbackReason: string,
  guidance: LockedFormulaGuidance | null,
): string {
  if (!guidance) return fallbackReason;
  const via = guidance.viaSymbol ? `，因为这里要用到 ${guidance.viaSymbol}` : '';
  return `先读 ${guidance.label}${via}，读完就能解锁这一步。`;
}
