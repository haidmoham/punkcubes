/**
 * A small, deterministic semi-implicit Euler spring. The caller may feed it
 * smaller fixed-size steps, which keeps an interrupted animation stable even
 * when a background tab returns with a large frame delta.
 */
export interface SpringScalar {
  value: number;
  velocity: number;
}

export interface SpringConfig {
  omega: number;
  zeta: number;
}

export const DOCK_SPRING: SpringConfig = { omega: 18, zeta: 0.66 };

export function stepSpring(
  state: SpringScalar,
  target: number,
  dt: number,
  config: SpringConfig = DOCK_SPRING,
): SpringScalar {
  const cappedDt = Math.min(Math.max(dt, 0), 1 / 30);
  const acceleration =
    config.omega * config.omega * (target - state.value) -
    2 * config.zeta * config.omega * state.velocity;
  const velocity = state.velocity + acceleration * cappedDt;
  return { value: state.value + velocity * cappedDt, velocity };
}

export function springSettled(state: SpringScalar, target: number, positionEpsilon = 0.002): boolean {
  return Math.abs(state.value - target) < positionEpsilon && Math.abs(state.velocity) < 0.015;
}
