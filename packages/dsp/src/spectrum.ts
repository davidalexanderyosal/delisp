import { fftInPlace } from './fft.js';
import { hannWindow } from './window.js';

/**
 * Reusable scratch buffers for one FFT size. Allocating these once and reusing
 * them keeps the AudioWorklet's `process()` allocation-free.
 */
export class SpectrumAnalyzer {
  readonly size: number;
  readonly binCount: number;
  readonly window: Float32Array;
  /** Magnitude spectrum, bins 0..N/2 inclusive. Overwritten on every call. */
  readonly magnitude: Float32Array;

  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(size: number) {
    this.size = size;
    this.binCount = size / 2 + 1;
    this.window = hannWindow(size);
    this.magnitude = new Float32Array(this.binCount);
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /**
   * Windows `frame`, runs the FFT and fills `this.magnitude`.
   * Magnitudes are normalised by the frame length so they are independent of
   * FFT size. Returns the magnitude buffer (owned by this instance).
   */
  compute(frame: Float32Array, dcOffset = 0): Float32Array {
    const { size, re, im, window, magnitude } = this;
    if (frame.length !== size) {
      throw new Error(`SpectrumAnalyzer: expected ${size} samples, got ${frame.length}`);
    }
    for (let i = 0; i < size; i++) {
      re[i] = (frame[i]! - dcOffset) * window[i]!;
      im[i] = 0;
    }
    fftInPlace(re, im);

    const scale = 2 / size;
    for (let k = 0; k < this.binCount; k++) {
      magnitude[k] = Math.hypot(re[k]!, im[k]!) * scale;
    }
    // DC and Nyquist are not mirrored, so they must not get the factor of 2.
    magnitude[0] = magnitude[0]! / 2;
    magnitude[this.binCount - 1] = magnitude[this.binCount - 1]! / 2;
    return magnitude;
  }
}

/** Hz per FFT bin. */
export function binWidth(sampleRate: number, fftSize: number): number {
  return sampleRate / fftSize;
}

/** Index of the bin whose centre frequency is nearest `hz`, clamped to range. */
export function binForHz(hz: number, sampleRate: number, fftSize: number): number {
  const idx = Math.round(hz / binWidth(sampleRate, fftSize));
  return Math.max(0, Math.min(fftSize / 2, idx));
}
