import type { CodeNodeKind } from '../data/types';

export interface SwapPoint {
  x: number;
  y: number;
  z: number;
}

export interface SwapSlot {
  id: string;
  parentId: string | null;
  district: string;
  kind: CodeNodeKind;
  size: number;
  position: SwapPoint;
}

function distance(left: SwapPoint, right: SwapPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function areSwapCompatible(source: SwapSlot, candidate: SwapSlot): boolean {
  if (candidate.id === source.id || candidate.kind !== source.kind || candidate.parentId !== source.parentId) return false;
  return source.parentId !== null || candidate.district === source.district;
}

/** Finds the nearest compatible sibling slot under the dragged cube. */
export function pickSwapSlot(source: SwapSlot, candidates: readonly SwapSlot[], draggedPosition: SwapPoint): SwapSlot | null {
  let best: { slot: SwapSlot; score: number } | null = null;

  for (const candidate of candidates) {
    if (!areSwapCompatible(source, candidate)) continue;
    const reach = Math.max(0.72, (source.size + candidate.size) * 0.62);
    const slotDistance = distance(draggedPosition, candidate.position);
    if (slotDistance > reach) continue;
    const score = slotDistance / reach;
    if (!best || score < best.score) best = { slot: candidate, score };
  }

  return best?.slot ?? null;
}
