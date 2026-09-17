import { describe, expect, it } from 'vitest';
import { feedbackPlanFor, showScoreOnTrial, summariseBlock } from '../src/lib/fading';

describe('feedbackPlanFor', () => {
  it('gives a live gauge and knowledge of performance while accuracy is low', () => {
    const plan = feedbackPlanFor(0.4);
    expect(plan.liveGauge).toBe(true);
    expect(plan.scoreEvery).toBe(1);
    expect(plan.kind).toBe('kp');
  });

  it('hides the gauge during recording at 70%', () => {
    const plan = feedbackPlanFor(0.7);
    expect(plan.liveGauge).toBe(false);
    expect(plan.reviewGauge).toBe(true);
    expect(plan.scoreEvery).toBe(1);
  });

  it('scores every second trial at 80% and shifts to knowledge of results', () => {
    const plan = feedbackPlanFor(0.8);
    expect(plan.scoreEvery).toBe(2);
    expect(plan.kind).toBe('kr');
    expect(plan.feedbackRate).toBe(0.5);
  });

  it('scores every third trial at 85%', () => {
    expect(feedbackPlanFor(0.85).scoreEvery).toBe(3);
    expect(feedbackPlanFor(1).scoreEvery).toBe(3);
  });

  it('never withdraws feedback as accuracy falls back', () => {
    const rates = [0.95, 0.84, 0.75, 0.5].map((a) => feedbackPlanFor(a).feedbackRate);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]!).toBeGreaterThanOrEqual(rates[i - 1]!);
    }
  });
});

describe('showScoreOnTrial', () => {
  it('shows every trial when scoreEvery is 1', () => {
    const plan = feedbackPlanFor(0);
    expect([0, 1, 2, 3].every((i) => showScoreOnTrial(plan, i))).toBe(true);
  });

  it('shows every third trial at the top of the schedule', () => {
    const plan = feedbackPlanFor(0.9);
    expect([0, 1, 2, 3, 4, 5].map((i) => showScoreOnTrial(plan, i))).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  });
});

describe('summariseBlock', () => {
  it('summarises what the hidden trials did', () => {
    expect(summariseBlock([true, true, false, true])).toEqual({
      trials: 4,
      passed: 3,
      accuracy: 0.75,
    });
  });

  it('handles an empty block', () => {
    expect(summariseBlock([])).toEqual({ trials: 0, passed: 0, accuracy: 0 });
  });
});
