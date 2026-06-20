import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ReactFlowProvider,
  MarkerType,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import type { ConceptGraphPayload, ConceptReference, ConceptView } from '../../shared/types/conceptGraph';
import type { SearchFormula, StorylineEntry } from '../../shared/types/formula';
import type { ConceptMapNodeData, ConceptNodeData, ConceptRevealGroup, DependencyEdgeData, FormulaExpansionIntent } from '../../shared/types/graph';
import type { ChapterLayer, StudyContext } from '../../shared/types/learning';
import type { ConceptLearningNav } from './conceptLearning';
import { useConceptGraph } from './useConceptGraph';
import { useDependencyGraph } from './useDependencyGraph';
import { useGraphStore, type ConceptViewSnapshot } from './graphStore';
import { DEFAULT_LANGUAGE, formatConceptTitle, formatFormulaReferenceLabel, getUiCopy } from '../../shared/utils/uiCopy';
import { rawFormulaNumber } from '../../shared/utils/constants';
import { GraphCanvasView } from './GraphCanvasView';
import {
  chapterIdForFormula,
  markSelectedFormulaNode,
} from './graphCanvasModel';
import type { GraphStudyMode } from './GraphModeControls';
import type { GraphAtlasProps } from './GraphAtlas';
import { useGraphExpansion, type GuidedExpansionStage } from './useGraphExpansion';
import { useGraphInitialLoad } from './useGraphInitialLoad';
import { useGuidedSymbolExplanations } from './useGuidedSymbolExplanations';
import { useGraphNodeFactory } from './useGraphNodeFactory';
import { getStudyFormulaIds } from '../learning/learningNavigator';
import './GraphView.css';

interface GraphCanvasProps {
  searchIndex: SearchFormula[];
  mode?: GraphStudyMode;
  studyContext: StudyContext;
  storylines: StorylineEntry[];
  conceptLearningNav?: ConceptLearningNav | null;
  conceptLayer?: ChapterLayer;
  onConceptLayerChange?: (layer: ChapterLayer) => void;
  toolbar?: ReactNode;
  renderAtlas?: (props: GraphAtlasProps) => ReactNode;
  atlasPortalTarget?: HTMLElement | null;
}

interface ConceptHistoryEntry {
  conceptId: string;
  formulaId: string;
  label: string;
}

function conceptHistoryLabel(view: ConceptView): string {
  return formatConceptTitle(view.name, view.defined_symbol, DEFAULT_LANGUAGE)
    || formatFormulaReferenceLabel(view.supporting_formula_label, DEFAULT_LANGUAGE)
    || 'previous concept';
}

function isCompactLandscapeViewport(): boolean {
  return window.matchMedia('(orientation: landscape) and (max-height: 520px) and (max-width: 960px)').matches;
}

function focusCenterTarget(parent?: Node | null): { x: number; y: number; zoom: number } {
  if (!isCompactLandscapeViewport()) {
    return parent
      ? { x: parent.position.x + 310, y: parent.position.y + 220, zoom: 0.86 }
      : { x: 570, y: 500, zoom: 0.86 };
  }
  return parent
    ? { x: parent.position.x + 260, y: parent.position.y + 124, zoom: 0.9 }
    : { x: 520, y: 404, zoom: 0.9 };
}

const CONCEPT_FOCUS_POSITION = { x: 360, y: 80 };
const CONCEPT_PREREQ_X = -140;
const CONCEPT_PREREQ_MULTI_X = -430;
const CONCEPT_PREREQ_COLUMN_GAP = 336;
const CONCEPT_PREREQ_ROW_GAP = 326;
const CONCEPT_SUCCESSOR_X = 900;
const CONCEPT_SUCCESSOR_MULTI_X = 900;
const CONCEPT_SUCCESSOR_COLUMN_GAP = 316;
const CONCEPT_SUCCESSOR_ROW_GAP = 286;
const CONCEPT_INTRODUCED_X = 400;
const CONCEPT_INTRODUCED_MULTI_X = 224;
const CONCEPT_INTRODUCED_COLUMN_GAP = 352;
const CONCEPT_INTRODUCED_ROW_GAP = 226;
const CONCEPT_INTRODUCED_TOP_GAP = 304;
const CONCEPT_INTRODUCED_TOP_GAP_WITH_EVIDENCE = 418;
const CONCEPT_NESTED_PREREQ_X_OFFSET = -336;
const CONCEPT_NESTED_PREREQ_Y_GAP = 210;
const CONCEPT_MAX_NESTED_DEPTH = 2;

interface GraphSafeViewport {
  container: DOMRect;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function conceptReferenceKey(reference: ConceptReference, index: number): string {
  return `${reference.concept_id || reference.symbol || reference.name || 'concept'}:${reference.defined_by_formula_id || reference.from_formula_id || index}`;
}

function conceptReferenceStableKey(reference: ConceptReference): string {
  return `${reference.concept_id || reference.symbol || reference.name || 'concept'}:${reference.defined_by_formula_id || reference.from_formula_id || ''}`;
}

function getGraphSafeViewport(): GraphSafeViewport | null {
  const container = document.querySelector<HTMLElement>('.graph-workspace__main .react-flow')?.getBoundingClientRect();
  if (!container || container.width <= 0 || container.height <= 0) return null;
  const toolbar = document.querySelector<HTMLElement>('.graph-toolbar')?.getBoundingClientRect();
  const timeline = document.querySelector<HTMLElement>('.study-timeline')?.getBoundingClientRect();
  const compact = isCompactLandscapeViewport();
  const sidePadding = compact ? 18 : 30;
  const topPadding = compact ? 12 : 22;
  const bottomPadding = compact ? 16 : 32;
  const top = Math.max(container.top + topPadding, (toolbar?.bottom || container.top) + (compact ? 10 : 18));
  const bottom = Math.min(container.bottom - bottomPadding, (timeline?.top || container.bottom) - (compact ? 14 : 30));
  return {
    container,
    left: container.left + sidePadding,
    right: container.right - sidePadding,
    top,
    bottom,
  };
}

function fitFormulaNodesToSafeViewport(reactFlow: ReactFlowInstance, nodeIds: string[], duration: number, maxZoom: number): boolean {
  if (!nodeIds.length) return false;
  const safeViewport = getGraphSafeViewport();
  if (!safeViewport) return false;
  const bounds = reactFlow.getNodesBounds(nodeIds);
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) return false;

  const compact = isCompactLandscapeViewport();
  const fitPadding = compact ? 14 : 22;
  const width = Math.max(120, safeViewport.right - safeViewport.left - fitPadding * 2);
  const height = Math.max(120, safeViewport.bottom - safeViewport.top - fitPadding * 2);
  const zoom = Math.min(maxZoom, width / bounds.width, height / bounds.height);
  const left = safeViewport.left - safeViewport.container.left + fitPadding;
  const top = safeViewport.top - safeViewport.container.top + fitPadding;
  const x = left + (width - bounds.width * zoom) / 2 - bounds.x * zoom;
  const y = top + (height - bounds.height * zoom) / 2 - bounds.y * zoom;
  reactFlow.setViewport({ x, y, zoom }, { duration });
  return true;
}

