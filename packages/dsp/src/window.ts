/**
 * Periodic Hann window: w[i] = 0.5 * (1 - cos(2πi / N)).
 *
 * Periodic (denominator N) rather than symmetric (N-1) because frames overlap
 * 50% — periodic Hann satisfies COLA at hop = N/2, so successive frames weight
 * the signal evenly. w[0] is exactly 0; w[N-1] is not (that is the periodic
 * form's defining asymmetry, not a bug).
 */
export function hannWindow(n: number): Float32Array {
  if (n <= 0) throw new Error('hannWindow: length must be positive');
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  }
  return w;
}

/** Coherent gain of a window — the factor by which it scales a steady sinusoid. */
export function windowGain(w: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < w.length; i++) sum += w[i]!;
  return sum / w.length;
}
