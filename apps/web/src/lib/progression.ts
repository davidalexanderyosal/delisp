import type { Exercise } from './exercises';
import { type LevelDef, levelDef } from './levels';

/** Mirrors the `progression` table in spec §4. */
export interface ProgressionRow {
  level: number;
  status: 'locked' | 'active' | 'passed';
  /** Last N pass/fail outcomes, newest last, trimmed to the level's window. */
  accuracyWindow: number[];
  passedAt: string | null;
  nextRetestAt: string | null;
  retestStage: number;
}

/** Spaced re-test schedule in days (spec §3.7). */
export const RETEST_DAYS = [1, 3, 7, 14, 30] as const;
/** Below this on a re-test, the level comes back. */
export const RETEST_PASS = 0.75;
/** How many trials of a failed level are pushed into the next session. */
export const RETEST_TRIALS = 10;

export function newProgression(level: number, status: ProgressionRow['status']): ProgressionRow {
  return {
    level,
    status,
    accuracyWindow: [],
    passedAt: null,
    nextRetestAt: null,
    retestStage: 0,
  };
}

export function accuracyOf(row: ProgressionRow): number {
  if (row.accuracyWindow.length === 0) return 0;
  const passed = row.accuracyWindow.reduce((a, b) => a + b, 0);
  return passed / row.accuracyWindow.length;
}

/** Appends one outcome, keeping only the level's rolling window. */
export function recordOutcome(row: ProgressionRow, passed: boolean, def: LevelDef): ProgressionRow {
  const window = [...row.accuracyWindow, passed ? 1 : 0].slice(-def.window);
  return { ...row, accuracyWindow: window };
}

/**
 * Advance only on a *full* window: 85% of six trials is not 85% over the last
 * forty, and treating it as such would promote someone on a lucky streak.
 */
