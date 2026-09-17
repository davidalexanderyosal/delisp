import { describe, expect, it } from 'vitest';
import { hannWindow, windowGain } from '../src/index.js';

describe('hannWindow', () => {
  it('starts at zero and peaks at the centre', () => {
    const w = hannWindow(2048);
    expect(w[0]!).toBe(0);
    expect(w[1024]!).toBeCloseTo(1, 6);
  });

  it('is symmetric about the centre (periodic form)', () => {
    const n = 256;
    const w = hannWindow(n);
    for (let i = 1; i < n / 2; i++) {
      expect(w[i]!).toBeCloseTo(w[n - i]!, 6);
    }
  });

  it('has a coherent gain of 0.5', () => {
    expect(windowGain(hannWindow(1024))).toBeCloseTo(0.5, 6);
  });

  it('sums to unity at 50% overlap (COLA)', () => {
    const n = 64;
    const hop = n / 2;
    const w = hannWindow(n);
    for (let i = 0; i < hop; i++) {
      expect(w[i]! + w[i + hop]!).toBeCloseTo(1, 6);
    }
  });

  it('rejects a non-positive length', () => {
    expect(() => hannWindow(0)).toThrow();
  });
});
