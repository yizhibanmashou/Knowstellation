import type { StarNode } from '../starfield/starNavigation';
import type { ConceptReference, ConceptView } from '../../shared/types/conceptGraph';
import type { ConceptNavigationEntry } from '../../shared/types/search';
import type { ChapterLayer } from '../../shared/types/learning';
import { DEFAULT_LANGUAGE, formatConceptTitle, formatFormulaReferenceLabel } from '../../shared/utils/uiCopy.ts';

export type ConceptLearningSource = 'adjacent' | 'chapter_sequence' | 'chapter_loop';

export interface ConceptLearningStep {
  node: StarNode;
  index: number;
  total: number;
  progressLabel: string;
  conceptId: string;
  formulaId: string;
  title: string;
  formulaLabel?: string;
  source: ConceptLearningSource;
  prerequisiteConceptIds: string[];
  relatedConceptIds: string[];
  locked: boolean;
  lockedReason?: string;
}

export interface ConceptLearningTarget {
  node?: StarNode;
  conceptId: string;
  formulaId: string;
  title: string;
  formulaLabel?: string;
  progressLabel: string;
  source: ConceptLearningSource;
  locked?: boolean;
}

export interface ConceptLearningNav {
  current: ConceptLearningStep | null;
  next: ConceptLearningStep | null;
  nextFromCurrent: ConceptLearningTarget | null;
  steps: ConceptLearningStep[];
  chapterId: string;
  layer: ChapterLayer;
}

export function createConceptLearningStep(
  node: StarNode,
  index: number,
  total: number,
  source: ConceptLearningSource = 'chapter_sequence',
  navigationEntry?: ConceptNavigationEntry,
  learnedConceptIds: Set<string> = new Set(),
  layer: ChapterLayer = 'backbone',
): ConceptLearningStep {
  const prerequisiteConceptIds = navigationEntry?.prerequisite_concept_ids || [];
  const missingPrerequisites = prerequisiteConceptIds.filter((conceptId) => !learnedConceptIds.has(conceptId));
  const locked = layer === 'backbone' && missingPrerequisites.length > 0;
  const relatedConceptIds = node.relatedConceptIds?.length ? node.relatedConceptIds : [node.conceptId || ''].filter(Boolean);
  return {
    node,
    index,
    total,
    progressLabel: `概念 ${index + 1} / ${total}`,
    conceptId: node.conceptId || '',
    formulaId: node.formulaId || '',
    title: formatConceptTitle(node.title, node.symbol, DEFAULT_LANGUAGE),
    formulaLabel: formatFormulaReferenceLabel(node.formulaLabel, DEFAULT_LANGUAGE),
    source,
    prerequisiteConceptIds,
    relatedConceptIds,
    locked,
    lockedReason: locked ? '前置概念完成后解锁' : undefined,
  };
}

function targetFromReference(reference: ConceptReference, currentView: ConceptView): ConceptLearningTarget | null {
  const referenceViewId = reference.view_id || reference.concept_id;
  const currentViewId = currentView.view_id || currentView.concept_id;
  if (!referenceViewId || referenceViewId === currentViewId || reference.clickable === false) return null;
  const formulaId = reference.defined_by_formula_id || reference.from_formula_id || currentView.defined_by_formula_id;
  if (!formulaId) return null;
  return {
    conceptId: referenceViewId,
    formulaId,
    title: formatConceptTitle(reference.name || reference.symbol || reference.concept_id, reference.symbol || reference.via_symbol, DEFAULT_LANGUAGE),
    formulaLabel: formatFormulaReferenceLabel(reference.formula_label || currentView.supporting_formula_label, DEFAULT_LANGUAGE),
    progressLabel: '相邻概念',
    source: 'adjacent',
  };
}

function firstAdjacentTarget(currentView: ConceptView | null | undefined, chapterSteps: ConceptLearningStep[]): ConceptLearningTarget | null {
  if (!currentView) return null;
  for (const reference of currentView.prerequisite_concepts) {
    const target = targetFromReference(reference, currentView);
    const matchingStep = target ? chapterSteps.find((step) =>
      step.conceptId === target.conceptId
      || step.conceptId === reference.concept_id
      || step.relatedConceptIds.includes(target.conceptId)
      || step.relatedConceptIds.includes(reference.concept_id)
    ) : null;
    if (matchingStep?.locked) continue;
    if (target) return target;
  }
  return null;
}

function targetFromStep(step: ConceptLearningStep, source: ConceptLearningSource = 'chapter_sequence'): ConceptLearningTarget {
  return {
    node: step.node,
    conceptId: step.conceptId,
    formulaId: step.formulaId,
    title: step.title,
    formulaLabel: step.formulaLabel,
    progressLabel: step.progressLabel,
    source,
    locked: step.locked,
  };
}

function firstSequenceTarget(current: ConceptLearningStep | null | undefined, next: ConceptLearningStep | null | undefined, chapterSteps: ConceptLearningStep[]): ConceptLearningTarget | null {
  const currentIndex = current ? chapterSteps.findIndex((step) => step.conceptId === current.conceptId) : -1;
  const candidates = currentIndex >= 0 ? chapterSteps.slice(currentIndex + 1) : next ? [next] : [];
  const target = candidates.find((step) => step.conceptId && !step.locked);
  if (target) return targetFromStep(target);
  if (currentIndex <= 0) return null;
  const loopTarget = chapterSteps.slice(0, currentIndex).find((step) => step.conceptId && !step.locked);
  return loopTarget ? targetFromStep(loopTarget, 'chapter_loop') : null;
}

export function buildConceptLearningNav(input: {
  chapterId: string;
  nodes: StarNode[];
  routeConceptId?: string | null;
  selectedFormulaId?: string | null;
  currentView?: ConceptView | null;
  conceptNavigation?: ConceptNavigationEntry[];
  learnedConceptIds?: Set<string>;
  layer?: ChapterLayer;
}): ConceptLearningNav | null {
  if (!input.chapterId || !input.nodes.length) return null;
  const navigationLookup = new Map((input.conceptNavigation || []).map((entry) => [entry.concept_id, entry]));
  const learnedConceptIds = input.learnedConceptIds || new Set<string>();
  const layer = input.layer || 'backbone';
  const currentIndex = input.nodes.findIndex((node) =>
    Boolean(input.routeConceptId && (node.conceptId === input.routeConceptId || node.relatedConceptIds?.includes(input.routeConceptId))) ||
    Boolean(!input.routeConceptId && input.selectedFormulaId && node.formulaId === input.selectedFormulaId)
  );
  const steps = input.nodes.map((node, index) => createConceptLearningStep(node, index, input.nodes.length, 'chapter_sequence', node.conceptId ? navigationLookup.get(node.conceptId) : undefined, learnedConceptIds, layer));
  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  const next = currentIndex >= 0 && currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;
  return {
    current,
    next,
    nextFromCurrent: resolveNextConceptFromCurrent({
      currentView: input.currentView,
      current,
      next,
      chapterSteps: steps,
      routeConceptId: input.routeConceptId,
    }),
    steps,
    chapterId: input.chapterId,
    layer,
  };
}

export function resolveNextConceptFromCurrent(input: {
  currentView?: ConceptView | null;
  current?: ConceptLearningStep | null;
  next?: ConceptLearningStep | null;
  chapterSteps: ConceptLearningStep[];
  routeConceptId?: string | null;
}): ConceptLearningTarget | null {
  return firstSequenceTarget(input.current, input.next, input.chapterSteps)
    || firstAdjacentTarget(input.currentView, input.chapterSteps);
}
