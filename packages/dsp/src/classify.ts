import type { FrameFeatures } from './features.js';
import type { UtteranceFeatures } from './aggregate.js';
import { type GateConfig, isAboveGate } from './gate.js';

/**
 * Tentative acoustic pattern for a sustained /s/ (spec §3.4).
 *
 * These are proxies for tongue placement, not diagnoses, and the UI is required
 * to say so. The mapping is the spec §3.2 table read backwards:
 *
 *   clear    — centroid high, band ratio high, spread narrow
 *   frontal  — centroid low, band ratio low, spread moderate (interdental, th-like)
 *   lateral  — centroid mid/low, band ratio low, spread wide with no clear peak
 *   postalveolar — centroid ~3–4.5 kHz, i.e. the sound has drifted toward /ʃ/
 */
export type AcousticPattern = 'clear' | 'frontal' | 'lateral' | 'postalveolar' | 'unknown';

export interface ClassifyThresholds {
  /** At or above this centroid the placement is doing what it should. */
  clearCentroid: number;
  /** Band ratio a clear /s/ should reach, in dB. */
  clearBandRatio: number;
  /** Above this spread there is no clear peak — the lateral signature. */
  wideSpread: number;
  /** Centre of the /ʃ/ region. */
  postalveolarBand: [number, number];
}

export const DEFAULT_CLASSIFY_THRESHOLDS: ClassifyThresholds = {
  clearCentroid: 5500,
  clearBandRatio: 0,
  wideSpread: 1800,
  postalveolarBand: [3000, 4500],
};

export function classifySustained(
  u: UtteranceFeatures,
  thresholds: ClassifyThresholds = DEFAULT_CLASSIFY_THRESHOLDS,
): AcousticPattern {
  if (u.fricativeFrameCount === 0) return 'unknown';

  const centroid = u.medianCentroid;
  const ratio = u.medianBandRatio;

  if (centroid >= thresholds.clearCentroid && ratio >= thresholds.clearBandRatio) {
    return 'clear';
  }

  // A wide, peakless spectrum is the lateral signature, and it is checked before
  // the frequency bands: a lateral /s/ can land anywhere from 2 to 5 kHz, so its
  // shape identifies it where its centre frequency alone would not.
  if (u.meanSpread >= thresholds.wideSpread) return 'lateral';

  const [shLo, shHi] = thresholds.postalveolarBand;
  if (centroid >= shLo && centroid <= shHi) return 'postalveolar';
  if (centroid < shLo) return 'frontal';

  return 'unknown';
}

export interface VoicingConfig extends GateConfig {
  /**
   * Frication is present when the 5–8 kHz band leads the 1–4 kHz band by this
   * much. Vowels sit far below it, so this isolates the fricative inside a word
   * without needing to know where the word boundaries are.
   */
  minFricationRatioDb: number;
  /**
   * How far the voice bar may sit below the frication energy and still count as
   * voicing, in dB. A margin rather than an absolute level, because an absolute
   * threshold would only hold at one recording volume.
   */
  minVoiceBarMarginDb: number;
}

export const DEFAULT_VOICING_CONFIG: Omit<VoicingConfig, keyof GateConfig> = {
  minFricationRatioDb: 0,
  minVoiceBarMarginDb: -20,
};

/** A frame carrying fricative noise — /s/ or /z/, but not a vowel. */
export function hasFrication(f: FrameFeatures, cfg: VoicingConfig): boolean {
  return isAboveGate(f, cfg) && f.bandRatio >= cfg.minFricationRatioDb;
}

/**
 * Voicing check for /z/, the voiced twin introduced at level 2 (spec §3.7):
 * same placement, voice on. Voicing lights up the voice bar below 400 Hz, so a
 * frication frame with a strong voice bar is /z/ and one without is /s/.
 *
 * The zero-crossing rate is deliberately not used here. It reads the loudest
 * component of the whole frame, so for a /z/ whose voicing outweighs its
 * frication it collapses toward the fundamental and looks like a vowel; and the
 * 1–4 kHz band is no help either, since it sits above the fundamental and below
 * the frication and is quiet for /s/ and /z/ alike.
 */
export function isVoicedFrame(f: FrameFeatures, cfg: VoicingConfig): boolean {
  return hasFrication(f, cfg) && f.voiceBarDb - f.highBandDb >= cfg.minVoiceBarMarginDb;
}

/**
 * Share of the *frication* that looks voiced, 0..1. Measured over frication
 * frames rather than everything audible: in a word like "sun" the vowel would
 * otherwise swamp the /s/ and every word would read as voiced.
 */
export function voicingRate(frames: readonly FrameFeatures[], cfg: VoicingConfig): number {
  let frication = 0;
  let voiced = 0;
  for (const f of frames) {
    if (!hasFrication(f, cfg)) continue;
    frication++;
    if (isVoicedFrame(f, cfg)) voiced++;
  }
  return frication === 0 ? 0 : voiced / frication;
}
