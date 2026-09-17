import type { SessionRow, TrialRow } from './db';
import { DRILL } from './config';

export interface RollingAccuracy {
  /** 0..1 over the last `windowSize` trials at this level. */
  accuracy: number;
  passed: number;
  total: number;
  windowSize: number;
  /** True once the level's advance criterion is met (spec §3.7). */
  readyToAdvance: boolean;
}

export function rollingAccuracy(
  trials: readonly TrialRow[],
  windowSize = DRILL.windowSize,
  advanceAt = DRILL.advanceAt,
): RollingAccuracy {
  const window = trials.slice(-windowSize);
  const passed = window.filter((t) => t.passed === 1).length;
  const accuracy = window.length === 0 ? 0 : passed / window.length;
  return {
    accuracy,
    passed,
    total: window.length,
    windowSize,
    readyToAdvance: window.length >= windowSize && accuracy >= advanceAt,
  };
}

export interface SessionSummary {
  session: SessionRow;
  trials: number;
  meanCentroid: number | null;
  meanScore: number | null;
  passRate: number | null;
  /** Agreement between the user's self-rating and the measured pass (spec §3.10). */
  selfRatingAgreement: number | null;
}

export function summariseSession(session: SessionRow, trials: readonly TrialRow[]): SessionSummary {
  const scored = trials.filter((t) => t.fricativeFrames >= DRILL.minFricativeFrames);
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

  const rated = trials.filter((t) => t.selfRating !== null);
  const agree = rated.filter(
    (t) => (t.selfRating === 'good') === (t.passed === 1),
  ).length;

  return {
    session,
    trials: trials.length,
    meanCentroid: mean(scored.map((t) => t.centroid)),
    meanScore: mean(trials.map((t) => t.score)),
    passRate: trials.length === 0 ? null : trials.filter((t) => t.passed === 1).length / trials.length,
    selfRatingAgreement: rated.length === 0 ? null : agree / rated.length,
  };
}

export function formatHz(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz)) return '—';
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
}

/** Same number, no unit word — for the narrow three-up stat tiles. */
export function formatHzCompact(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz)) return '—';
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)}k` : `${Math.round(hz)}`;
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
