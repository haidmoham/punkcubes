import { describe, expect, it } from 'vitest';
import { DOCK_SPRING, springSettled, stepSpring } from './motion';

describe('dock spring', () => {
  it('has one restrained, stable overshoot and settles in the docking window', () => {
    let state = { value: 1, velocity: 0 };
    let crossings = 0;
    let previous = state.value;
    for (let frame = 0; frame < 45; frame += 1) {
      state = stepSpring(state, 0, 1 / 90, DOCK_SPRING);
      if (previous * state.value < 0) crossings += 1;
      previous = state.value;
    }
    expect(crossings).toBeGreaterThanOrEqual(1);
    expect(crossings).toBeLessThanOrEqual(2);
    expect(springSettled(state, 0, 0.008)).toBe(true);
  });

  it('caps a delayed frame instead of producing a numerical launch', () => {
    const next = stepSpring({ value: 1, velocity: 0 }, 0, 2, DOCK_SPRING);
    expect(Number.isFinite(next.value)).toBe(true);
    expect(Math.abs(next.value)).toBeLessThan(1.5);
  });
});
