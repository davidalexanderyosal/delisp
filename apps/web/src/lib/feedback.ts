import type { TargetZone, UtteranceFeatures, ZoneScore } from '@delisp/dsp';
import { zoneCentre } from '@delisp/dsp';
import { DRILL } from './config';

export interface Feedback {
  /** Knowledge of results — the number (spec §3.8). */
  result: string;
  /** Knowledge of performance — what to change. Null once the sound is reliable. */
  coaching: string | null;
  tone: 'good' | 'near' | 'off' | 'none';
}

const NEAR_HZ = 700;

/**
 * Feedback for one trial. Below 80% rolling accuracy the user gets knowledge of
 * performance ("centroid low — tongue likely too far forward"); above it the
 * coaching line drops away and only the result remains, which is what the motor
 * learning literature favours once a movement is established (spec §3.8).
 */
export function feedbackFor(
  score: ZoneScore,
  utterance: UtteranceFeatures | null,
  zone: TargetZone,
  accuracy: number,
): Feedback {
  if (!utterance || score.fricativeFrames < DRILL.minFricativeFrames) {
    return {
      result: 'No /s/ heard',
      coaching:
        'Nothing came through above the room noise. Hold the button, keep the sound going for a full second, and try again — or re-run calibration if the room has changed.',
      tone: 'none',
    };
  }

  const result = `${Math.round(score.score)}% in zone · ${score.framesInZone}/${score.fricativeFrames} frames`;
  const inZone = score.score >= DRILL.passScore;
  const tone: Feedback['tone'] = inZone ? 'good' : score.score >= 30 ? 'near' : 'off';

  if (accuracy >= 0.8 && inZone) {
    return { result, coaching: null, tone };
  }

  return { result, coaching: coachingLine(score, utterance, zone), tone };
}

function coachingLine(score: ZoneScore, utterance: UtteranceFeatures, zone: TargetZone): string {
  const error = score.centroidErrorHz;
  const centre = Math.round(zoneCentre(zone));

  if (error < -NEAR_HZ) {
    // A wide, peakless spectrum low in the range is the lateral signature; a
    // narrow one is more often a frontal, th-like placement.
    if (utterance.meanSpread > 2200) {
      return `Low and diffuse (${Math.round(utterance.medianCentroid)} Hz against a ${centre} Hz target), with no clear peak — air is probably escaping over the sides of the tongue. Try the straw target: press the tongue sides up and send the air down the centre.`;
    }
    return `Centroid low (${Math.round(utterance.medianCentroid)} Hz against a ${centre} Hz target) — the tongue is likely too far forward. Try the exploding-T: hold “t…”, then release into “sss”.`;
  }

  if (error > NEAR_HZ) {
    return `Centroid high (${Math.round(utterance.medianCentroid)} Hz against a ${centre} Hz target) — thin and whistly. Relax the jaw slightly and drop the volume; a louder /s/ is not a clearer one.`;
  }

  if (utterance.meanBandRatio < zone.minBandRatio) {
    return `Placement is close, but the high band is weak (${utterance.meanBandRatio.toFixed(1)} dB). Narrow the groove down the centre of the tongue so the air stream stays focused.`;
  }

  if (utterance.sDurationMs < 600) {
    return 'Placement looks right — hold the sound longer so there is enough of it to measure.';
  }

  return `Close. Median centroid ${Math.round(utterance.medianCentroid)} Hz against a ${centre} Hz target — hold the same placement and repeat it.`;
}
