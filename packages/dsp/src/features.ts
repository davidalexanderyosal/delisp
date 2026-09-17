import { SpectrumAnalyzer, binWidth } from './spectrum.js';

/** Per-frame acoustic features (spec §3.2). */
export interface FrameFeatures {
  /** Root-mean-square amplitude of the (DC-removed) time frame, 0..1-ish. */
  rms: number;
  /** Spectral centroid in Hz, over the analysis band. */
  centroid: number;
  /** 10·log10(energy 5–8 kHz ÷ energy 1–4 kHz), in dB. Higher = sharper /s/. */
  bandRatio: number;
  /** Spectral spread (std deviation around the centroid) in Hz. */
  spread: number;
  /** Zero-crossing rate, crossings per sample (0..1). High for voiceless noise. */
  zcr: number;
  /** Frequency of the spectral peak in Hz (parabolically interpolated). */
  peakHz: number;
  /** Energy in the 5–8 kHz band, dBFS-ish. Kept for voicing checks. */
  highBandDb: number;
  /** Energy in the 1–4 kHz band, dBFS-ish. */
  lowBandDb: number;
  /**
   * Energy in the voice bar (80–400 Hz), dBFS-ish. Present when the vocal folds
   * are running, which is what separates /z/ from /s/ at the same placement.
   */
  voiceBarDb: number;
}

export interface FeatureConfig {
  sampleRate: number;
  fftSize: number;
  /**
   * Band over which centroid / spread / peak are computed. The lower bound
   * rejects room rumble and voicing fundamentals that would otherwise drag the
   * centroid of a fricative down; the upper bound rejects mic self-noise well
   * above the region that carries /s/.
   */
  analysisBand: [number, number];
  /** Denominator of `bandRatio`. */
  lowBand: [number, number];
  /** Numerator of `bandRatio`. */
  highBand: [number, number];
  /** Where voicing shows up as a low-frequency bar. */
  voiceBand: [number, number];
}

export const DEFAULT_FFT_SIZE = 2048;

export const DEFAULT_FEATURE_CONFIG: Omit<FeatureConfig, 'sampleRate'> = {
  fftSize: DEFAULT_FFT_SIZE,
  analysisBand: [300, 11000],
  lowBand: [1000, 4000],
  highBand: [5000, 8000],
  voiceBand: [80, 400],
};

export function featureConfig(sampleRate: number, overrides: Partial<FeatureConfig> = {}): FeatureConfig {
  return { sampleRate, ...DEFAULT_FEATURE_CONFIG, ...overrides };
}

const DB_FLOOR = -120;
const ENERGY_EPS = 1e-12;

function toDb(energy: number): number {
  if (energy <= ENERGY_EPS) return DB_FLOOR;
  return Math.max(DB_FLOOR, 10 * Math.log10(energy));
}

/**
 * Stateful feature extractor. Holds the FFT scratch buffers and the precomputed
 * bin ranges so `compute()` allocates nothing — it runs in the audio thread.
 */
export class FeatureExtractor {
  readonly config: FeatureConfig;
  private readonly analyzer: SpectrumAnalyzer;
  private readonly freqs: Float64Array;
  private readonly analysisRange: [number, number];
  private readonly lowRange: [number, number];
  private readonly highRange: [number, number];
  private readonly voiceRange: [number, number];

  constructor(config: FeatureConfig) {
    this.config = config;
    this.analyzer = new SpectrumAnalyzer(config.fftSize);

    const bw = binWidth(config.sampleRate, config.fftSize);
    const maxBin = config.fftSize / 2;
    this.freqs = new Float64Array(maxBin + 1);
    for (let k = 0; k <= maxBin; k++) this.freqs[k] = k * bw;

    const range = (band: [number, number]): [number, number] => {
      const lo = Math.max(0, Math.min(maxBin, Math.ceil(band[0] / bw)));
      const hi = Math.max(lo, Math.min(maxBin, Math.floor(band[1] / bw)));
      return [lo, hi];
    };
    this.analysisRange = range(config.analysisBand);
    this.lowRange = range(config.lowBand);
    this.highRange = range(config.highBand);
    this.voiceRange = range(config.voiceBand);
  }

  /** The window applied before the FFT — exposed for tests. */
  get window(): Float32Array {
    return this.analyzer.window;
  }

  private bandEnergy(range: [number, number]): number {
    const mag = this.analyzer.magnitude;
    let sum = 0;
    for (let k = range[0]; k <= range[1]; k++) {
      const m = mag[k]!;
      sum += m * m;
    }
    return sum;
  }

  compute(frame: Float32Array): FrameFeatures {
    const n = frame.length;

    // DC removal first: a mic with a small offset would otherwise inflate both
    // rms and the zero-crossing count.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += frame[i]!;
    mean /= n;

    let sumSq = 0;
    let crossings = 0;
    let prev = frame[0]! - mean;
    for (let i = 0; i < n; i++) {
      const x = frame[i]! - mean;
      sumSq += x * x;
      if (i > 0 && ((x >= 0 && prev < 0) || (x < 0 && prev >= 0))) crossings++;
      prev = x;
    }
    const rms = Math.sqrt(sumSq / n);
    const zcr = n > 1 ? crossings / (n - 1) : 0;

    const mag = this.analyzer.compute(frame, mean);

    // Centroid and spread, magnitude-weighted over the analysis band.
    let magSum = 0;
    let weighted = 0;
    let peakBin = this.analysisRange[0];
    let peakMag = -1;
    for (let k = this.analysisRange[0]; k <= this.analysisRange[1]; k++) {
      const m = mag[k]!;
      magSum += m;
      weighted += m * this.freqs[k]!;
      if (m > peakMag) {
        peakMag = m;
        peakBin = k;
      }
    }

    let centroid = 0;
    let spread = 0;
    if (magSum > 0) {
      centroid = weighted / magSum;
      let variance = 0;
      for (let k = this.analysisRange[0]; k <= this.analysisRange[1]; k++) {
        const d = this.freqs[k]! - centroid;
        variance += mag[k]! * d * d;
      }
      spread = Math.sqrt(variance / magSum);
    }

    const highDb = toDb(this.bandEnergy(this.highRange));
    const lowDb = toDb(this.bandEnergy(this.lowRange));

    return {
      rms,
      centroid,
      bandRatio: clampDb(highDb - lowDb),
      spread,
      zcr,
      peakHz: this.interpolatedPeakHz(peakBin),
      highBandDb: highDb,
      lowBandDb: lowDb,
      voiceBarDb: toDb(this.bandEnergy(this.voiceRange)),
    };
  }

  /** Parabolic interpolation over log-magnitudes around the peak bin. */
  private interpolatedPeakHz(peakBin: number): number {
    const mag = this.analyzer.magnitude;
    const bw = binWidth(this.config.sampleRate, this.config.fftSize);
    const lo = this.analysisRange[0];
    const hi = this.analysisRange[1];
    if (peakBin <= lo || peakBin >= hi) return peakBin * bw;

    const a = Math.log(Math.max(mag[peakBin - 1]!, 1e-20));
    const b = Math.log(Math.max(mag[peakBin]!, 1e-20));
    const c = Math.log(Math.max(mag[peakBin + 1]!, 1e-20));
    const denom = a - 2 * b + c;
    if (denom === 0) return peakBin * bw;
    const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
    return (peakBin + delta) * bw;
  }
}

function clampDb(db: number): number {
  return Math.max(-40, Math.min(40, db));
}

/** Highest frequency the capture can represent. Below ~16 kHz, /s/ is truncated. */
export function nyquist(sampleRate: number): number {
  return sampleRate / 2;
}
