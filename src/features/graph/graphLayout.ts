import type { Node, XYPosition } from '@xyflow/react';
import type { ChapterFormula, FormulaDependency, FormulaPrerequisite } from '../../shared/types/formula';

const FORMULA_X_GAP = 460;
const VARIABLE_X_GAP = 260;
const FORMULA_CARD_WIDTH = 276;
const FOCUSED_FORMULA_CARD_WIDTH = 620;
const FORMULA_SIDE_GUTTER = FORMULA_X_GAP - FORMULA_CARD_WIDTH;
const FORMULA_Y_GAP = 320;
const VARIABLE_Y_GAP = 118;
const FORMULA_SAFE_HEIGHT = 310;
const VARIABLE_SAFE_HEIGHT = 108;
const CHAPTER_CARD_WIDTH = 268;
const CHAPTER_CARD_HEIGHT = 260;
const CHAPTER_COLUMN_GAP = 430;
const CHAPTER_ROW_GAP = 340;

interface SlotRange {
  yMin: number;
  yMax: number;
}

export function findFreeSlot(idealY: number, usedSlots: SlotRange[], nodeHeight = FORMULA_SAFE_HEIGHT): number {
  const halfHeight = nodeHeight / 2;
  for (let offset = 0; offset <= 520; offset += 34) {
    for (const sign of [1, -1]) {
      const candidate = idealY + sign * offset;
      const cMin = candidate - halfHeight;
      const cMax = candidate + halfHeight;
      const hasCollision = usedSlots.some((slot) => cMax > slot.yMin && cMin < slot.yMax);
      if (!hasCollision) {
        usedSlots.push({ yMin: cMin, yMax: cMax });
        return candidate;
      }
    }
  }
  usedSlots.push({ yMin: idealY - halfHeight, yMax: idealY + halfHeight });
  return idealY;
}

function usedSlotsForLane(existingNodes: Node[], x: number, safeHeight: number): SlotRange[] {
  return existingNodes
    .filter((node) => Math.abs(node.position.x - x) < 120)
    .map((node) => ({ yMin: node.position.y - safeHeight / 2, yMax: node.position.y + safeHeight / 2 }));
}

function formulaNodeWidth(node: Node): number {
  const data = node.data as { focused?: boolean } | undefined;
  return data?.focused ? FOCUSED_FORMULA_CARD_WIDTH : FORMULA_CARD_WIDTH;
}

export function layoutPrerequisites(parent: Node, prerequisites: FormulaPrerequisite[], existingNodes: Node[]): XYPosition[] {
  const formulaX = parent.position.x - FORMULA_X_GAP;
  const variableX = parent.position.x - VARIABLE_X_GAP;
  const formulaSlots = usedSlotsForLane(existingNodes, formulaX, FORMULA_SAFE_HEIGHT);
  const variableSlots = usedSlotsForLane(existingNodes, variableX, VARIABLE_SAFE_HEIGHT);
  const formulaCount = prerequisites.filter((prereq) => prereq.type === 'formula').length;
  const variableCount = prerequisites.length - formulaCount;
  const formulaStartY = parent.position.y - ((formulaCount - 1) * FORMULA_Y_GAP) / 2;
  const variableStartY = parent.position.y + 122 - ((variableCount - 1) * VARIABLE_Y_GAP) / 2;
  let formulaIndex = 0;
  let variableIndex = 0;

  return prerequisites.map((prereq) => {
    if (prereq.type === 'variable_definition') {
      const idealY = variableStartY + variableIndex * VARIABLE_Y_GAP;
      variableIndex += 1;
      return { x: variableX, y: findFreeSlot(idealY, variableSlots, VARIABLE_SAFE_HEIGHT) };
    }

    const idealY = formulaStartY + formulaIndex * FORMULA_Y_GAP;
    formulaIndex += 1;
    return { x: formulaX, y: findFreeSlot(idealY, formulaSlots, FORMULA_SAFE_HEIGHT) };
  });
}

export function layoutSuccessors(parent: Node, count: number, existingNodes: Node[]): XYPosition[] {
  const formulaX = parent.position.x + formulaNodeWidth(parent) + FORMULA_SIDE_GUTTER;
  const slots = usedSlotsForLane(existingNodes, formulaX, FORMULA_SAFE_HEIGHT);
  const startY = parent.position.y - ((count - 1) * FORMULA_Y_GAP) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: formulaX,
    y: findFreeSlot(startY + index * FORMULA_Y_GAP, slots, FORMULA_SAFE_HEIGHT),
  }));
}

export function layoutConcepts(parent: Node, count: number, existingNodes: Node[]): XYPosition[] {
  const variableX = parent.position.x - VARIABLE_X_GAP;
  const slots = usedSlotsForLane(existingNodes, variableX, VARIABLE_SAFE_HEIGHT);
  const startY = parent.position.y - ((count - 1) * VARIABLE_Y_GAP) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: variableX,
    y: findFreeSlot(startY + index * VARIABLE_Y_GAP, slots, VARIABLE_SAFE_HEIGHT),
  }));
}

function formulaSortKey(formula: ChapterFormula): number {
  return typeof formula.position === 'number' ? formula.position : Number.MAX_SAFE_INTEGER;
}

function dependencyRank(formula: ChapterFormula, incoming: Map<string, string[]>): number {
  const baseDepth = Number(formula.depth || 0);
  const incomingCount = incoming.get(formula.id)?.length || 0;
  return Math.max(0, baseDepth + (incomingCount > 0 && baseDepth === 0 ? 1 : 0));
}

export function layoutChapterGraph(formulas: ChapterFormula[], dependencies: FormulaDependency[]): Map<string, XYPosition> {
  const incoming = new Map<string, string[]>();
  dependencies.forEach((dependency) => {
    dependency.prerequisites.forEach((prereq) => {
      if (prereq.type !== 'formula' || !prereq.target_id || prereq.cross_chapter || prereq.edge_status === 'rejected') return;
      const list = incoming.get(dependency.dependent_id) || [];
      list.push(prereq.target_id);
      incoming.set(dependency.dependent_id, list);
    });
  });

  const lanes = new Map<number, ChapterFormula[]>();
  formulas.forEach((formula) => {
    const lane = Math.min(dependencyRank(formula, incoming), 9);
    const items = lanes.get(lane) || [];
    items.push(formula);
    lanes.set(lane, items);
  });

  const sortedLaneKeys = [...lanes.keys()].sort((a, b) => a - b);
  const maxLaneSize = Math.max(1, ...[...lanes.values()].map((items) => items.length));
  const positions = new Map<string, XYPosition>();

  sortedLaneKeys.forEach((laneKey, laneIndex) => {
    const items = [...(lanes.get(laneKey) || [])].sort((a, b) => formulaSortKey(a) - formulaSortKey(b));
    const laneHeight = (items.length - 1) * CHAPTER_ROW_GAP;
    const anchorY = ((maxLaneSize - 1) * CHAPTER_ROW_GAP - laneHeight) / 2;

    items.forEach((formula, index) => {
      positions.set(formula.id, {
        x: 120 + laneIndex * CHAPTER_COLUMN_GAP,
        y: 96 + anchorY + index * CHAPTER_ROW_GAP,
      });
    });
  });

  return positions;
}

export function chapterGraphBounds(nodeCount: number) {
  return {
    cardWidth: CHAPTER_CARD_WIDTH,
    cardHeight: CHAPTER_CARD_HEIGHT,
    minZoom: nodeCount > 60 ? 0.46 : 0.52,
    maxZoom: 1.35,
  };
}
