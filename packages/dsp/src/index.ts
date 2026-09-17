export { isPowerOfTwo, fftInPlace, naiveDft } from './fft.js';
export { hannWindow, windowGain } from './window.js';
export { SpectrumAnalyzer, binWidth, binForHz } from './spectrum.js';
export {
  FeatureExtractor,
  featureConfig,
  nyquist,
  DEFAULT_FFT_SIZE,
  DEFAULT_FEATURE_CONFIG,
} from './features.js';
export type { FrameFeatures, FeatureConfig } from './features.js';
export {
  DEFAULT_GATE_CONFIG,
  gateThreshold,
  isAboveGate,
  isFricativeFrame,
} from './gate.js';
export type { GateConfig } from './gate.js';
export { aggregateUtterance, mean, median, percentile } from './aggregate.js';
export type { UtteranceFeatures, AggregateOptions } from './aggregate.js';
export {
  DEFAULT_TARGET_ZONE,
  DEFAULT_TOLERANCE_HZ,
  zoneFromCentre,
  zoneCentre,
  isInZone,
  scoreUtterance,
  toleranceForAccuracy,
} from './zone.js';
export type { TargetZone, ZoneScore } from './zone.js';
