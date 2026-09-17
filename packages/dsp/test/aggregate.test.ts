import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GATE_CONFIG,
  aggregateUtterance,
  mean,
  median,
  percentile,
} from '../src/index.js';
import { HOP_MS, bandLimitedNoise, concat, framesOf, silence } from './signals.js';

const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: 0.004 };
const opts = { hopMs: HOP_MS, gate };

describe('statistics helpers', () => {
  it('computes median for odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('computes mean and percentiles', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe('aggregateUtterance', () => {
  it('returns null when nothing survives the gate', () => {
    const frames = framesOf(silence(48000));
    expect(frames.length).toBeGreaterThan(0);
    expect(aggregateUtterance(frames, opts)).toBeNull();
  });

  it('summarises a sustained /s/', () => {
    // 0.5 s of silence, 2 s of /s/, 0.5 s of silence.
    const signal = concat(
      silence(24000, { rms: 0.002 }),
      bandLimitedNoise(96000, 5000, 8000, { rms: 0.06 }),
      silence(24000, { rms: 0.002 }),
    );
    const u = aggregateUtterance(framesOf(signal), opts);
    expect(u).not.toBeNull();
    expect(u!.medianCentroid).toBeGreaterThan(5500);
    expect(u!.medianCentroid).toBeLessThan(8000);
    expect(u!.meanBandRatio).toBeGreaterThan(10);
    // ~2 s of fricative, allowing for frames straddling the boundaries.
    expect(u!.sDurationMs).toBeGreaterThan(1800);
    expect(u!.sDurationMs).toBeLessThan(2200);
  });

  it('takes sDurationMs from the longest contiguous run, not the total', () => {
    // A false start, a gap, then the real attempt.
    const signal = concat(
      bandLimitedNoise(9600, 5000, 8000, { rms: 0.06, seed: 2 }),
      silence(24000, { rms: 0.002 }),
      bandLimitedNoise(48000, 5000, 8000, { rms: 0.06, seed: 3 }),
    );
    const u = aggregateUtterance(framesOf(signal), opts)!;
    expect(u.sDurationMs).toBeGreaterThan(800);
    expect(u.sDurationMs).toBeLessThan(1100);
    expect(u.totalFricativeMs).toBeGreaterThan(u.sDurationMs);
  });

  it('counts every frame it was given, gated or not', () => {
    const frames = framesOf(
      concat(silence(24000, { rms: 0.002 }), bandLimitedNoise(48000, 5000, 8000, { rms: 0.06 })),
    );
    const u = aggregateUtterance(frames, opts)!;
    expect(u.frameCount).toBe(frames.length);
    expect(u.fricativeFrameCount).toBeLessThan(frames.length);
  });
});
