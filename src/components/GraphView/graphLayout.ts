import type { Node, XYPosition } from '@xyflow/react';

const X_GAP = 330;
const Y_GAP = 150;
const NODE_SAFE_HEIGHT = 130;

interface SlotRange {
  yMin: number;
  yMax: number;
}

export function findFreeSlot(idealY: number, usedSlots: SlotRange[], nodeHeight = NODE_SAFE_HEIGHT): number {
  const halfHeight = nodeHeight / 2;
  for (let offset = 0; offset <= 360; offset += 30) {
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

export function layoutPrerequisites(parent: Node, count: number, existingNodes: Node[]): XYPosition[] {
  const baseX = parent.position.x - X_GAP;
  const usedSlots = existingNodes
    .filter((node) => Math.abs(node.position.x - baseX) < 90)
    .map((node) => ({ yMin: node.position.y - NODE_SAFE_HEIGHT / 2, yMax: node.position.y + NODE_SAFE_HEIGHT / 2 }));
  const startY = parent.position.y - ((count - 1) * Y_GAP) / 2;
  return Array.from({ length: count }, (_, index) => {
    const idealY = startY + index * Y_GAP;
    return { x: baseX, y: findFreeSlot(idealY, usedSlots) };
  });
}
