import { describe, expect, it } from 'vitest';
import { areSwapCompatible, pickSwapSlot, type SwapSlot } from './swap';

const source: SwapSlot = {
  id: 'method:a',
  parentId: 'file:one',
  district: 'src',
  kind: 'function',
  size: 1,
  position: { x: 0, y: 0, z: 0 },
};

describe('pickSwapSlot', () => {
  it('chooses the nearest compatible sibling', () => {
    const candidates: SwapSlot[] = [
      { ...source, id: 'method:b', position: { x: 1.1, y: 0, z: 0 } },
      { ...source, id: 'method:c', position: { x: 0.8, y: 0, z: 0 } },
    ];
    expect(pickSwapSlot(source, candidates, { x: 0.75, y: 0, z: 0 })?.id).toBe('method:c');
  });

  it('rejects a different kind or parent', () => {
    const candidates: SwapSlot[] = [
      { ...source, id: 'variable:a', kind: 'variable' },
      { ...source, id: 'method:b', parentId: 'file:two' },
    ];
    expect(pickSwapSlot(source, candidates, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('recognizes only semantically compatible sibling slots', () => {
    expect(areSwapCompatible(source, { ...source, id: 'method:b', size: 0.8 })).toBe(true);
    expect(areSwapCompatible(source, { ...source, id: 'method:b', parentId: 'file:two' })).toBe(false);
  });

  it('keeps top-level file swaps inside their district grid', () => {
    const file = { ...source, id: 'file:a', kind: 'file' as const, parentId: null, district: 'src' };
    expect(areSwapCompatible(file, { ...file, id: 'file:b' })).toBe(true);
    expect(areSwapCompatible(file, { ...file, id: 'file:c', district: 'tools' })).toBe(false);
  });

  it('requires the dragged cube to enter the candidate capture radius', () => {
    const candidate = { ...source, id: 'method:b', position: { x: 4, y: 0, z: 0 } };
    expect(pickSwapSlot(source, [candidate], { x: 0.5, y: 0, z: 0 })).toBeNull();
  });
});
