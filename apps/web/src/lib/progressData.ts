import type { SessionRow, TrialRow } from './db';
import { DRILL } from './config';

/**
 * Shaping the trial log into the four views in spec §3.10. Pure, so the
 * arithmetic is unit-tested rather than eyeballed through a chart.
 */

/** The level-0 prompt, the only one whose centroid distribution is comparable week to week. */
export const SUSTAINED_EXERCISE_ID = 'l0-sustained-s';

export interface SessionPoint {
  sessionId: string;
  startedAt: string;
  level: number;
  trials: number;
  /** Share of the session's trials that passed, 0..1. */
  accuracy: number;
  /** Mean centroid over the trials where an /s/ was actually heard. */
  meanCentroid: number | null;
}

/** Monday of the week containing `iso`, as a YYYY-MM-DD string. */
export function weekStart(iso: string): string {
  const date = new Date(iso);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

export function sessionSeries(
  sessions: readonly SessionRow[],
  trials: readonly TrialRow[],
): SessionPoint[] {
  const bySession = new Map<string, TrialRow[]>();
  for (const trial of trials) {
    const list = bySession.get(trial.sessionId) ?? [];
    list.push(trial);
    bySession.set(trial.sessionId, list);
  }

  return sessions
    .map((session) => {
      const rows = bySession.get(session.id) ?? [];
      const heard = rows.filter((t) => t.fricativeFrames >= DRILL.minFricativeFrames);
      return {
        sessionId: session.id,
        startedAt: session.startedAt,
        level: session.level,
        trials: rows.length,
        accuracy: rows.length === 0 ? 0 : rows.filter((t) => t.passed === 1).length / rows.length,
        meanCentroid:
          heard.length === 0 ? null : heard.reduce((a, t) => a + t.centroid, 0) / heard.length,
      };
    })
    .filter((point) => point.trials > 0)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export interface Histogram {
  /** Lower edge of each bin, in Hz. */
  edges: number[];
  binWidth: number;
  /** Counts per bin, same length as `edges`. */
  counts: number[];
  total: number;
  label: string;
}

export interface WeeklyCentroids {
  /** The earliest week with sustained-/s/ trials. */
  first: Histogram | null;
  /** The most recent week, or null when there is only one week of data. */
  latest: Histogram | null;
  weeks: number;
}

export interface HistogramOptions {
  min?: number;
  max?: number;
  bins?: number;
}

export function histogram(
  values: readonly number[],
  label: string,
  { min = 2000, max = 10000, bins = 16 }: HistogramOptions = {},
): Histogram {
  const binWidth = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const value of values) {
    // Values outside the range land in the end bins rather than vanishing.
    const index = Math.max(0, Math.min(bins - 1, Math.floor((value - min) / binWidth)));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return {
    edges: Array.from({ length: bins }, (_, i) => min + i * binWidth),
    binWidth,
    counts,
    total: values.length,
    label,
  };
}

/**
 * The first and most recent weeks of sustained /s/, for the overlay that makes
 * months of practice visible in one picture.
 */
/** "2026-01-05" -> "week of 5 Jan", which is what a legend has room for. */
export function weekLabel(week: string): string {
  const date = new Date(`${week}T00:00:00.000Z`);
  return `Week of ${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })}`;
}

export function weeklyCentroids(trials: readonly TrialRow[]): WeeklyCentroids {
  const sustained = trials.filter(
    (t) => t.exerciseId === SUSTAINED_EXERCISE_ID && t.fricativeFrames >= DRILL.minFricativeFrames,
  );

  const byWeek = new Map<string, number[]>();
  for (const trial of sustained) {
    const week = weekStart(trial.createdAt);
    const list = byWeek.get(week) ?? [];
    list.push(trial.centroid);
    byWeek.set(week, list);
  }

  const weeks = [...byWeek.keys()].sort();
  if (weeks.length === 0) return { first: null, latest: null, weeks: 0 };

  const firstWeek = weeks[0]!;
  const lastWeek = weeks[weeks.length - 1]!;
  return {
    first: histogram(byWeek.get(firstWeek) ?? [], weekLabel(firstWeek)),
    latest: weeks.length > 1 ? histogram(byWeek.get(lastWeek) ?? [], weekLabel(lastWeek)) : null,
    weeks: weeks.length,
  };
}

export interface RatingCalibration {
  rated: number;
  agreed: number;
  /** 0..1, or null when nothing has been rated. */
  agreement: number | null;
  /** Rated good but scored a fail — the gap the self-rating step exists to close. */
  overconfident: number;
  /** Rated off but scored a pass. */
  underconfident: number;
}

export function ratingCalibration(trials: readonly TrialRow[]): RatingCalibration {
  const rated = trials.filter((t) => t.selfRating !== null && t.selfRating !== 'unsure');
  let agreed = 0;
  let overconfident = 0;
  let underconfident = 0;

  for (const trial of rated) {
    const saidGood = trial.selfRating === 'good';
    const wasGood = trial.passed === 1;
    if (saidGood === wasGood) agreed++;
    else if (saidGood) overconfident++;
    else underconfident++;
  }

  return {
    rated: rated.length,
    agreed,
    agreement: rated.length === 0 ? null : agreed / rated.length,
    overconfident,
    underconfident,
  };
}

export interface LevelSummary {
  level: number;
  trials: number;
  passed: number;
  accuracy: number;
  meanCentroid: number | null;
}

export function levelSummaries(trials: readonly TrialRow[]): LevelSummary[] {
  const byLevel = new Map<number, TrialRow[]>();
  for (const trial of trials) {
    const list = byLevel.get(trial.level) ?? [];
    list.push(trial);
    byLevel.set(trial.level, list);
  }

  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, rows]) => {
      const heard = rows.filter((t) => t.fricativeFrames >= DRILL.minFricativeFrames);
      const passed = rows.filter((t) => t.passed === 1).length;
      return {
        level,
        trials: rows.length,
        passed,
        accuracy: passed / rows.length,
        meanCentroid:
          heard.length === 0 ? null : heard.reduce((a, t) => a + t.centroid, 0) / heard.length,
      };
    });
}
