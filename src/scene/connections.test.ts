import { describe, expect, it } from 'vitest';
import { connectionRadius } from './connections';

describe('connectionRadius', () => {
  it('encodes larger child metrics as monotonically thicker geometry', () => {
    const maximum = 1_000;
    expect(connectionRadius(1, maximum)).toBeLessThan(connectionRadius(30, maximum));
    expect(connectionRadius(30, maximum)).toBeLessThan(connectionRadius(800, maximum));
  });
});
