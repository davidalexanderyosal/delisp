import type { TargetZone, UtteranceFeatures, ZoneScore } from '@delisp/dsp';
import { zoneCentre } from '@delisp/dsp';
import { DRILL } from './config';
import type { Exercise } from './exercises';

export interface Feedback {
  /** Knowledge of results — the number (spec §3.8). */
  result: string;
  /** Knowledge of performance — what to change. Null once the sound is reliable. */
  coaching: string | null;
  tone: 'good' | 'near' | 'off' | 'none';
}

export interface TrialOutcome {
  score: ZoneScore;
  utterance: UtteranceFeatures | null;
  /** Share of the frication that looked voiced, 0..1. */
  voicing: number;
  /** True for a /z/ prompt. */
  expectVoiced: boolean;
}

const NEAR_HZ = 700;
/** Above this share of voiced frication, the sound counts as voiced. */
export const VOICING_THRESHOLD = 0.5;

export function voicingOk(outcome: TrialOutcome): boolean {
  return outcome.expectVoiced ? outcome.voicing >= VOICING_THRESHOLD : outcome.voicing < VOICING_THRESHOLD;
}

export function trialPassed(outcome: TrialOutcome): boolean {
  return (
    outcome.score.score >= DRILL.passScore &&
    outcome.score.fricativeFrames >= DRILL.minFricativeFrames &&
    voicingOk(outcome)
  );
}

/**
 * Feedback for one trial. `kind` comes from the fading schedule (spec §3.8):
 * knowledge of performance while the movement is being built, knowledge of
 * results once it is reliable.
 */
export function feedbackFor(
  outcome: TrialOutcome,
  zone: TargetZone,
  kind: 'kp' | 'kr',
  exercise?: Exercise,
): Feedback {
  const { score, utterance } = outcome;

  if (!utterance || score.fricativeFrames < DRILL.minFricativeFrames) {
    return {
      result: 'No /s/ heard',
      coaching:
        'Nothing came through above the room noise. Hold the button, make the sound clearly, and try again — or re-run calibration if the room has changed.',
      tone: 'none',
    };
  }

  const result = `${Math.round(score.score)}% in zone · ${score.framesInZone}/${score.fricativeFrames} frames`;
  const passed = trialPassed(outcome);
  const tone: Feedback['tone'] = passed ? 'good' : score.score >= 30 ? 'near' : 'off';

  // A voicing error is reported whatever the schedule says: the placement score
  // is meaningless feedback when the wrong sound was produced.
  if (!voicingOk(outcome)) {
    return {
      result,
      coaching: outcome.expectVoiced
        ? `That came out as /s/ rather than /z/. Same tongue placement — add the voice, so you can feel the buzz in your throat. ${voicingReading(outcome)}`
        : `That came out voiced, closer to /z/ than /s/. Keep the placement and switch the voice off — /s/ is air only. ${voicingReading(outcome)}`,
      tone: 'off',
    };
  }

  if (kind === 'kr' && passed) {
    return { result, coaching: null, tone };
  }

  return { result, coaching: coachingLine(score, utterance, zone, exercise), tone };
}

function voicingReading(outcome: TrialOutcome): string {
  return `(${Math.round(outcome.voicing * 100)}% of the frication was voiced.)`;
}

function coachingLine(
  score: ZoneScore,
  utterance: UtteranceFeatures,
  zone: TargetZone,
  exercise?: Exercise,
): string {
  const error = score.centroidErrorHz;
  const centre = Math.round(zoneCentre(zone));
  const measured = Math.round(utterance.medianCentroid);

  if (error < -NEAR_HZ) {
    // A wide, peakless spectrum low in the range is the lateral signature; a
    // narrow one is more often a frontal, th-like placement.
    if (utterance.meanSpread > 1800) {
      return `Low and diffuse (${measured} Hz against a ${centre} Hz target), with no clear peak — air is probably escaping over the sides of the tongue. Try the straw target: press the tongue sides up and send the air down the centre.`;
    }
    return `Centroid low (${measured} Hz against a ${centre} Hz target) — the tongue is likely too far forward. Try the exploding-T: hold “t…”, then release into “sss”.`;
  }

  if (error > NEAR_HZ) {
    return `Centroid high (${measured} Hz against a ${centre} Hz target) — thin and whistly. Relax the jaw slightly and drop the volume; a louder /s/ is not a clearer one.`;
  }

  if (utterance.meanBandRatio < zone.minBandRatio) {
    return `Placement is close, but the high band is weak (${utterance.meanBandRatio.toFixed(1)} dB). Narrow the groove down the centre of the tongue so the air stream stays focused.`;
  }

  if (exercise?.position === 'cluster') {
    return `Close. Clusters pull the tongue toward the next sound before the /s/ is finished — hold the groove through the whole cluster. Median ${measured} Hz against a ${centre} Hz target.`;
  }

  if (exercise?.position === 'final' && utterance.sDurationMs < 250) {
    return `The ending is trailing off — only ${Math.round(utterance.sDurationMs)} ms of /s/. Finish the word rather than letting it fade.`;
  }

  return `Close. Median centroid ${measured} Hz against a ${centre} Hz target — hold the same placement and repeat it.`;
}
