/** Highest gain the executor will apply; louder requests are rejected. */
export const MAX_GAIN = 0.35;

/**
 * The volume slider speaks percent of the executor's gain range, not of full
 * scale. Passing the percent straight through as a gain asked the executor for
 * up to 100 against its 0.35 ceiling, so every drag failed.
 */
export function percentToGain(percent: number): number {
  const bounded = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : percent > 0
      ? 100
      : 0;
  return (bounded / 100) * MAX_GAIN;
}

export function gainToPercent(gain: number): number {
  const bounded = Number.isFinite(gain)
    ? Math.max(0, Math.min(MAX_GAIN, gain))
    : 0;
  return Math.round((bounded / MAX_GAIN) * 100);
}
