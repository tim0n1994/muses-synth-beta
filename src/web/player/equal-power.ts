/**
 * Equal-power crossfade curves.
 *
 * cos/sin pair: at every sample the squared gains sum to 1, so the perceived
 * loudness of uncorrelated material stays constant through the overlap — the
 * automated equivalent of "no audible dip" (linear crossfades dip to −3 dB at
 * the midpoint). Curves are strictly monotonic with no interior zeros, so
 * neither deck is ever silently muted mid-overlap.
 */
export interface EqualPowerCurves {
  /** Gain applied to the outgoing deck: cos(p·π/2), 1 → 0. */
  readonly fadeOut: Float32Array;
  /** Gain applied to the incoming deck: sin(p·π/2), 0 → 1. */
  readonly fadeIn: Float32Array;
}

export function buildEqualPowerCurves(sampleCount: number): EqualPowerCurves {
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new Error(
      `Equal-power curves need an integer sample count >= 2, got ${sampleCount}.`,
    );
  }
  const fadeOut = new Float32Array(sampleCount);
  const fadeIn = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const p = i / (sampleCount - 1);
    fadeOut[i] = Math.cos(p * (Math.PI / 2));
    fadeIn[i] = Math.sin(p * (Math.PI / 2));
  }
  return { fadeOut, fadeIn };
}
