import { FeatureExtractor, featureConfig, type FrameFeatures } from '../src/index.js';

export const SR = 48000;
export const FFT = 2048;
export const HOP = FFT / 2;

/** Deterministic PRNG so the tests never flake. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(out: Float32Array, targetRms: number): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < out.length; i++) sumSq += out[i]! * out[i]!;
  const rms = Math.sqrt(sumSq / out.length);
  if (rms === 0) return out;
  const g = targetRms / rms;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * g;
  return out;
}

/**
 * Noise confined to [loHz, hiHz], built as a sum of random-phase sinusoids on a
 * fine frequency grid. Exact band limits, no filter design required.
 */
export function bandLimitedNoise(
  length: number,
  loHz: number,
  hiHz: number,
  { sampleRate = SR, rms = 0.05, seed = 1 } = {},
): Float32Array {
  const rnd = mulberry32(seed);
  // Synthesise one period of `grid` samples and tile it. The segment is exactly
  // periodic, so tiling is seamless and the spectrum is unchanged — and it keeps
  // generation cheap for the multi-second signals the aggregation tests use.
  const grid = Math.min(length, 8192);
  const base = new Float32Array(grid);
  const df = sampleRate / grid;
  const kLo = Math.max(1, Math.ceil(loHz / df));
  const kHi = Math.min(Math.floor(grid / 2) - 1, Math.floor(hiHz / df));
  for (let k = kLo; k <= kHi; k++) {
    const phase = rnd() * 2 * Math.PI;
    const w = (2 * Math.PI * k) / grid;
    for (let i = 0; i < grid; i++) base[i] = base[i]! + Math.cos(w * i + phase);
  }
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = base[i % grid]!;
  return normalize(out, rms);
}

export function sine(length: number, hz: number, { sampleRate = SR, rms = 0.1 } = {}): Float32Array {
  const out = new Float32Array(length);
  const w = (2 * Math.PI * hz) / sampleRate;
  for (let i = 0; i < length; i++) out[i] = Math.sin(w * i);
  return normalize(out, rms);
}

export function silence(length: number, { rms = 0 } = {}): Float32Array {
  const out = new Float32Array(length);
  if (rms > 0) {
    const rnd = mulberry32(7);
    for (let i = 0; i < length; i++) out[i] = (rnd() * 2 - 1);
    normalize(out, rms);
  }
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Slices a signal into overlapping frames and extracts features from each. */
export function framesOf(signal: Float32Array, sampleRate = SR): FrameFeatures[] {
  const extractor = new FeatureExtractor(featureConfig(sampleRate));
  const frames: FrameFeatures[] = [];
  for (let start = 0; start + FFT <= signal.length; start += HOP) {
    frames.push(extractor.compute(signal.subarray(start, start + FFT)));
  }
  return frames;
}

/** Features of one representative frame from the middle of the signal. */
export function featuresOf(signal: Float32Array, sampleRate = SR): FrameFeatures {
  const frames = framesOf(signal, sampleRate);
  if (frames.length === 0) throw new Error('signal shorter than one frame');
  return frames[Math.floor(frames.length / 2)]!;
}

export const HOP_MS = (HOP / SR) * 1000;
