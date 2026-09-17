/**
 * Dependency-free in-place radix-2 Cooley–Tukey FFT.
 *
 * Kept deliberately small: the AudioWorklet runs this on every 2048-sample
 * frame, ~47×/s, on a phone. No allocations inside the hot loop beyond the
 * cached twiddle tables.
 */

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}

const twiddleCache = new Map<number, Twiddles>();

function twiddlesFor(n: number): Twiddles {
  const cached = twiddleCache.get(n);
  if (cached) return cached;

  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const angle = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  // Bit-reversal permutation table.
  const rev = new Uint32Array(n);
  let bits = 0;
  while (1 << bits < n) bits++;
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }

  const t: Twiddles = { cos, sin, rev };
  twiddleCache.set(n, t);
  return t;
}

/**
 * In-place complex FFT. `re` and `im` must be the same power-of-two length.
 * `im` is normally all zeros for real input.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (im.length !== n) throw new Error('fftInPlace: re/im length mismatch');
  if (!isPowerOfTwo(n)) throw new Error(`fftInPlace: length ${n} is not a power of two`);
  if (n === 1) return;

  const { cos, sin, rev } = twiddlesFor(n);

  // Reorder into bit-reversed index order.
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let base = 0; base < n; base += size) {
      for (let k = 0; k < half; k++) {
        const tw = k * step;
        const wr = cos[tw]!;
        const wi = sin[tw]!;
        const a = base + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/**
 * Naive DFT — O(n²), used only by the unit tests as an oracle for `fftInPlace`.
 */
export function naiveDft(input: Float32Array): { re: Float64Array; im: Float64Array } {
  const n = input.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      sr += input[t]! * Math.cos(angle);
      si += input[t]! * Math.sin(angle);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}
