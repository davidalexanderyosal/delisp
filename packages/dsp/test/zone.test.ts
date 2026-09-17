import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GATE_CONFIG,
  DEFAULT_TARGET_ZONE,
  DEFAULT_TOLERANCE_HZ,
  isInZone,
  scoreUtterance,
  toleranceForAccuracy,
  zoneCentre,
  zoneFromCentre,
} from '../src/index.js';
import { bandLimitedNoise, concat, framesOf, silence } from './signals.js';

const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: 0.004 };

describe('target zone', () => {
  it('builds a zone as centre ± tolerance', () => {
    const z = zoneFromCentre(6500, 1500, 0);
    expect(z.centroidMin).toBe(5000);
    expect(z.centroidMax).toBe(8000);
    expect(zoneCentre(z)).toBe(6500);
  });

  it('never produces a negative lower bound', () => {
    expect(zoneFromCentre(500, 1500, 0).centroidMin).toBe(0);
  });

  it('requires both centroid and band ratio', () => {
    const z = zoneFromCentre(6500, 1500, 5);
    const base = {
      rms: 0.1,
      spread: 900,
      zcr: 0.4,
      peakHz: 6400,
      highBandDb: -20,
      lowBandDb: -30,
      voiceBarDb: -70,
    };
    expect(isInZone({ ...base, centroid: 6500, bandRatio: 10 }, z)).toBe(true);
    expect(isInZone({ ...base, centroid: 6500, bandRatio: 1 }, z)).toBe(false);
    expect(isInZone({ ...base, centroid: 4000, bandRatio: 10 }, z)).toBe(false);
  });
});

describe('scoreUtterance', () => {
  it('scores a clear /s/ near 100', () => {
    const frames = framesOf(bandLimitedNoise(48000, 5500, 8000, { rms: 0.06 }));
    const result = scoreUtterance(frames, DEFAULT_TARGET_ZONE, gate);
    expect(result.score).toBeGreaterThan(90);
    expect(result.fricativeFrames).toBeGreaterThan(10);
    expect(Math.abs(result.centroidErrorHz)).toBeLessThan(1000);
  });

  it('scores a frontal, th-like /s/ near zero and reports a negative centroid error', () => {
    const frames = framesOf(bandLimitedNoise(48000, 2500, 4500, { rms: 0.06 }));
    const result = scoreUtterance(frames, DEFAULT_TARGET_ZONE, gate);
    expect(result.score).toBeLessThan(5);
    expect(result.centroidErrorHz).toBeLessThan(-2000);
  });

  it('scores zero when no frame survives the gate', () => {
    const result = scoreUtterance(framesOf(silence(48000)), DEFAULT_TARGET_ZONE, gate);
    expect(result.score).toBe(0);
    expect(result.fricativeFrames).toBe(0);
  });

  it('ignores silence around the /s/ instead of counting it against the score', () => {
    const bare = framesOf(bandLimitedNoise(48000, 5500, 8000, { rms: 0.06 }));
    const padded = framesOf(
      concat(
        silence(24000, { rms: 0.002 }),
        bandLimitedNoise(48000, 5500, 8000, { rms: 0.06 }),
        silence(24000, { rms: 0.002 }),
      ),
    );
    const a = scoreUtterance(bare, DEFAULT_TARGET_ZONE, gate).score;
    const b = scoreUtterance(padded, DEFAULT_TARGET_ZONE, gate).score;
    expect(Math.abs(a - b)).toBeLessThan(6);
  });

  it('gives a partial score to a half-good attempt', () => {
    const frames = framesOf(
      concat(
        bandLimitedNoise(48000, 2500, 4500, { rms: 0.06, seed: 4 }),
        bandLimitedNoise(48000, 5500, 8000, { rms: 0.06, seed: 5 }),
      ),
    );
    const result = scoreUtterance(frames, DEFAULT_TARGET_ZONE, gate);
    expect(result.score).toBeGreaterThan(30);
    expect(result.score).toBeLessThan(70);
  });
});

describe('toleranceForAccuracy', () => {
  it('leaves the tolerance alone while accuracy is low', () => {
    expect(toleranceForAccuracy(DEFAULT_TOLERANCE_HZ, 0)).toBe(DEFAULT_TOLERANCE_HZ);
    expect(toleranceForAccuracy(DEFAULT_TOLERANCE_HZ, 0.6)).toBe(DEFAULT_TOLERANCE_HZ);
  });

  it('tightens as accuracy rises, and never below 60% of base', () => {
    const mid = toleranceForAccuracy(DEFAULT_TOLERANCE_HZ, 0.8);
    const high = toleranceForAccuracy(DEFAULT_TOLERANCE_HZ, 1);
    expect(mid).toBeLessThan(DEFAULT_TOLERANCE_HZ);
    expect(high).toBeLessThan(mid);
    expect(high).toBeCloseTo(DEFAULT_TOLERANCE_HZ * 0.6, 6);
  });
});
