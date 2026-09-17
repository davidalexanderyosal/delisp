import { describe, expect, it } from 'vitest';
import { fftInPlace, isPowerOfTwo, naiveDft } from '../src/index.js';
import { mulberry32 } from './signals.js';

describe('fftInPlace', () => {
  it('matches a naive DFT on random input', () => {
    const n = 256;
    const rnd = mulberry32(42);
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = rnd() * 2 - 1;

    const re = Float32Array.from(input);
    const im = new Float32Array(n);
    fftInPlace(re, im);

    const oracle = naiveDft(input);
    for (let k = 0; k < n; k++) {
      expect(re[k]!).toBeCloseTo(oracle.re[k]!, 2);
      expect(im[k]!).toBeCloseTo(oracle.im[k]!, 2);
    }
  });

  it('turns an impulse into a flat spectrum', () => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    re[0] = 1;
    fftInPlace(re, im);
    for (let k = 0; k < n; k++) {
      expect(Math.hypot(re[k]!, im[k]!)).toBeCloseTo(1, 5);
    }
  });

  it('puts a bin-centred sinusoid in exactly one bin', () => {
    const n = 512;
    const bin = 40;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);
    fftInPlace(re, im);

    const mags = Array.from({ length: n / 2 + 1 }, (_, k) => Math.hypot(re[k]!, im[k]!));
    const peak = mags.indexOf(Math.max(...mags));
    expect(peak).toBe(bin);
    expect(mags[bin]!).toBeCloseTo(n / 2, 3);
    expect(mags[bin + 5]!).toBeLessThan(1e-6);
  });

  it('rejects non-power-of-two lengths', () => {
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(() => fftInPlace(new Float32Array(100), new Float32Array(100))).toThrow(/power of two/);
  });
});
