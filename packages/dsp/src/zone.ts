import type { FrameFeatures } from './features.js';
import { type GateConfig, isFricativeFrame } from './gate.js';

/**
 * The green band on the gauge. A frame is "in zone" when its centroid sits
 * inside the target window *and* its band ratio is high enough — centroid alone
 * can be dragged upward by a hissy room.
 */
export interface TargetZone {
  centroidMin: number;
  centroidMax: number;
  minBandRatio: number;
}

/**
 * Defaults for a 48 kHz capture, from the spec §3.2 table ("clear /s/: centroid
 * ~5.5–8 kHz, band ratio high"). Calibration replaces these with the user's own
 * numbers; they are the fallback when the reference-clip step is skipped.
 */
export const DEFAULT_TARGET_ZONE: TargetZone = {
  centroidMin: 5500,
  centroidMax: 8500,
  minBandRatio: 0,
};

export const DEFAULT_TOLERANCE_HZ = 1500;

/** Builds a zone as `centre ± tolerance` (spec §3.3 step 4). */
export function zoneFromCentre(centreHz: number, toleranceHz: number, minBandRatio: number): TargetZone {
  return {
    centroidMin: Math.max(0, centreHz - toleranceHz),
    centroidMax: centreHz + toleranceHz,
    minBandRatio,
  };
}

export function zoneCentre(zone: TargetZone): number {
  return (zone.centroidMin + zone.centroidMax) / 2;
}

export function isInZone(f: FrameFeatures, zone: TargetZone): boolean {
  return f.centroid >= zone.centroidMin && f.centroid <= zone.centroidMax && f.bandRatio >= zone.minBandRatio;
}

export interface ZoneScore {
  /** Percentage of fricative frames inside the zone, 0–100. */
  score: number;
  framesInZone: number;
  fricativeFrames: number;
  /** Signed centroid error of the fricative frames' median, in Hz. */
  centroidErrorHz: number;
}

/**
 * Acoustic score for levels 0–2 (spec §3.6): the zone hit rate over the frames
 * that count as fricative. Frames below the gate are ignored entirely, so a
 * short quiet recording is not punished for its silence — only for its /s/.
 */
export function scoreUtterance(
  frames: readonly FrameFeatures[],
  zone: TargetZone,
  gate: GateConfig,
): ZoneScore {
  let fricativeFrames = 0;
  let framesInZone = 0;
  const centroids: number[] = [];

  for (const f of frames) {
    if (!isFricativeFrame(f, gate)) continue;
    fricativeFrames++;
    centroids.push(f.centroid);
    if (isInZone(f, zone)) framesInZone++;
  }

  if (fricativeFrames === 0) {
    return { score: 0, framesInZone: 0, fricativeFrames: 0, centroidErrorHz: 0 };
  }

  const sorted = [...centroids].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const medianCentroid =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  return {
    score: (framesInZone / fricativeFrames) * 100,
    framesInZone,
    fricativeFrames,
    centroidErrorHz: medianCentroid - zoneCentre(zone),
  };
}

/**
 * Tolerance tightens as the rolling accuracy rises (spec §3.3 step 4): an easy
 * target early on, a demanding one once the placement is reliable. Accuracy is
 * 0..1; below 0.6 nothing tightens.
 */
export function toleranceForAccuracy(baseToleranceHz: number, accuracy: number): number {
  if (accuracy <= 0.6) return baseToleranceHz;
  const t = Math.min(1, (accuracy - 0.6) / 0.35);
  return baseToleranceHz * (1 - 0.4 * t);
}
