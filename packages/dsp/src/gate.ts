import type { FrameFeatures } from './features.js';

/**
 * Which frames count as "the fricative" inside a recording (spec §3.2:
 * aggregate over frames with high zcr and rms above the gate).
 */
export interface GateConfig {
  /** RMS of the room, measured during calibration (spec §3.3 step 1). */
  noiseFloor: number;
  /** How far above the noise floor a frame must sit to count, in dB. */
  marginDb: number;
  /**
   * Minimum zero-crossing rate. Vowels sit below ~0.06; a clear /s/ is 0.3+.
   * The threshold is set low enough that a frontal (th-like) or lateral attempt
   * around 3 kHz still counts as a fricative — those are exactly the attempts
   * the app has to score badly rather than fail to notice.
   */
  minZcr: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  noiseFloor: 0.004,
  marginDb: 8,
  minZcr: 0.1,
};

/** Absolute RMS a frame must exceed to escape the noise gate. */
export function gateThreshold(cfg: GateConfig): number {
  return cfg.noiseFloor * Math.pow(10, cfg.marginDb / 20);
}

export function isAboveGate(f: FrameFeatures, cfg: GateConfig): boolean {
  return f.rms > gateThreshold(cfg);
}

/** A frame that is both loud enough and noisy enough to be a voiceless fricative. */
export function isFricativeFrame(f: FrameFeatures, cfg: GateConfig): boolean {
  return isAboveGate(f, cfg) && f.zcr >= cfg.minZcr;
}
