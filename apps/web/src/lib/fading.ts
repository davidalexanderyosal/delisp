/**
 * Feedback fading, spec §3.8. Frequent, immediate feedback builds a movement;
 * continuing it indefinitely makes the learner depend on it, so both the amount
 * and the kind of feedback are withdrawn as accuracy rises.
 */
export interface FeedbackPlan {
  /** Gauge visible while recording. */
  liveGauge: boolean;
  /** Gauge shown afterwards, on the result. */
  reviewGauge: boolean;
  /** Show the score on every Nth trial; the rest get a block summary. */
  scoreEvery: number;
  /** Stored on `settings.feedback_rate`. */
  feedbackRate: number;
  /** Knowledge of performance (what to change) vs knowledge of results (the number). */
  kind: 'kp' | 'kr';
}

export function feedbackPlanFor(accuracy: number): FeedbackPlan {
  if (accuracy >= 0.85) {
    return { liveGauge: false, reviewGauge: true, scoreEvery: 3, feedbackRate: 1 / 3, kind: 'kr' };
  }
  if (accuracy >= 0.8) {
    return { liveGauge: false, reviewGauge: true, scoreEvery: 2, feedbackRate: 0.5, kind: 'kr' };
  }
  if (accuracy >= 0.7) {
    return { liveGauge: false, reviewGauge: true, scoreEvery: 1, feedbackRate: 1, kind: 'kp' };
  }
  return { liveGauge: true, reviewGauge: true, scoreEvery: 1, feedbackRate: 1, kind: 'kp' };
}

/** `trialIndex` is 0-based within the session. */
export function showScoreOnTrial(plan: FeedbackPlan, trialIndex: number): boolean {
  return trialIndex % plan.scoreEvery === 0;
}

export interface BlockSummary {
  trials: number;
  passed: number;
  accuracy: number;
}

export function summariseBlock(outcomes: readonly boolean[]): BlockSummary {
  const passed = outcomes.filter(Boolean).length;
  return {
    trials: outcomes.length,
    passed,
    accuracy: outcomes.length === 0 ? 0 : passed / outcomes.length,
  };
}
