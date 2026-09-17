import type { SessionRow, TrialRow } from './db';

/**
 * Practice streaks (spec §8, Phase 5).
 *
 * A day counts when it contains at least one *scored trial*, not merely an
 * opened session: starting the app and putting it down should not extend a
 * streak, or the number stops meaning anything.
 *
 * Days are local, not UTC. Someone practising at 11pm in Singapore is having a
 * different day from the one UTC thinks they are, and a streak that broke
 * because of a timezone would be indefensible.
 */

export interface Streak {
  /** Consecutive days up to today, or up to yesterday if today is still open. */
  current: number;
  longest: number;
  /** Local day key (YYYY-MM-DD) of the most recent practice, or null. */
  lastPracticedOn: string | null;
  practicedToday: boolean;
  /** True when the streak is alive but today has not been done yet. */
  atRisk: boolean;
  /** Distinct days practised, ever. */
  totalDays: number;
}

/** Local calendar day, as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

/** Distinct local days on which at least one trial was recorded. */
export function practiceDays(
  sessions: readonly SessionRow[],
  trials: readonly TrialRow[],
): string[] {
  const withTrials = new Set(trials.map((t) => t.sessionId));
  const days = new Set<string>();

  for (const session of sessions) {
    if (!withTrials.has(session.id)) continue;
    days.add(dayKey(new Date(session.startedAt)));
  }
  // A session that ran past midnight logs its trials under the trial's own day.
  for (const trial of trials) {
    days.add(dayKey(new Date(trial.createdAt)));
  }

  return [...days].sort();
}

export function computeStreak(
  sessions: readonly SessionRow[],
  trials: readonly TrialRow[],
  now: Date = new Date(),
): Streak {
  const days = practiceDays(sessions, trials);
  const today = dayKey(now);
  const yesterday = shiftDay(today, -1);

  if (days.length === 0) {
    return {
      current: 0,
      longest: 0,
      lastPracticedOn: null,
      practicedToday: false,
      atRisk: false,
      totalDays: 0,
    };
  }

  const present = new Set(days);
  const lastPracticedOn = days[days.length - 1]!;

  // Longest run anywhere in the history.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === shiftDay(days[i - 1]!, 1) ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // The current run only counts if it reaches today or yesterday: a streak
  // survives until the end of the following day, then it is over.
  let anchor: string | null = null;
  if (present.has(today)) anchor = today;
  else if (present.has(yesterday)) anchor = yesterday;

  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (present.has(cursor)) {
      current += 1;
      cursor = shiftDay(cursor, -1);
    }
  }

  return {
    current,
    longest,
    lastPracticedOn,
    practicedToday: present.has(today),
    atRisk: current > 0 && !present.has(today),
    totalDays: days.length,
  };
}

export function describeStreak(streak: Streak): string {
  if (streak.current === 0) {
    return streak.totalDays === 0
      ? 'No sessions yet.'
      : 'Streak broken — one session today starts a new one.';
  }
  const days = `${streak.current} day${streak.current === 1 ? '' : 's'}`;
  if (streak.atRisk) return `${days} — practise today to keep it.`;
  return streak.current === streak.longest && streak.longest > 1
    ? `${days} — your longest yet.`
    : days;
}
