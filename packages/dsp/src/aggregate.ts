import type { FrameFeatures } from './features.js';
import { type GateConfig, isFricativeFrame } from './gate.js';

/** Per-utterance aggregate over the frames flagged as fricative (spec §3.2). */
export interface UtteranceFeatures {
  frameCount: number;
  fricativeFrameCount: number;
  /** Longest *contiguous* run of fricative frames — the /s/ itself. */
  sDurationMs: number;
  /** All fricative frames summed, including false starts. */
  totalFricativeMs: number;
  meanCentroid: number;
  medianCentroid: number;
  meanBandRatio: number;
  medianBandRatio: number;
  meanSpread: number;
  medianPeakHz: number;
  meanRms: number;
}

export interface AggregateOptions {
  /** Milliseconds advanced per frame (hopSize / sampleRate × 1000). */
  hopMs: number;
  gate: GateConfig;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Percentile (0..1) by nearest rank. Used for the noise floor. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * Aggregates a recording. Returns `null` when no frame survived the gate —
 * i.e. the user did not actually produce a fricative.
 */
export function aggregateUtterance(
  frames: readonly FrameFeatures[],
  opts: AggregateOptions,
): UtteranceFeatures | null {
  const fricative: FrameFeatures[] = [];
  let longestRun = 0;
  let currentRun = 0;

  for (const f of frames) {
    if (isFricativeFrame(f, opts.gate)) {
      fricative.push(f);
      currentRun++;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 0;
    }
  }

  if (fricative.length === 0) return null;

  const centroids = fricative.map((f) => f.centroid);
  const ratios = fricative.map((f) => f.bandRatio);

  return {
    frameCount: frames.length,
    fricativeFrameCount: fricative.length,
    sDurationMs: longestRun * opts.hopMs,
    totalFricativeMs: fricative.length * opts.hopMs,
    meanCentroid: mean(centroids),
    medianCentroid: median(centroids),
    meanBandRatio: mean(ratios),
    medianBandRatio: median(ratios),
    meanSpread: mean(fricative.map((f) => f.spread)),
    medianPeakHz: median(fricative.map((f) => f.peakHz)),
    meanRms: mean(fricative.map((f) => f.rms)),
  };
}
