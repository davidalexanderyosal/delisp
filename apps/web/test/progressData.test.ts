import { describe, expect, it } from 'vitest';
import type { SessionRow, TrialRow } from '../src/lib/db';
import {
  SUSTAINED_EXERCISE_ID,
  histogram,
  levelSummaries,
  ratingCalibration,
  sessionSeries,
  weekStart,
  weeklyCentroids,
} from '../src/lib/progressData';

function session(id: string, startedAt: string, level = 0): SessionRow {
  return { id, startedAt, endedAt: null, level, trialCount: 0, synced: 0 };
}

function trial(overrides: Partial<TrialRow> & { id: string; sessionId: string }): TrialRow {
  return {
    exerciseId: SUSTAINED_EXERCISE_ID,
    level: 0,
    createdAt: '2026-01-05T10:00:00.000Z',
    centroid: 6400,
    bandRatio: 10,
    spread: 900,
    sDurationMs: 800,
    fricativeFrames: 20,
    acousticScore: 80,
    selfRating: null,
    score: 80,
    passed: 1,
    feedbackShown: 1,
    deviceLabel: null,
    synced: 0,
    ...overrides,
  };
}

describe('weekStart', () => {
  it('snaps to the Monday of the containing week', () => {
    // 2026-01-05 is a Monday; the 7th and 11th are the same week.
    expect(weekStart('2026-01-05T10:00:00.000Z')).toBe('2026-01-05');
    expect(weekStart('2026-01-07T10:00:00.000Z')).toBe('2026-01-05');
    expect(weekStart('2026-01-11T23:00:00.000Z')).toBe('2026-01-05');
    expect(weekStart('2026-01-12T00:00:00.000Z')).toBe('2026-01-12');
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(weekStart('2026-01-11T10:00:00.000Z')).toBe('2026-01-05');
  });
});

describe('sessionSeries', () => {
  it('summarises each session and sorts oldest first', () => {
    const sessions = [session('b', '2026-01-06T10:00:00.000Z'), session('a', '2026-01-05T10:00:00.000Z')];
    const trials = [
      trial({ id: '1', sessionId: 'a', passed: 1, centroid: 6000 }),
      trial({ id: '2', sessionId: 'a', passed: 0, centroid: 4000 }),
      trial({ id: '3', sessionId: 'b', passed: 1, centroid: 7000 }),
    ];
    const series = sessionSeries(sessions, trials);
    expect(series.map((p) => p.sessionId)).toEqual(['a', 'b']);
    expect(series[0]!.accuracy).toBe(0.5);
    expect(series[0]!.meanCentroid).toBe(5000);
    expect(series[1]!.accuracy).toBe(1);
  });

  it('drops sessions with no trials rather than plotting a zero', () => {
    const series = sessionSeries([session('empty', '2026-01-05T10:00:00.000Z')], []);
    expect(series).toEqual([]);
  });

  it('ignores trials where no /s/ was heard when averaging the centroid', () => {
    const trials = [
      trial({ id: '1', sessionId: 'a', centroid: 6000, fricativeFrames: 20 }),
      trial({ id: '2', sessionId: 'a', centroid: 0, fricativeFrames: 0 }),
    ];
    const series = sessionSeries([session('a', '2026-01-05T10:00:00.000Z')], trials);
    // The silent trial still counts toward accuracy, but not toward the centroid.
    expect(series[0]!.meanCentroid).toBe(6000);
    expect(series[0]!.trials).toBe(2);
  });
});

describe('histogram', () => {
  it('bins values across the range', () => {
    const h = histogram([2000, 2400, 6000], 'test', { min: 2000, max: 10000, bins: 16 });
    expect(h.binWidth).toBe(500);
    expect(h.counts[0]).toBe(2);
    expect(h.counts[8]).toBe(1);
    expect(h.total).toBe(3);
  });

  it('clamps values outside the range into the end bins instead of losing them', () => {
    const h = histogram([100, 99999], 'test', { min: 2000, max: 10000, bins: 16 });
    expect(h.counts[0]).toBe(1);
    expect(h.counts[15]).toBe(1);
    expect(h.total).toBe(2);
  });

  it('handles an empty set', () => {
    const h = histogram([], 'test');
    expect(h.total).toBe(0);
    expect(h.counts.every((c) => c === 0)).toBe(true);
  });
});

