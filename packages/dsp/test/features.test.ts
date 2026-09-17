import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GATE_CONFIG,
  FeatureExtractor,
  featureConfig,
  gateThreshold,
  isAboveGate,
  isFricativeFrame,
} from '../src/index.js';
import { SR, bandLimitedNoise, featuresOf, silence, sine } from './signals.js';

const N = 8192;

describe('frame features on synthetic signals', () => {
  it('gives a high centroid for noise band-limited to 5–8 kHz (a clear /s/)', () => {
    const f = featuresOf(bandLimitedNoise(N, 5000, 8000));
    expect(f.centroid).toBeGreaterThan(5000);
    expect(f.centroid).toBeLessThan(8000);
    expect(f.centroid).toBeCloseTo(6500, -3);
    expect(f.bandRatio).toBeGreaterThan(10);
    expect(f.peakHz).toBeGreaterThan(4800);
  });

  it('gives ~3 kHz for a 3 kHz band', () => {
    const f = featuresOf(bandLimitedNoise(N, 2900, 3100));
    expect(f.peakHz).toBeGreaterThan(2850);
    expect(f.peakHz).toBeLessThan(3150);
    expect(f.centroid).toBeGreaterThan(2800);
    expect(f.centroid).toBeLessThan(3200);
    // All the energy is in the 1–4 kHz denominator band.
    expect(f.bandRatio).toBeLessThan(-10);
  });

  it('separates a /ʃ/-like 3–4.5 kHz band from a /s/-like 5–8 kHz band', () => {
    const sh = featuresOf(bandLimitedNoise(N, 3000, 4500));
    const s = featuresOf(bandLimitedNoise(N, 5000, 8000));
    expect(sh.centroid).toBeLessThan(s.centroid - 1500);
    expect(sh.bandRatio).toBeLessThan(s.bandRatio - 15);
  });

  it('gives a wide spread for broadband noise and a narrow one for a tight band', () => {
    const wide = featuresOf(bandLimitedNoise(N, 1000, 9000));
    const narrow = featuresOf(bandLimitedNoise(N, 6000, 6600));
    expect(narrow.spread).toBeLessThan(wide.spread);
    expect(narrow.spread).toBeLessThan(700);
    expect(wide.spread).toBeGreaterThan(1500);
  });

  it('separates voiceless noise from a voiced-like low tone by zcr', () => {
    const noise = featuresOf(bandLimitedNoise(N, 5000, 8000));
    const tone = featuresOf(sine(N, 150));
    expect(noise.zcr).toBeGreaterThan(0.2);
    expect(tone.zcr).toBeLessThan(0.02);
  });

  it('reports rms independently of spectral shape', () => {
    const quiet = featuresOf(bandLimitedNoise(N, 5000, 8000, { rms: 0.01 }));
    const loud = featuresOf(bandLimitedNoise(N, 5000, 8000, { rms: 0.2 }));
    expect(quiet.rms).toBeCloseTo(0.01, 2);
    expect(loud.rms).toBeCloseTo(0.2, 1);
    expect(quiet.centroid).toBeCloseTo(loud.centroid, -2);
  });

  it('is unaffected by a DC offset', () => {
    const base = bandLimitedNoise(N, 5000, 8000);
    const offset = Float32Array.from(base, (v) => v + 0.3);
    const a = featuresOf(base);
    const b = featuresOf(offset);
    expect(b.rms).toBeCloseTo(a.rms, 4);
    expect(b.zcr).toBeCloseTo(a.zcr, 3);
    expect(b.centroid).toBeCloseTo(a.centroid, -1);
  });

  it('rejects a frame of the wrong length', () => {
    const extractor = new FeatureExtractor(featureConfig(SR));
    expect(() => extractor.compute(new Float32Array(1000))).toThrow(/2048 samples/);
  });
});

describe('noise gate', () => {
  it('gates silence', () => {
    const f = featuresOf(silence(N));
    expect(f.rms).toBe(0);
    expect(isAboveGate(f, DEFAULT_GATE_CONFIG)).toBe(false);
    expect(isFricativeFrame(f, DEFAULT_GATE_CONFIG)).toBe(false);
  });

  it('gates room tone just above digital silence', () => {
    const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: 0.004 };
    const f = featuresOf(silence(N, { rms: 0.003 }));
    expect(isFricativeFrame(f, gate)).toBe(false);
  });

  it('passes a real /s/ recorded over the same room tone', () => {
    const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: 0.004 };
    const f = featuresOf(bandLimitedNoise(N, 5000, 8000, { rms: 0.06 }));
    expect(isAboveGate(f, gate)).toBe(true);
    expect(isFricativeFrame(f, gate)).toBe(true);
  });

  it('gates a loud but tonal frame — loud alone is not a fricative', () => {
    const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: 0.004 };
    const f = featuresOf(sine(N, 200, { rms: 0.2 }));
    expect(isAboveGate(f, gate)).toBe(true);
    expect(isFricativeFrame(f, gate)).toBe(false);
  });

  it('computes the gate threshold as noise floor + margin', () => {
    expect(gateThreshold({ noiseFloor: 0.01, marginDb: 20, minZcr: 0.15 })).toBeCloseTo(0.1, 6);
    expect(gateThreshold({ noiseFloor: 0.01, marginDb: 0, minZcr: 0.15 })).toBeCloseTo(0.01, 6);
  });
});