function correctFormulaViewportForChrome(reactFlow: ReactFlowInstance, maxZoom = 0.78) {
  const formulaNodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node-formula')];
  if (!formulaNodes.length) return;
  const safeViewport = getGraphSafeViewport();
  if (!safeViewport) return;
  const leftLimit = safeViewport.left;
  const rightLimit = safeViewport.right;
  const topLimit = safeViewport.top;
  const bottomLimit = safeViewport.bottom;
  const rects = formulaNodes.map((node) => node.getBoundingClientRect());
  const minLeft = Math.min(...rects.map((rect) => rect.left));
  const maxRight = Math.max(...rects.map((rect) => rect.right));
  const minTop = Math.min(...rects.map((rect) => rect.top));
  const maxBottom = Math.max(...rects.map((rect) => rect.bottom));
  const compact = isCompactLandscapeViewport();
  const fitPadding = compact ? 12 : 18;
  const availableWidth = Math.max(120, rightLimit - leftLimit - fitPadding * 2);
  const availableHeight = Math.max(120, bottomLimit - topLimit - fitPadding * 2);
  const screenWidth = Math.max(1, maxRight - minLeft);
  const screenHeight = Math.max(1, maxBottom - minTop);
  const viewport = reactFlow.getViewport();
  const scale = Math.min(maxZoom / viewport.zoom, availableWidth / screenWidth, availableHeight / screenHeight, 1);
  if (scale < 0.995) {
    const currentZoom = viewport.zoom || 1;
    const nextZoom = currentZoom * scale;
    const screenCenterX = (minLeft + maxRight) / 2;
    const screenCenterY = (minTop + maxBottom) / 2;
    const flowCenterX = (screenCenterX - safeViewport.container.left - viewport.x) / currentZoom;
    const flowCenterY = (screenCenterY - safeViewport.container.top - viewport.y) / currentZoom;
    const safeCenterX = leftLimit + fitPadding + availableWidth / 2;
    const safeCenterY = topLimit + fitPadding + availableHeight / 2;
    reactFlow.setViewport({
      x: safeCenterX - safeViewport.container.left - flowCenterX * nextZoom,
      y: safeCenterY - safeViewport.container.top - flowCenterY * nextZoom,
      zoom: nextZoom,
    }, { duration: 240 });
    return;
  }

  let deltaX = 0;
  let deltaY = 0;
  if (minLeft < leftLimit) deltaX += leftLimit - minLeft;
  if (maxRight + deltaX > rightLimit) deltaX -= maxRight + deltaX - rightLimit;
  if (minTop < topLimit) deltaY += topLimit - minTop;
  if (maxBottom + deltaY > bottomLimit) deltaY -= maxBottom + deltaY - bottomLimit;
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
  reactFlow.setViewport({ ...viewport, x: viewport.x + deltaX, y: viewport.y + deltaY }, { duration: 220 });
}