describe('weeklyCentroids', () => {
  it('returns nothing when there are no sustained trials', () => {
    expect(weeklyCentroids([])).toEqual({ first: null, latest: null, weeks: 0 });
  });

  it('only counts the sustained /s/ prompt, which is the comparable one', () => {
    const trials = [
      trial({ id: '1', sessionId: 'a', exerciseId: 'l2-sun', centroid: 3000 }),
      trial({ id: '2', sessionId: 'a', centroid: 6000 }),
    ];
    const result = weeklyCentroids(trials);
    expect(result.first!.total).toBe(1);
  });

  it('leaves the latest week null until a second week exists', () => {
    const result = weeklyCentroids([trial({ id: '1', sessionId: 'a' })]);
    expect(result.weeks).toBe(1);
    expect(result.latest).toBeNull();
  });

  it('compares the earliest week against the most recent', () => {
    const trials = [
      trial({ id: '1', sessionId: 'a', createdAt: '2026-01-05T10:00:00.000Z', centroid: 4000 }),
      trial({ id: '2', sessionId: 'b', createdAt: '2026-01-19T10:00:00.000Z', centroid: 6800 }),
      trial({ id: '3', sessionId: 'c', createdAt: '2026-02-02T10:00:00.000Z', centroid: 7200 }),
    ];
    const result = weeklyCentroids(trials);
    expect(result.weeks).toBe(3);
    // Asserted loosely: the label is locale-formatted, so the day/month order
    // depends on where it renders.
    expect(result.first!.label).toMatch(/^Week of .*\b5\b/);
    expect(result.first!.label).toMatch(/Jan/);
    expect(result.latest!.label).toMatch(/^Week of .*\b2\b/);
    expect(result.latest!.label).toMatch(/Feb/);
    expect(result.first!.counts[4]).toBe(1); // 4000 Hz
    expect(result.latest!.counts[10]).toBe(1); // 7200 Hz
  });

  it('ignores trials where nothing was heard', () => {
    const trials = [trial({ id: '1', sessionId: 'a', fricativeFrames: 0, centroid: 0 })];
    expect(weeklyCentroids(trials).weeks).toBe(0);
  });
});

describe('ratingCalibration', () => {
  it('is null before anything is rated', () => {
    expect(ratingCalibration([]).agreement).toBeNull();
  });

  it('excludes "not sure", which is not a claim to be right or wrong about', () => {
    const trials = [trial({ id: '1', sessionId: 'a', selfRating: 'unsure', passed: 1 })];
    expect(ratingCalibration(trials).rated).toBe(0);
  });

  it('separates overconfidence from underconfidence', () => {
    const trials = [
      trial({ id: '1', sessionId: 'a', selfRating: 'good', passed: 1 }),
      trial({ id: '2', sessionId: 'a', selfRating: 'good', passed: 0 }),
      trial({ id: '3', sessionId: 'a', selfRating: 'off', passed: 1 }),
      trial({ id: '4', sessionId: 'a', selfRating: 'off', passed: 0 }),
    ];
    const result = ratingCalibration(trials);
    expect(result).toMatchObject({
      rated: 4,
      agreed: 2,
      agreement: 0.5,
      overconfident: 1,
      underconfident: 1,
    });
  });
});

describe('levelSummaries', () => {
  it('groups by level and orders them', () => {
    const trials = [
      trial({ id: '1', sessionId: 'a', level: 2, passed: 1, centroid: 6000 }),
      trial({ id: '2', sessionId: 'a', level: 2, passed: 0, centroid: 4000 }),
      trial({ id: '3', sessionId: 'a', level: 0, passed: 1, centroid: 7000 }),
    ];
    const summaries = levelSummaries(trials);
    expect(summaries.map((s) => s.level)).toEqual([0, 2]);
    expect(summaries[1]).toMatchObject({ trials: 2, passed: 1, accuracy: 0.5, meanCentroid: 5000 });
  });

  it('returns nothing for an empty log', () => {
    expect(levelSummaries([])).toEqual([]);
  });
});