export function readyToAdvance(row: ProgressionRow, def: LevelDef): boolean {
  return row.accuracyWindow.length >= def.window && accuracyOf(row) >= def.advanceAt;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Marks a level passed and books the first spaced re-test. */
export function markPassed(row: ProgressionRow, now: string): ProgressionRow {
  return {
    ...row,
    status: 'passed',
    passedAt: now,
    retestStage: 0,
    nextRetestAt: addDays(now, RETEST_DAYS[0]),
  };
}

/** A cleared re-test moves to the next, longer interval; the last one repeats. */
export function passRetest(row: ProgressionRow, now: string): ProgressionRow {
  const stage = Math.min(row.retestStage + 1, RETEST_DAYS.length - 1);
  return { ...row, retestStage: stage, nextRetestAt: addDays(now, RETEST_DAYS[stage]!) };
}

/**
 * A failed re-test drops back to the shortest interval — the level is not as
 * secure as the schedule assumed, so it should come round again soon.
 */
export function failRetest(row: ProgressionRow, now: string): ProgressionRow {
  return { ...row, retestStage: 0, nextRetestAt: addDays(now, RETEST_DAYS[0]) };
}

export function isRetestDue(row: ProgressionRow, now: string): boolean {
  return row.status === 'passed' && row.nextRetestAt !== null && row.nextRetestAt <= now;
}

export function dueRetestLevels(rows: readonly ProgressionRow[], now: string): number[] {
  return rows
    .filter((r) => isRetestDue(r, now))
    .sort((a, b) => (a.nextRetestAt ?? '').localeCompare(b.nextRetestAt ?? ''))
    .map((r) => r.level);
}

/** The level the next session should drill. */
export function activeLevel(rows: readonly ProgressionRow[]): number {
  const active = rows.find((r) => r.status === 'active');
  if (active) return active.level;
  const passed = rows.filter((r) => r.status === 'passed').map((r) => r.level);
  return passed.length === 0 ? 0 : Math.max(...passed) + 1;
}

export type PracticeMode = 'blocked' | 'random';

/**
 * Blocked practice (the same prompt repeated) for the first window's worth of
 * trials at a level, random practice after that. The motor-learning result is
 * that blocked practice builds the movement faster while variable practice
 * retains it better, so the switch happens once the sound is established rather
 * than at the start (spec §3.7).
 */
export function practiceMode(trialsAtLevel: number, def: LevelDef): PracticeMode {
  return trialsAtLevel < def.window ? 'blocked' : 'random';
}

export type TrialKind = 'warmup' | 'main' | 'retest';

export interface ProgressionTarget {
  level: number;
  /** 'window' feeds the advance criterion; 'retest' judges a spaced re-test. */
  mode: 'window' | 'retest';
}

/**
 * Which progression record a finished trial belongs to, if any.
 *
 * Warm-ups belong to none: they are sustained /s/ from level 0 regardless of
 * what is being drilled, so letting them into the current level's rolling
 * window would decide promotion on a different exercise. Re-tests judge the old
 * level they came from, not the one being drilled.
 */
export function progressionTarget(
  kind: TrialKind,
  exerciseLevel: number,
  sessionLevel: number,
): ProgressionTarget | null {
  switch (kind) {
    case 'warmup':
      return null;
    case 'retest':
      return { level: exerciseLevel, mode: 'retest' };
    case 'main':
      return { level: sessionLevel, mode: 'window' };
  }
}

export interface PlannedTrial {
  exercise: Exercise;
  kind: TrialKind;
}

export interface SessionPlan {
  level: number;
  practice: PracticeMode;
  retestLevels: number[];
  trials: PlannedTrial[];
}

export interface PlanOptions {
  level: number;
  /** Trials already logged at this level; decides blocked vs random. */
  trialsAtLevel: number;
  /** Everything available, already filtered to nothing but valid exercises. */
  pool: readonly Exercise[];
  /** Level-0 prompt used for the warm-up. */
  warmup: Exercise;
  retestLevels?: readonly number[];
  retestPool?: (level: number) => readonly Exercise[];
  warmupCount?: number;
  mainCount?: number;
  rng?: () => number;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

/** Repeats each prompt `blockSize` times before moving on. */
function blockedOrder(pool: readonly Exercise[], count: number, blockSize: number): Exercise[] {
  const out: Exercise[] = [];
  let i = 0;
  while (out.length < count && pool.length > 0) {
    const exercise = pool[i % pool.length]!;
    for (let r = 0; r < blockSize && out.length < count; r++) out.push(exercise);
    i++;
  }
  return out;
}

/** Shuffles, and never repeats a prompt back to back across refills. */
function randomOrder(pool: readonly Exercise[], count: number, rng: () => number): Exercise[] {
  const out: Exercise[] = [];
  while (out.length < count && pool.length > 0) {
    const batch = shuffled(pool, rng);
    if (pool.length > 1 && out.length > 0 && batch[0]!.id === out[out.length - 1]!.id) {
      const swap = batch[1]!;
      batch[1] = batch[0]!;
      batch[0] = swap;
    }
    for (const exercise of batch) {
      if (out.length >= count) break;
      out.push(exercise);
    }
  }
  return out;
}

/**
 * Builds a session: warm-up, any re-tests that came due, then the main block
 * (spec §3.6). Re-tests go before the main block so a lapsed level is caught
 * while attention is fresh.
 */
export function planSession(opts: PlanOptions): SessionPlan {
  const def = levelDef(opts.level);
  const rng = opts.rng ?? Math.random;
  const warmupCount = opts.warmupCount ?? 5;
  const mainCount = opts.mainCount ?? 60;
  const retestLevels = [...(opts.retestLevels ?? [])];
  const practice = practiceMode(opts.trialsAtLevel, def);

  const trials: PlannedTrial[] = [];

  for (let i = 0; i < warmupCount; i++) {
    trials.push({ exercise: opts.warmup, kind: 'warmup' });
  }

  for (const level of retestLevels) {
    const pool = opts.retestPool?.(level) ?? [];
    for (const exercise of randomOrder(pool, RETEST_TRIALS, rng)) {
      trials.push({ exercise, kind: 'retest' });
    }
  }

  const main =
    practice === 'blocked'
      ? blockedOrder(opts.pool, mainCount, def.blockSize)
      : randomOrder(opts.pool, mainCount, rng);
  for (const exercise of main) trials.push({ exercise, kind: 'main' });

  return { level: opts.level, practice, retestLevels, trials };
}
