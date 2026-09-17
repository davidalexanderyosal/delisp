import { DEFAULT_FFT_SIZE, DEFAULT_TOLERANCE_HZ } from '@delisp/dsp';

export const FFT_SIZE = DEFAULT_FFT_SIZE;
export const HOP_SIZE = FFT_SIZE / 2;

/**
 * Below this, Nyquist no longer covers the 8 kHz region that carries /s/, so the
 * centroid is meaningless (spec §3.1).
 */
export const MIN_SAMPLE_RATE = 32000;

/** Calibration timings (spec §3.3). */
export const CALIBRATION = {
  silenceMs: 1000,
  sustainMs: 3000,
  reps: 3,
  /** The noise floor is the 95th percentile of the silent frames, not the mean:
   *  one cough should raise the floor, a fan should not be averaged away. */
  noiseFloorPercentile: 0.95,
  /** Floor of the noise floor — guards against an impossibly quiet measurement. */
  minNoiseFloor: 0.0008,
  /**
   * Above this the room is too loud to gate against: the threshold would sit
   * over a normal speaking voice and no /s/ would ever register. Better to say
   * so than to hand back a drill that silently scores zero.
   */
  maxNoiseFloor: 0.05,
} as const;

/** Drill timings. */
export const DRILL = {
  minRecordMs: 400,
  maxRecordMs: 5000,
  /** A trial passes when this share of its fricative frames land in the zone. */
  passScore: 60,
  /** Rolling window used for level accuracy (spec §3.7, level 0). */
  windowSize: 20,
  /** Accuracy needed to clear level 0. */
  advanceAt: 0.8,
  /** Fewer fricative frames than this means "we did not hear an /s/". */
  minFricativeFrames: 4,
} as const;

export const DEFAULT_TOLERANCE = DEFAULT_TOLERANCE_HZ;

/** Centroid range drawn on the gauge. */
export const GAUGE_RANGE: [number, number] = [2000, 10000];

/** Band-ratio range drawn on the secondary bar, in dB. */
export const RATIO_RANGE: [number, number] = [-20, 25];