function normalizeConceptText(value = ''): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function baseConceptSymbol(symbol = ''): string {
  return String(symbol || '')
    .trim()
    .replace(/\\overline\{([^{}]+)\}/g, '$1')
    .replace(/\\bar\{([^{}]+)\}/g, '$1')
    .replace(/\\widehat\{([^{}]+)\}/g, '$1')
    .replace(/\\hat\{([^{}]+)\}/g, '$1')
    .replace(/_\{[^{}]+\}/g, '')
    .replace(/\^\{[^{}]+\}/g, '')
    .replace(/[{}]/g, '')
    .replace(/^\\/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function conceptReferenceSemanticKey(reference: ConceptReference): string {
  const title = normalizeConceptText(reference.name || '').toLowerCase();
  const symbol = baseConceptSymbol(reference.symbol || reference.via_symbol || '').toLowerCase();
  return `${title}:${symbol}`;
}

function isFormulaReferenceText(value = ''): boolean {
  return /^(?:equation|formula)\s+[A-Za-z]?\d+(?:\.\d+)?[a-z]?$/i.test(normalizeConceptText(value));
}

function isFormulaReferenceReference(reference: ConceptReference): boolean {
  return normalizeConceptText(reference.relation || '') === 'explicit_reference'
    || isFormulaReferenceText(reference.via_symbol);
}

function visibleConceptReferences(items: ConceptReference[], limit: number): ConceptReference[] {
  const seen = new Set<string>();
  const result: ConceptReference[] = [];
  for (const item of items) {
    if (isFormulaReferenceReference(item)) continue;
    const key = conceptReferenceSemanticKey(item) || conceptReferenceStableKey(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function defaultConceptReveals(view: ConceptView): Partial<Record<ConceptRevealGroup, boolean>> {
  if (visibleConceptReferences(view.prerequisite_concepts, 1).length) return { prerequisites: true };
  return {};
}

function conceptSnapshotKey(chapterId: string, formulaId: string, conceptId: string): string {
  return `${chapterId}::${formulaId}::${conceptId}`;
}

function nestedConceptReferences(reference?: ConceptReference): ConceptReference[] {
  const prerequisites = (reference?.prerequisite_concepts || []).map((item) => ({
    ...item,
    relation: item.relation || 'prerequisite_for',
  }));
  const introduced = (reference?.introduced_concepts || []).map((item) => ({
    ...item,
    relation: item.relation || 'introduced_for',
  }));
  return visibleConceptReferences([...prerequisites, ...introduced], 4);
}

function buildConceptScene(
  view: ConceptView,
  revealedGroups: Partial<Record<ConceptRevealGroup, boolean>>,
  expandedReferenceKeys: Set<string>,
  onOpenConcept: (conceptId: string) => void,
  onOpenFormula: (formulaId: string) => void,
  onRevealGroup: (group: ConceptRevealGroup) => void,
  onToggleEvidence: () => void,
  onExpandPrerequisites: (reference: ConceptReference) => void,
  evidenceOpen: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const prerequisites = visibleConceptReferences(view.prerequisite_concepts, 8);
  const successors = visibleConceptReferences(view.successor_concepts || [], 8);
  const introduced = visibleConceptReferences(view.introduced_concepts || [], 8);
  const showPrerequisites = Boolean(revealedGroups.prerequisites);
  const showIntroduced = Boolean(revealedGroups.introduced);
  const prereqColumns = prerequisites.length > 5 ? 2 : 1;
  const prereqRows = Math.ceil(prerequisites.length / prereqColumns);
  const prereqStartX = prereqColumns > 1 ? CONCEPT_PREREQ_MULTI_X : CONCEPT_PREREQ_X;
  const introducedColumns = introduced.length > 4 ? 2 : 1;
  const introducedStartX = introducedColumns > 1 ? CONCEPT_INTRODUCED_MULTI_X : CONCEPT_INTRODUCED_X;
  const introducedStartY = CONCEPT_FOCUS_POSITION.y
    + (evidenceOpen ? CONCEPT_INTRODUCED_TOP_GAP_WITH_EVIDENCE : CONCEPT_INTRODUCED_TOP_GAP);
  const successorColumns = successors.length > 5 ? 2 : 1;
  const successorRows = Math.ceil(successors.length / successorColumns);
  const successorStartX = successorColumns > 1 ? CONCEPT_SUCCESSOR_MULTI_X : CONCEPT_SUCCESSOR_X;
  const nodes: Node[] = [
    {
      id: view.concept_id,
      type: 'concept',
      position: CONCEPT_FOCUS_POSITION,
      data: {
        view,
        role: 'focus',
        clickable: false,
        active: true,
        conceptCounts: {
          prerequisites: prerequisites.length,
          successors: successors.length,
          introduced: introduced.length,
        },
        revealedGroups,
        evidenceOpen,
        onRevealGroup,
        onToggleEvidence,
        onExpandPrerequisites,
        onOpenConcept,
        onOpenFormula,
      } satisfies ConceptNodeData,
    },
  ];
  const edges: Edge[] = [];

  if (showPrerequisites) prerequisites.forEach((reference, index) => {
    const referenceKey = conceptReferenceStableKey(reference);
    const nested = nestedConceptReferences(reference);
    const canExpandPrerequisites = nested.length > 0;
    const prerequisitesExpanded = expandedReferenceKeys.has(referenceKey);
    const id = `prereq:${conceptReferenceKey(reference, index)}`;
    const column = prerequisites.length > 5 ? index % 2 : 0;
    const row = prerequisites.length > 5 ? Math.floor(index / 2) : index;
    const y = CONCEPT_FOCUS_POSITION.y - Math.max(0, prereqRows - 1) * (CONCEPT_PREREQ_ROW_GAP / 2) + row * CONCEPT_PREREQ_ROW_GAP;
    nodes.push({
      id,
      type: 'concept',
      position: { x: prereqStartX + column * CONCEPT_PREREQ_COLUMN_GAP, y },
      data: {
        view,
        role: 'prerequisite',
        reference,
        clickable: true,
        depth: 1,
        canExpandPrerequisites,
        prerequisitesExpanded,
        onOpenConcept,
        onOpenFormula,
        onExpandPrerequisites,
      } satisfies ConceptNodeData,
    });
    edges.push({
      id: `${id}->${view.concept_id}`,
      source: id,
      target: view.concept_id,
      type: 'dependency',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#5eead4' },
      data: {
        via: reference.via_symbol || reference.symbol || '',
        crossChapter: false,
        confidence: reference.confidence,
        kind: 'concept',
        relation: reference.relation || 'prerequisite_for',
        explanation: `${reference.name} follows from the current concept.`,
        active: true,
        labelVisible: Boolean(reference.via_symbol || reference.symbol),
      } satisfies DependencyEdgeData,
    });
    if (expandedReferenceKeys.has(referenceKey)) {
      nested.forEach((nestedReference, nestedIndex) => {
        const nestedId = `nested:${referenceKey}:${conceptReferenceKey(nestedReference, nestedIndex)}`;
        const nestedY = y - Math.max(0, nested.length - 1) * (CONCEPT_NESTED_PREREQ_Y_GAP / 2) + nestedIndex * CONCEPT_NESTED_PREREQ_Y_GAP;
        nodes.push({
          id: nestedId,
          type: 'concept',
          position: { x: prereqStartX + column * CONCEPT_PREREQ_COLUMN_GAP + CONCEPT_NESTED_PREREQ_X_OFFSET, y: nestedY },
          data: {
            view,
            role: 'prerequisite',
            reference: nestedReference,
            clickable: Boolean(nestedReference.clickable),
            depth: CONCEPT_MAX_NESTED_DEPTH,
            canExpandPrerequisites: false,
            prerequisitesExpanded: false,
            onOpenConcept,
            onOpenFormula,
            onExpandPrerequisites,
          } satisfies ConceptNodeData,
        });
        edges.push({
          id: `${nestedId}->${id}`,
          source: nestedId,
          target: id,
          type: 'dependency',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#7dd3fc' },
          data: {
            via: nestedReference.via_symbol || nestedReference.symbol || '',
            crossChapter: false,
            confidence: nestedReference.confidence,
            kind: 'concept',
            relation: nestedReference.relation || 'prerequisite_for',
            explanation: `${nestedReference.name} expands prerequisites for ${reference.name}.`,
            active: true,
            labelVisible: Boolean(nestedReference.via_symbol || nestedReference.symbol),
          } satisfies DependencyEdgeData,
        });
      });
    }
  });

  if (showIntroduced) introduced.forEach((reference, index) => {
    const id = `introduced:${conceptReferenceKey(reference, index)}`;
    const column = introduced.length > 4 ? index % 2 : 0;
    const row = introduced.length > 4 ? Math.floor(index / 2) : index;
    const stagger = introducedColumns > 1 && column === 1 ? 40 : 0;
    const y = introducedStartY + row * CONCEPT_INTRODUCED_ROW_GAP + stagger;
    nodes.push({
      id,
      type: 'concept',
      position: { x: introducedStartX + column * CONCEPT_INTRODUCED_COLUMN_GAP, y },
      data: {
        view,
        role: 'introduced',
        reference,
        clickable: false,
        depth: 1,
        canExpandPrerequisites: false,
        prerequisitesExpanded: false,
        onOpenConcept,
        onOpenFormula,
        onExpandPrerequisites,
      } satisfies ConceptNodeData,
    });
    edges.push({
      id: `${id}->${view.concept_id}`,
      source: id,
      target: view.concept_id,
      type: 'dependency',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#fbbf24' },
      data: {
        via: reference.via_symbol || reference.symbol || '',
        crossChapter: false,
        confidence: reference.confidence,
        kind: 'introduced',
        relation: reference.relation || 'introduced_for',
        explanation: `${reference.name} is introduced by the current formula.`,
        active: false,
        labelVisible: Boolean(reference.via_symbol || reference.symbol),
      } satisfies DependencyEdgeData,
    });
  });

  successors.forEach((reference, index) => {
    const id = `successor:${conceptReferenceKey(reference, index)}`;
    const column = successors.length > 5 ? index % 2 : 0;
    const row = successors.length > 5 ? Math.floor(index / 2) : index;
    const y = CONCEPT_FOCUS_POSITION.y - Math.max(0, successorRows - 1) * (CONCEPT_SUCCESSOR_ROW_GAP / 2) + row * CONCEPT_SUCCESSOR_ROW_GAP;
    nodes.push({
      id,
      type: 'concept',
      position: { x: successorStartX + column * CONCEPT_SUCCESSOR_COLUMN_GAP, y },
      data: {
        view,
        role: 'successor',
        reference,
        clickable: true,
        depth: 1,
        canExpandPrerequisites: false,
        prerequisitesExpanded: false,
        onOpenConcept,
        onOpenFormula,
        onExpandPrerequisites,
      } satisfies ConceptNodeData,
    });
    edges.push({
      id: `${view.concept_id}->${id}`,
      source: view.concept_id,
      target: id,
      type: 'dependency',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#34d399' },
      data: {
        via: reference.via_symbol || reference.symbol || '',
        crossChapter: false,
        confidence: reference.confidence,
        kind: 'concept',
        relation: reference.relation || 'successor_for',
        explanation: `${reference.name} follows from the current concept.`,
        active: true,
        labelVisible: Boolean(reference.via_symbol || reference.symbol),
      } satisfies DependencyEdgeData,
    });
  });

  return { nodes, edges };
}

function conceptMapNodeId(view: ConceptView): string {
  return `concept-map:${view.view_id || view.concept_id}`;
}

interface ConceptMapEdgeDraft {
  source: string;
  target: string;
  relation: string;
  confidence: number;
}

function conceptMapFormulaPosition(view: ConceptView): number {
  return Number.isFinite(view.formula_position) ? Number(view.formula_position) : Number.MAX_SAFE_INTEGER;
}

function conceptMapViewSort(left: ConceptView, right: ConceptView): number {
  const leftPosition = conceptMapFormulaPosition(left);
  const rightPosition = conceptMapFormulaPosition(right);
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return left.name.localeCompare(right.name);
}

function conceptMapLaneRanks(views: ConceptView[], edgeDrafts: ConceptMapEdgeDraft[]): Map<string, number> {
  const ids = new Set(views.map(conceptMapNodeId));
  const rank = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  views.forEach((view) => {
    const id = conceptMapNodeId(view);
    rank.set(id, 0);
    incoming.set(id, 0);
    outgoing.set(id, []);
  });

  edgeDrafts.forEach((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  });

  const positionLookup = new Map(views.map((view) => [conceptMapNodeId(view), conceptMapFormulaPosition(view)]));
  const queue = [...ids]
    .filter((id) => (incoming.get(id) || 0) === 0)
    .sort((left, right) => (positionLookup.get(left) || 0) - (positionLookup.get(right) || 0));
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift()!;
    visited.add(current);
    const currentRank = rank.get(current) || 0;
    (outgoing.get(current) || []).forEach((target) => {
      rank.set(target, Math.max(rank.get(target) || 0, currentRank + 1));
      const nextIncoming = (incoming.get(target) || 0) - 1;
      incoming.set(target, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(target);
        queue.sort((left, right) => (rank.get(left) || 0) - (rank.get(right) || 0) || (positionLookup.get(left) || 0) - (positionLookup.get(right) || 0));
      }
    });
  }

  const fallbackColumns = Math.max(4, Math.ceil(Math.sqrt(Math.max(1, views.length))));
  views.forEach((view, index) => {
    const id = conceptMapNodeId(view);
    if (!visited.has(id)) rank.set(id, Math.floor(index / fallbackColumns));
  });

  return rank;
}

function buildConceptMapScene(
  graph: ConceptGraphPayload,
  selectedConceptId: string | null,
  onOpenConcept: (conceptId: string) => void,
  onOpenFormula: (formulaId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const views = [...(graph.views || [])].sort(conceptMapViewSort);
  const lookup = new Map<string, string>();
  views.forEach((view) => {
    const id = conceptMapNodeId(view);
    lookup.set(view.concept_id, id);
    if (view.view_id) lookup.set(view.view_id, id);
  });

  const seenEdges = new Set<string>();
  const edgeDrafts: ConceptMapEdgeDraft[] = [];
  const addConceptEdgeDraft = (source: string | undefined, target: string | undefined, relation: string, confidence = 0) => {
    if (!source || !target || source === target) return;
    const id = `${source}->${target}:${relation}`;
    if (seenEdges.has(id)) return;
    seenEdges.add(id);
    edgeDrafts.push({ source, target, relation, confidence });
  };

  views.forEach((view) => {
    const currentId = lookup.get(view.concept_id);
    visibleConceptReferences(view.prerequisite_concepts || [], 99).forEach((reference) => {
      addConceptEdgeDraft(lookup.get(reference.view_id || reference.concept_id), currentId, reference.relation || 'prerequisite_for', reference.confidence);
    });
    visibleConceptReferences(view.successor_concepts || [], 99).forEach((reference) => {
      addConceptEdgeDraft(currentId, lookup.get(reference.view_id || reference.concept_id), reference.relation || 'successor_for', reference.confidence);
    });
    (view.edges || []).forEach((edge) => {
      addConceptEdgeDraft(lookup.get(edge.from), lookup.get(edge.to), edge.relation, edge.confidence);
    });
  });

  const ranks = conceptMapLaneRanks(views, edgeDrafts);
  const degree = new Map<string, number>();
  edgeDrafts.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  });
  const connectedRanks = [...ranks.values()];
  const maxConnectedRank = Math.max(0, ...connectedRanks);
  const maxLane = Math.min(11, maxConnectedRank + 1);
  const laneGroups = new Map<number, ConceptView[]>();
  views.forEach((view) => {
    const id = conceptMapNodeId(view);
    const isolated = (degree.get(id) || 0) === 0;
    const lane = isolated ? maxLane : Math.min(maxLane - 1, ranks.get(id) || 0);
    const group = laneGroups.get(lane) || [];
    group.push(view);
    laneGroups.set(lane, group);
  });
  laneGroups.forEach((group) => group.sort(conceptMapViewSort));

  const maxRowsPerLane = views.length > 64 ? 12 : 10;
  const rowCounts = [...laneGroups.values()].map((group) => Math.min(maxRowsPerLane, Math.max(1, group.length)));
  const maxLaneRows = Math.max(1, ...rowCounts);
  const laneLookup = new Map<string, { lane: number; row: number; track: number }>();
  laneGroups.forEach((group, lane) => {
    group.forEach((view, row) => {
      laneLookup.set(conceptMapNodeId(view), {
        lane,
        row: row % maxRowsPerLane,
        track: Math.floor(row / maxRowsPerLane),
      });
    });
  });

  const trackGap = views.length > 64 ? 186 : 206;
  const laneGap = views.length > 64 ? 46 : 70;
  const rowGap = views.length > 64 ? 122 : 136;
  const laneBaseX = new Map<number, number>();
  let nextLaneX = 80;
  [...laneGroups.keys()].sort((left, right) => left - right).forEach((lane) => {
    const group = laneGroups.get(lane) || [];
    const trackCount = Math.max(1, Math.ceil(group.length / maxRowsPerLane));
    laneBaseX.set(lane, nextLaneX);
    nextLaneX += trackCount * trackGap + laneGap;
  });
  const nodes = views.map((view) => {
    const id = conceptMapNodeId(view);
    const placement = laneLookup.get(id) || { lane: 0, row: 0, track: 0 };
    const laneSize = laneGroups.get(placement.lane)?.length || 1;
    const laneRows = Math.min(maxRowsPerLane, laneSize);
    const laneOffsetY = ((maxLaneRows - laneRows) * rowGap) / 2;
    return {
      id,
      type: 'conceptMap',
      position: {
        x: (laneBaseX.get(placement.lane) || 80) + placement.track * trackGap,
        y: 80 + laneOffsetY + placement.row * rowGap + ((placement.lane + placement.track) % 2) * 24,
      },
      data: {
        view,
        active: view.concept_id === selectedConceptId,
        prerequisiteCount: visibleConceptReferences(view.prerequisite_concepts || [], 99).length,
        successorCount: visibleConceptReferences(view.successor_concepts || [], 99).length,
        formulaLabel: view.supporting_formula_label,
        onOpenConcept,
        onOpenFormula,
      } satisfies ConceptMapNodeData,
    } satisfies Node;
  });

  const edges: Edge[] = edgeDrafts.map((edge) => {
    const sourcePlacement = laneLookup.get(edge.source);
    const targetPlacement = laneLookup.get(edge.target);
    const related = Boolean(selectedConceptId && (edge.source.includes(selectedConceptId) || edge.target.includes(selectedConceptId)));
    const sameLane = sourcePlacement?.lane === targetPlacement?.lane;
    return {
      id: `${edge.source}->${edge.target}:${edge.relation}`,
      source: edge.source,
      target: edge.target,
      type: 'dependency',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#5eead4' },
      data: {
        via: '',
        crossChapter: false,
        confidence: edge.confidence,
        kind: 'concept',
        relation: edge.relation,
        active: related,
        labelVisible: false,
        labelOffsetY: sameLane ? -34 : -24,
      } satisfies DependencyEdgeData,
    } satisfies Edge;
  });

  return { nodes, edges };
}

function GraphCanvasInner({ searchIndex, mode = 'concept', studyContext, storylines, conceptLearningNav, conceptLayer = 'backbone', onConceptLayerChange, toolbar, renderAtlas, atlasPortalTarget }: GraphCanvasProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph;
  const { focusFormulaId = '', chapterId: routeChapterId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const paramsKey = params.toString();
  const navigate = useNavigate();
  const { loadChapter, resolveFormulaChapter, error } = useDependencyGraph();
  const { loadConceptChapter, getConceptView, error: conceptError } = useConceptGraph();
  const reactFlow = useReactFlow();
  const markExpanded = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markExpanded);
  const markLearned = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markLearned);
  const markConceptLearned = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.markConceptLearned);
  const learnedByChapter = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.learnedByChapter);
  const saveConceptSnapshot = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.saveConceptSnapshot);
  const getConceptSnapshot = useGraphStore((state: ReturnType<typeof useGraphStore.getState>) => state.getConceptSnapshot);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [showHint, setShowHint] = useState(true);
  const [standaloneFocusId, setStandaloneFocusId] = useState<string | null>(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState<string | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [graphNotice, setGraphNotice] = useState<string | null>(null);
  const [guidedStages, setGuidedStages] = useState<Record<string, GuidedExpansionStage>>({});
  const [conceptReveals, setConceptReveals] = useState<Record<string, Partial<Record<ConceptRevealGroup, boolean>>>>({});
  const [expandedConceptReferences, setExpandedConceptReferences] = useState<Record<string, string[]>>({});
  const [conceptEvidenceOpen, setConceptEvidenceOpen] = useState<Record<string, boolean>>({});
  const [conceptHistory, setConceptHistory] = useState<ConceptHistoryEntry[]>([]);
  const nodesRef = useRef<Node[]>([]);
  const conceptRevealsRef = useRef<Record<string, Partial<Record<ConceptRevealGroup, boolean>>>>({});
  const expandedConceptReferencesRef = useRef<Record<string, string[]>>({});
  const conceptEvidenceOpenRef = useRef<Record<string, boolean>>({});
  const expandFormulaRef = useRef<(formulaId: string, intent?: FormulaExpansionIntent) => void>(() => undefined);
  const loadConceptSceneRef = useRef<(conceptOrFormulaId: string) => void>(() => undefined);
  const autoExpandedFocusRef = useRef<string | null>(null);
  const nodeDraggingRef = useRef(false);
  const conceptNodeDraggingRef = useRef(false);
  const skipNextConceptFitRef = useRef(false);
  const conceptSceneRequestRef = useRef(0);
  const activeConceptViewRef = useRef<ConceptView | null>(null);
  const searchLookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);
  const isConceptMapMode = mode === 'conceptMap';
  const isChapterGraph = Boolean(routeChapterId) && !isConceptMapMode;
  const isConceptMode = !isChapterGraph && mode === 'concept';
  const focusChapterId = routeChapterId || params.get('chapterId') || chapterIdForFormula(focusFormulaId, searchLookup) || resolveFormulaChapter(focusFormulaId);
  const routeConceptId = params.get('conceptId');
  const linkedFormulaId = params.get('selected');
  const sourceConceptId = params.get('fromConceptId');
  const sourceFormulaId = params.get('fromFormulaId');
  const sourceConceptLabel = params.get('fromConceptLabel');
  const routeSelectedFormulaId = isChapterGraph ? params.get('selected') : null;
  const storylineId = params.get('storyline');
  const storylineTitle = useMemo(() => {
    const storyline = storylines.find((item) => item.id === storylineId);
    return storyline?.title_zh || storyline?.title_en || storylineId;
  }, [storylineId, storylines]);
  const chapterGraphModeClass = isConceptMapMode ? 'graph-canvas--concept-map' : isChapterGraph ? `graph-canvas--chapter graph-canvas--chapter-${mode}` : isConceptMode ? 'graph-canvas--concept' : '';
  const studyFormulaIds = useMemo(() => getStudyFormulaIds(studyContext), [studyContext]);
  const conceptBackTarget = conceptHistory[conceptHistory.length - 1] || (!isConceptMode && sourceConceptId && sourceFormulaId
    ? {
        conceptId: sourceConceptId,
        formulaId: sourceFormulaId,
        label: sourceConceptLabel || 'previous concept',
      }
    : null);
  const conceptBackLabel = conceptBackTarget ? `Back to ${conceptBackTarget.label}` : null;

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (mode !== 'formula' || !focusChapterId || !focusFormulaId) return;
    markLearned(focusChapterId, focusFormulaId);
  }, [focusChapterId, focusFormulaId, markLearned, mode]);

  useEffect(() => {
    conceptRevealsRef.current = conceptReveals;
  }, [conceptReveals]);

  useEffect(() => {
    expandedConceptReferencesRef.current = expandedConceptReferences;
  }, [expandedConceptReferences]);

  useEffect(() => {
    conceptEvidenceOpenRef.current = conceptEvidenceOpen;
  }, [conceptEvidenceOpen]);

  useEffect(() => {
    if (!isChapterGraph || !routeSelectedFormulaId) return;
    const targetNode = nodesRef.current.find((node) => node.id === routeSelectedFormulaId && node.type === 'formula');
    if (!targetNode) return;
    setSelectedFormulaId(routeSelectedFormulaId);
    setNodes((current) => markSelectedFormulaNode(current, routeSelectedFormulaId));
    window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId: routeSelectedFormulaId } }));
  }, [isChapterGraph, routeSelectedFormulaId]);

  const setNodeLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const saveCurrentConceptSnapshot = useCallback(
    (
      view: ConceptView | null = activeConceptViewRef.current,
      overrides: Partial<Pick<ConceptViewSnapshot, 'revealedGroups' | 'expandedReferenceKeys' | 'evidenceOpen' | 'viewport'>> = {},
    ) => {
      if (!view || !focusChapterId || !view.concept_id || !view.defined_by_formula_id) return;
      const key = conceptSnapshotKey(focusChapterId, view.defined_by_formula_id, view.concept_id);
      const snapshot: ConceptViewSnapshot = {
        chapterId: focusChapterId,
        formulaId: view.defined_by_formula_id,
        conceptId: view.concept_id,
        revealedGroups: overrides.revealedGroups || conceptRevealsRef.current[view.concept_id] || defaultConceptReveals(view),
        expandedReferenceKeys: overrides.expandedReferenceKeys || expandedConceptReferencesRef.current[view.concept_id] || [],
        evidenceOpen: overrides.evidenceOpen ?? conceptEvidenceOpenRef.current[view.concept_id] ?? false,
        viewport: overrides.viewport || reactFlow.getViewport(),
      };
      saveConceptSnapshot(key, snapshot);
    },
    [focusChapterId, reactFlow, saveConceptSnapshot],
  );

  const rememberCurrentConcept = useCallback((skipConceptId?: string) => {
    const currentView = activeConceptViewRef.current;
    if (!currentView || currentView.concept_id === skipConceptId) return;
    setConceptHistory((current) => {
      const entry: ConceptHistoryEntry = {
        conceptId: currentView.concept_id,
        formulaId: currentView.defined_by_formula_id,
        label: conceptHistoryLabel(currentView),
      };
      const last = current[current.length - 1];
      if (last?.conceptId === entry.conceptId && last.formulaId === entry.formulaId) return current;
      return [...current, entry].slice(-6);
    });
  }, []);

  const openFormulaEvidence = useCallback(
    (formulaId: string) => {
      if (!formulaId) return;
      const currentView = activeConceptViewRef.current;
      saveCurrentConceptSnapshot(currentView);
      rememberCurrentConcept();
      const next = new URLSearchParams(paramsKey);
      next.set('mode', 'formula');
      next.set('chapterId', focusChapterId);
      next.set('selected', formulaId);
      next.delete('conceptId');
      if (currentView) {
        next.set('fromConceptId', currentView.concept_id);
        next.set('fromFormulaId', currentView.defined_by_formula_id);
        next.set('fromConceptLabel', conceptHistoryLabel(currentView));
      } else {
        next.delete('fromConceptId');
        next.delete('fromFormulaId');
        next.delete('fromConceptLabel');
      }
      navigate(`/graph/${formulaId}?${next.toString()}`);
    },
    [focusChapterId, navigate, paramsKey, rememberCurrentConcept, saveCurrentConceptSnapshot],
  );

  const openLinkedConcept = useCallback((conceptId: string) => {
    saveCurrentConceptSnapshot();
    rememberCurrentConcept(conceptId);
    loadConceptSceneRef.current(conceptId);
  }, [rememberCurrentConcept, saveCurrentConceptSnapshot]);

  const openConceptFromMap = useCallback(
    async (conceptId: string) => {
      if (!focusChapterId || !conceptId) return;
      const view = await getConceptView(focusChapterId, conceptId);
      if (!view) return;
      const next = new URLSearchParams(paramsKey);
      next.delete('mode');
      next.set('chapterId', focusChapterId);
      next.set('conceptId', view.concept_id);
      next.set('selected', view.defined_by_formula_id);
      navigate(`/graph/${view.defined_by_formula_id}?${next.toString()}`);
    },
    [focusChapterId, getConceptView, navigate, paramsKey],
  );

  const openFormulaFromMap = useCallback(
    (formulaId: string) => {
      if (!formulaId || !focusChapterId) return;
      const next = new URLSearchParams(paramsKey);
      next.set('mode', 'formula');
      next.set('chapterId', focusChapterId);
      next.set('selected', formulaId);
      next.delete('conceptId');
      navigate(`/graph/${formulaId}?${next.toString()}`);
    },
    [focusChapterId, navigate, paramsKey],
  );

  const openStudyFormula = useCallback(
    (formulaId: string) => {
      if (!formulaId || !focusChapterId) return;
      const next = new URLSearchParams(paramsKey);
      next.set('mode', 'formula');
      next.set('chapterId', focusChapterId);
      next.set('selected', formulaId);
      next.delete('conceptId');
      navigate(`/graph/${formulaId}?${next.toString()}`);
    },
    [focusChapterId, navigate, paramsKey],
  );

  const formulaLearningNav = useMemo(() => {
    if (mode !== 'formula' || isChapterGraph || studyFormulaIds.length <= 1) return null;
    const currentFormulaId = selectedFormulaId && studyFormulaIds.includes(selectedFormulaId)
      ? selectedFormulaId
      : focusFormulaId;
    const currentIndex = studyFormulaIds.indexOf(currentFormulaId);
    if (currentIndex < 0) return null;
    const formulaTarget = (formulaId?: string | null) => {
      if (!formulaId) return null;
      const label = searchLookup.get(formulaId)?.label || `Formula ${rawFormulaNumber(formulaId)}`;
      return { formulaId, label };
    };
    return {
      previous: formulaTarget(studyFormulaIds[currentIndex - 1]),
      next: formulaTarget(studyFormulaIds[currentIndex + 1]),
    };
  }, [focusFormulaId, isChapterGraph, mode, searchLookup, selectedFormulaId, studyFormulaIds]);

  const openNextConcept = useCallback(() => {
    const target = conceptLearningNav?.nextFromCurrent;
    if (!target?.conceptId) return;
    saveCurrentConceptSnapshot();
    rememberCurrentConcept(target.conceptId);
    loadConceptSceneRef.current(target.conceptId);
  }, [conceptLearningNav?.nextFromCurrent, rememberCurrentConcept, saveCurrentConceptSnapshot]);

  const syncLinkedFormula = useCallback(
    (formulaId: string) => {
      if (!formulaId || isChapterGraph || mode === 'concept' || mode === 'conceptMap') return;
      const next = new URLSearchParams(params);
      next.set('selected', formulaId);
      next.delete('conceptId');
      setParams(next, { replace: true });
    },
    [isChapterGraph, mode, params, setParams],
  );

  const fitConceptScene = useCallback(
    (duration = 420) => {
      window.setTimeout(() => {
        reactFlow.fitView({ padding: 0.34, duration, maxZoom: 0.92 });
      }, 80);
      window.setTimeout(() => {
        reactFlow.fitView({ padding: 0.34, duration: 220, maxZoom: 0.92 });
      }, 360);
    },
    [reactFlow],
  );

  const toggleNestedPrerequisites = useCallback((reference: ConceptReference) => {
    const view = activeConceptViewRef.current;
    if (!view) return;
    const referenceKey = conceptReferenceStableKey(reference);
    setExpandedConceptReferences((current) => {
      const currentKeys = new Set(current[view.concept_id] || []);
      if (currentKeys.has(referenceKey)) {
        currentKeys.delete(referenceKey);
      } else {
        currentKeys.add(referenceKey);
      }
      const expandedReferenceKeys = [...currentKeys];
      saveCurrentConceptSnapshot(view, { expandedReferenceKeys });
      return {
        ...current,
        [view.concept_id]: expandedReferenceKeys,
      };
    });
  }, [saveCurrentConceptSnapshot]);

  const toggleConceptEvidence = useCallback(() => {
    const view = activeConceptViewRef.current;
    if (!view) return;
    setConceptEvidenceOpen((current) => {
      const evidenceOpen = !current[view.concept_id];
      const next = {
        ...current,
        [view.concept_id]: evidenceOpen,
      };
      conceptEvidenceOpenRef.current = next;
      saveCurrentConceptSnapshot(view, { evidenceOpen });
      return next;
    });
  }, [saveCurrentConceptSnapshot]);

  const renderConceptScene = useCallback(
    (rawView: ConceptView, revealedGroups: Partial<Record<ConceptRevealGroup, boolean>>) => {
      const view = rawView;
      const expandedKeys = new Set(expandedConceptReferencesRef.current[view.concept_id] || []);
      const evidenceOpen = Boolean(conceptEvidenceOpenRef.current[view.concept_id]);
      const scene = buildConceptScene(
        view,
        revealedGroups,
        expandedKeys,
        openLinkedConcept,
        openFormulaEvidence,
        (group) => {
          setConceptReveals((current) => {
            const revealedGroups = {
              ...(current[view.concept_id] || {}),
              [group]: !current[view.concept_id]?.[group],
            };
            const next = {
              ...current,
              [view.concept_id]: revealedGroups,
            };
            conceptRevealsRef.current = next;
            saveCurrentConceptSnapshot(view, { revealedGroups });
            return next;
          });
        },
        toggleConceptEvidence,
        toggleNestedPrerequisites,
        evidenceOpen,
      );
      setNodes(scene.nodes);
      setEdges(scene.edges);
      setSelectedConceptId(view.concept_id);
      setSelectedFormulaId(view.defined_by_formula_id);
      setStandaloneFocusId(null);
      setShowHint(true);
    },
    [openFormulaEvidence, openLinkedConcept, searchLookup, saveCurrentConceptSnapshot, toggleConceptEvidence, toggleNestedPrerequisites],
  );

  const loadConceptScene = useCallback(
    async (conceptOrFormulaId: string, options: { syncUrl?: boolean } = {}) => {
      if (!focusChapterId || !conceptOrFormulaId) return;
      const requestId = conceptSceneRequestRef.current + 1;
      conceptSceneRequestRef.current = requestId;
      setGraphNotice(null);
      const view = await getConceptView(focusChapterId, conceptOrFormulaId);
      if (requestId !== conceptSceneRequestRef.current) return;
      if (!view) {
        activeConceptViewRef.current = null;
        setNodes([]);
        setEdges([]);
        setSelectedConceptId(null);
        setSelectedFormulaId(focusFormulaId || null);
        setGraphNotice(`${copy.missingConcept} ${conceptOrFormulaId}`);
        return;
      }
      const enrichedView = view;
      const snapshotKey = conceptSnapshotKey(focusChapterId, enrichedView.defined_by_formula_id, enrichedView.concept_id);
      const snapshot = getConceptSnapshot(snapshotKey);
      const revealedGroups = conceptRevealsRef.current[enrichedView.concept_id] || snapshot?.revealedGroups || defaultConceptReveals(enrichedView);
      if (!conceptRevealsRef.current[enrichedView.concept_id]) {
        const nextReveals = {
          ...conceptRevealsRef.current,
          [enrichedView.concept_id]: revealedGroups,
        };
        conceptRevealsRef.current = nextReveals;
        setConceptReveals(nextReveals);
      }
      if (snapshot && !Object.prototype.hasOwnProperty.call(expandedConceptReferencesRef.current, enrichedView.concept_id)) {
        const nextExpandedReferences = {
          ...expandedConceptReferencesRef.current,
          [enrichedView.concept_id]: snapshot.expandedReferenceKeys,
        };
        expandedConceptReferencesRef.current = nextExpandedReferences;
        setExpandedConceptReferences(nextExpandedReferences);
      }
      if (snapshot && !Object.prototype.hasOwnProperty.call(conceptEvidenceOpenRef.current, enrichedView.concept_id)) {
        const nextEvidenceOpen = {
          ...conceptEvidenceOpenRef.current,
          [enrichedView.concept_id]: snapshot.evidenceOpen,
        };
        conceptEvidenceOpenRef.current = nextEvidenceOpen;
        setConceptEvidenceOpen(nextEvidenceOpen);
      }
      activeConceptViewRef.current = enrichedView;
      markConceptLearned(focusChapterId, enrichedView.concept_id);
      renderConceptScene(enrichedView, revealedGroups);
      if (options.syncUrl) {
        const next = new URLSearchParams(paramsKey);
        next.set('conceptId', enrichedView.concept_id);
        next.set('chapterId', focusChapterId);
        next.set('selected', enrichedView.defined_by_formula_id);
        next.delete('fromConceptId');
        next.delete('fromFormulaId');
        next.delete('fromConceptLabel');
        setParams(next, { replace: true });
      }
      window.dispatchEvent(new CustomEvent('litgraph:concept-details', { detail: { conceptView: enrichedView } }));
      const restoredViewport: Viewport | undefined = snapshot?.viewport;
      if (restoredViewport) {
        skipNextConceptFitRef.current = true;
        window.setTimeout(() => {
          reactFlow.setViewport(restoredViewport, { duration: 0 });
        }, 120);
      } else {
        fitConceptScene(520);
      }
    },
    [copy.missingConcept, copy.missingFormula, fitConceptScene, focusChapterId, focusFormulaId, getConceptSnapshot, getConceptView, markConceptLearned, paramsKey, reactFlow, renderConceptScene, searchLookup, setParams],
  );

  useEffect(() => {
    const view = activeConceptViewRef.current;
    if (!isConceptMode || !view) return;
    if (conceptNodeDraggingRef.current) return;
    const skipFit = skipNextConceptFitRef.current;
    skipNextConceptFitRef.current = false;
    renderConceptScene(view, conceptReveals[view.concept_id] || {});
    if (!skipFit) fitConceptScene(420);
  }, [conceptEvidenceOpen, conceptReveals, expandedConceptReferences, fitConceptScene, isConceptMode, renderConceptScene]);

  useEffect(() => {
    loadConceptSceneRef.current = (conceptOrFormulaId: string) => {
      void loadConceptScene(conceptOrFormulaId, { syncUrl: true });
    };
  }, [loadConceptScene]);

  const returnToPreviousConcept = useCallback(() => {
    const target = conceptBackTarget;
    if (!target) return;
    saveCurrentConceptSnapshot();
    setConceptHistory((current) => current.slice(0, -1));
    const next = new URLSearchParams(paramsKey);
    next.delete('mode');
    next.delete('fromConceptId');
    next.delete('fromFormulaId');
    next.delete('fromConceptLabel');
    next.set('chapterId', focusChapterId);
    next.set('conceptId', target.conceptId);
    next.set('selected', target.formulaId);
    navigate(`/graph/${target.formulaId}?${next.toString()}`);
  }, [conceptBackTarget, focusChapterId, navigate, paramsKey, saveCurrentConceptSnapshot]);

  const canUseFormula = useCallback(
    (formulaId: string) => {
      return Boolean(formulaId);
    },
    [],
  );

  const { makeFormulaNode, makeStaticFormulaNode, refreshNodeData } = useGraphNodeFactory({
    expandFormulaRef,
    focusChapterId,
    focusFormulaId,
    isChapterGraph,
    learnedByChapter,
    loadingIds,
    mode,
    onOpenStudyFormula: openStudyFormula,
    studyFormulaIds,
  });

  const centerOnGuidedFormula = useCallback(
    (formulaId: string) => {
      window.setTimeout(() => {
        const parent = nodesRef.current.find((node) => node.id === formulaId);
        if (parent) {
          const target = focusCenterTarget(parent);
          reactFlow.setCenter(target.x, target.y, { zoom: target.zoom, duration: 420 });
        }
      }, 20);
    },
    [reactFlow],
  );

  const fitAfterFormulaExpand = useCallback(() => {
    const compact = isCompactLandscapeViewport();
    const formulaNodeIds = () => nodesRef.current
      .filter((node) => node.type === 'formula')
      .map((node) => node.id);
    const maxZoom = compact ? 0.82 : 0.78;
    window.setTimeout(() => {
      if (!fitFormulaNodesToSafeViewport(reactFlow, formulaNodeIds(), 560, maxZoom)) {
        reactFlow.fitView({ padding: compact ? 0.25 : 0.31, duration: 560, maxZoom });
      }
    }, 80);
    window.setTimeout(() => {
      if (!fitFormulaNodesToSafeViewport(reactFlow, formulaNodeIds(), 240, maxZoom)) {
        reactFlow.fitView({ padding: compact ? 0.27 : 0.33, duration: 240, maxZoom });
      }
    }, 420);
    window.setTimeout(() => {
      correctFormulaViewportForChrome(reactFlow, maxZoom);
    }, 760);
    window.setTimeout(() => {
      correctFormulaViewportForChrome(reactFlow, maxZoom);
    }, 1040);
  }, [reactFlow]);

  const formulaNodeSignature = useMemo(() => (
    nodes
      .filter((node) => node.type === 'formula')
      .map((node) => `${node.id}:${Math.round(node.position.x)}:${Math.round(node.position.y)}`)
      .join('|')
  ), [nodes]);

  useEffect(() => {
    if (mode !== 'formula' || isChapterGraph) return;
    const formulaNodeCount = nodesRef.current.filter((node) => node.type === 'formula').length;
    if (formulaNodeCount <= 1) return;
    const timeout = window.setTimeout(() => {
      fitAfterFormulaExpand();
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [fitAfterFormulaExpand, formulaNodeSignature, isChapterGraph, mode]);

  const loadGuidedSymbolExplanations = useGuidedSymbolExplanations({
    isChapterGraph,
    mode,
    focusChapterId,
    loadChapter,
    loadConceptChapter,
    markExpanded,
    refreshNodeData,
    setNodeLoading,
    setNodes,
    setSelectedFormulaId,
    setShowHint,
    centerOnFormula: centerOnGuidedFormula,
  });

  const expandFormula = useGraphExpansion({
    canUseFormula,
    focusChapterId,
    focusFormulaId,
    guidedUnlock: mode === 'formula',
    guidedStages,
    loadChapter,
    loadConceptChapter,
    makeFormulaNode,
    markExpanded,
    markLearned,
    mode,
    nodesRef,
    refreshNodeData,
    setEdges,
    setGuidedStages,
    setNodeLoading,
    setNodes,
    setShowHint,
    setStandaloneFocusId,
    fitAfterExpand: fitAfterFormulaExpand,
  });

  useEffect(() => {
    expandFormulaRef.current = expandFormula;
  }, [expandFormula]);

  useGraphInitialLoad({
    autoExpandedFocusRef,
    copy,
    disabled: isConceptMode || isConceptMapMode,
    focusChapterId,
    focusFormulaId,
    isChapterGraph,
    loadChapter,
    loadConceptChapter,
    makeStaticFormulaNode,
    mode,
    reactFlow,
    routeSelectedFormulaId,
    setEdges,
    setGraphNotice,
    setGuidedStages,
    setLoadingIds,
    setNodes,
    setSelectedFormulaId,
    setShowHint,
    setStandaloneFocusId,
  });

  useEffect(() => {
    if (!isConceptMapMode || !focusChapterId) return;
    let cancelled = false;
    setNodes([]);
    setEdges([]);
    setGraphNotice(null);
    setGuidedStages({});
    setLoadingIds(new Set());
    setStandaloneFocusId(null);
    activeConceptViewRef.current = null;
    autoExpandedFocusRef.current = null;
    void loadConceptChapter(focusChapterId).then((graph) => {
      if (cancelled) return;
      if (!graph?.views?.length) {
        setGraphNotice(copy.missingConcept);
        return;
      }
      const scene = buildConceptMapScene(graph, selectedConceptId, openConceptFromMap, openFormulaFromMap);
      setNodes(scene.nodes);
      setEdges(scene.edges);
      setSelectedFormulaId(null);
      setShowHint(true);
      window.setTimeout(() => {
        reactFlow.fitView({ padding: 0.22, duration: 620, maxZoom: 0.76 });
      }, 80);
    });
    return () => {
      cancelled = true;
    };
  }, [copy.missingConcept, focusChapterId, isConceptMapMode, loadConceptChapter, openConceptFromMap, openFormulaFromMap, reactFlow, selectedConceptId]);

  useEffect(() => {
    if (!isConceptMode) return;
    setNodes([]);
    setEdges([]);
    setGraphNotice(null);
    setGuidedStages({});
    setLoadingIds(new Set());
    activeConceptViewRef.current = null;
    autoExpandedFocusRef.current = null;
    const target = routeConceptId || linkedFormulaId || focusFormulaId;
    if (!target) return;
    void loadConceptScene(target);
  }, [focusFormulaId, isConceptMode, linkedFormulaId, loadConceptScene, routeConceptId, setEdges, setNodes]);

  useEffect(() => {
    if (isChapterGraph || isConceptMode || isConceptMapMode) return;
    const autoExpandKey = `${mode}:${focusFormulaId}`;
    if (!focusFormulaId || autoExpandedFocusRef.current === autoExpandKey) return;
    if (mode === 'formula') {
      if (!nodes.some((node) => node.id === focusFormulaId)) return;
      autoExpandedFocusRef.current = autoExpandKey;
      window.setTimeout(() => loadGuidedSymbolExplanations(focusFormulaId, { center: false }), 0);
      return;
    }
    if (!nodes.some((node) => node.id === focusFormulaId)) return;
    autoExpandedFocusRef.current = autoExpandKey;
    window.setTimeout(() => {
      expandFormulaRef.current(focusFormulaId);
    }, 0);
  }, [focusFormulaId, isChapterGraph, isConceptMapMode, isConceptMode, loadGuidedSymbolExplanations, mode, nodes]);

  useEffect(() => {
    setNodes((current) => refreshNodeData(current));
  }, [refreshNodeData]);

  const selectFormulaFromGraph = useCallback(
    (formulaId: string, options: { center?: boolean } = {}) => {
      if (!canUseFormula(formulaId)) return;
      const targetNode = nodesRef.current.find((node) => node.id === formulaId && node.type === 'formula');
      if (!targetNode) return;

      if (mode === 'formula' && focusChapterId) markLearned(focusChapterId, formulaId);
      setSelectedFormulaId(formulaId);
      setNodes((current) => markSelectedFormulaNode(current, formulaId));
      syncLinkedFormula(formulaId);
      window.dispatchEvent(new CustomEvent('litgraph:formula-details', { detail: { formulaId } }));

      if (isChapterGraph) {
        const next = new URLSearchParams(params);
        next.set('selected', formulaId);
        setParams(next, { replace: true });
        if (options.center !== false) {
          window.setTimeout(() => {
            const latestNode = nodesRef.current.find((node) => node.id === formulaId) || targetNode;
            reactFlow.setCenter(latestNode.position.x + 134, latestNode.position.y + 128, { zoom: 0.82, duration: 420 });
          }, 20);
        }
        return;
      }

      if (mode === 'formula' || mode === 'explore') {
        expandFormulaRef.current(formulaId, 'auto');
      }

      if (options.center !== false) {
        window.setTimeout(() => {
          const latestNode = nodesRef.current.find((node) => node.id === formulaId) || targetNode;
          const target = focusCenterTarget(latestNode);
          reactFlow.setCenter(target.x, target.y, { zoom: target.zoom, duration: 420 });
        }, 760);
      }
    },
    [canUseFormula, focusChapterId, isChapterGraph, markLearned, mode, params, reactFlow, setParams, syncLinkedFormula],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (nodeDraggingRef.current) return;
      if (node.type === 'formula') selectFormulaFromGraph(node.id, { center: false });
      if (node.type === 'conceptMap') {
        const data = node.data as unknown as ConceptMapNodeData;
        setSelectedConceptId(data.view.concept_id);
        setNodes((current) => current.map((item) => {
          if (item.type !== 'conceptMap') return item;
          const itemData = item.data as unknown as ConceptMapNodeData;
          return {
            ...item,
            data: {
              ...itemData,
              active: itemData.view.concept_id === data.view.concept_id,
            } satisfies ConceptMapNodeData,
          };
        }));
        window.dispatchEvent(new CustomEvent('litgraph:concept-details', { detail: { conceptView: data.view } }));
        return;
      }
      if (node.type === 'concept') {
        const data = node.data as unknown as ConceptNodeData;
        if (data.role === 'focus') {
          setSelectedConceptId(data.view.concept_id);
          setSelectedFormulaId(data.view.defined_by_formula_id);
          window.dispatchEvent(new CustomEvent('litgraph:concept-details', { detail: { conceptView: data.view } }));
        }
      }
    },
    [selectFormulaFromGraph],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onNodeDragStart = useCallback(() => {
    nodeDraggingRef.current = true;
    if (isConceptMode) conceptNodeDraggingRef.current = true;
  }, [isConceptMode]);
  const onNodeDragStop = useCallback(() => {
    window.setTimeout(() => {
      nodeDraggingRef.current = false;
      conceptNodeDraggingRef.current = false;
    }, 0);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  return (
    <GraphCanvasView
      copy={copy}
      mode={mode}
      toolbar={toolbar}
      storylineId={storylineId}
      storylineTitle={storylineTitle}
      isChapterGraph={isChapterGraph}
      showHint={showHint}
      error={conceptError || error}
      graphNotice={graphNotice}
      standaloneFocusId={standaloneFocusId}
      focusFormulaId={focusFormulaId}
      focusChapterId={focusChapterId}
      selectedFormulaId={selectedFormulaId}
      selectedConceptId={selectedConceptId}
      nodes={nodes}
      edges={edges}
      chapterGraphModeClass={chapterGraphModeClass}
      conceptBackLabel={conceptBackLabel}
      conceptLearningNav={conceptLearningNav}
      formulaLearningNav={formulaLearningNav}
      conceptLayer={conceptLayer}
      onConceptLayerChange={onConceptLayerChange}
      onBackToConcept={returnToPreviousConcept}
      onBackToStoryline={() => navigate(`/storyline/${storylineId}`)}
      onHome={() => navigate((isConceptMode || isConceptMapMode) && focusChapterId ? `/chapter/${focusChapterId}` : '/')}
      onOpenNextConcept={conceptLearningNav?.nextFromCurrent ? openNextConcept : undefined}
      onOpenFormulaStep={openStudyFormula}
      onOpenConceptStep={openLinkedConcept}
      onExpand={() => expandFormula(selectedFormulaId || focusFormulaId)}
      onDismissHint={() => setShowHint(false)}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onSetEdges={setEdges}
      onSelectFormula={selectFormulaFromGraph}
      onSelectConcept={isConceptMapMode ? openConceptFromMap : openLinkedConcept}
      renderAtlas={renderAtlas}
      atlasPortalTarget={atlasPortalTarget}
    />
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
