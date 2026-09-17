import { describe, expect, it } from 'vitest';
import type { SessionRow, TrialRow } from '../src/lib/db';
import { computeStreak, dayKey, describeStreak, practiceDays } from '../src/lib/streak';

/** Local noon, so the test never straddles a timezone boundary by accident. */
function localNoon(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0);
}

let counter = 0;

function dayWithTrials(date: Date, trials = 3): { session: SessionRow; trials: TrialRow[] } {
  const id = `ses_${counter++}`;
  const session: SessionRow = {
    id,
    startedAt: date.toISOString(),
    endedAt: date.toISOString(),
    level: 0,
    trialCount: trials,
    synced: 0,
  };
  return {
    session,
    trials: Array.from(
      { length: trials },
      (_, i) =>
        ({
          id: `${id}_t${i}`,
          sessionId: id,
          createdAt: date.toISOString(),
        }) as unknown as TrialRow,
    ),
  };
}

function history(dates: Date[]): { sessions: SessionRow[]; trials: TrialRow[] } {
  const sessions: SessionRow[] = [];
  const trials: TrialRow[] = [];
  for (const date of dates) {
    const day = dayWithTrials(date);
    sessions.push(day.session);
    trials.push(...day.trials);
  }
  return { sessions, trials };
}

describe('dayKey', () => {
  it('formats the local calendar day', () => {
    expect(dayKey(localNoon(2026, 3, 9))).toBe('2026-03-09');
    expect(dayKey(localNoon(2026, 12, 31))).toBe('2026-12-31');
  });
});

describe('practiceDays', () => {
  it('only counts sessions that actually contain a trial', () => {
    // Opening the app and putting it down must not extend a streak.
    const empty: SessionRow = {
      id: 'ses_empty',
      startedAt: localNoon(2026, 3, 9).toISOString(),
      endedAt: null,
      level: 0,
      trialCount: 0,
      synced: 0,
    };
    expect(practiceDays([empty], [])).toEqual([]);
  });

  it('collapses several sessions on one day into one', () => {
    const morning = dayWithTrials(localNoon(2026, 3, 9));
    const evening = dayWithTrials(new Date(2026, 2, 9, 20, 0, 0));
    expect(
      practiceDays([morning.session, evening.session], [...morning.trials, ...evening.trials]),
    ).toEqual(['2026-03-09']);
  });

  it('credits a trial to its own day when a session runs past midnight', () => {
    const session: SessionRow = {
      id: 'ses_late',
      startedAt: new Date(2026, 2, 9, 23, 50, 0).toISOString(),
      endedAt: null,
      level: 0,
      trialCount: 1,
      synced: 0,
    };
    const trial = {
      id: 't',
      sessionId: 'ses_late',
      createdAt: new Date(2026, 2, 10, 0, 10, 0).toISOString(),
    } as unknown as TrialRow;
    expect(practiceDays([session], [trial])).toEqual(['2026-03-09', '2026-03-10']);
  });
});

describe('computeStreak', () => {
  const today = localNoon(2026, 3, 9);

  it('is zero with no history', () => {
    const streak = computeStreak([], [], today);
    expect(streak).toMatchObject({ current: 0, longest: 0, totalDays: 0, lastPracticedOn: null });
    expect(describeStreak(streak)).toBe('No sessions yet.');
  });

  it('counts consecutive days up to today', () => {
    const { sessions, trials } = history([
      localNoon(2026, 3, 7),
      localNoon(2026, 3, 8),
      localNoon(2026, 3, 9),
    ]);
    const streak = computeStreak(sessions, trials, today);
    expect(streak.current).toBe(3);
    expect(streak.practicedToday).toBe(true);
    expect(streak.atRisk).toBe(false);
  });

  it('keeps the streak alive through today when yesterday was the last session', () => {
    // The streak should not break at midnight — it breaks when a whole day passes.
    const { sessions, trials } = history([localNoon(2026, 3, 7), localNoon(2026, 3, 8)]);
    const streak = computeStreak(sessions, trials, today);
    expect(streak.current).toBe(2);
    expect(streak.practicedToday).toBe(false);
    expect(streak.atRisk).toBe(true);
    expect(describeStreak(streak)).toMatch(/practise today to keep it/);
  });

  it('breaks once a full day has been missed', () => {
    const { sessions, trials } = history([localNoon(2026, 3, 5), localNoon(2026, 3, 6)]);
    const streak = computeStreak(sessions, trials, today);
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(2);
    expect(describeStreak(streak)).toMatch(/Streak broken/);
  });

  it('remembers the longest run even after it is broken', () => {
    const { sessions, trials } = history([
      localNoon(2026, 2, 1),
      localNoon(2026, 2, 2),
      localNoon(2026, 2, 3),
      localNoon(2026, 2, 4),
      // gap
      localNoon(2026, 3, 8),
      localNoon(2026, 3, 9),
    ]);
    const streak = computeStreak(sessions, trials, today);
    expect(streak.longest).toBe(4);
    expect(streak.current).toBe(2);
    expect(streak.totalDays).toBe(6);
  });

  it('says so when the current run is the longest yet', () => {
    const { sessions, trials } = history([
      localNoon(2026, 3, 7),
      localNoon(2026, 3, 8),
      localNoon(2026, 3, 9),
    ]);
    expect(describeStreak(computeStreak(sessions, trials, today))).toMatch(/longest yet/);
  });

  it('handles a single day', () => {
    const { sessions, trials } = history([localNoon(2026, 3, 9)]);
    const streak = computeStreak(sessions, trials, today);
    expect(streak).toMatchObject({ current: 1, longest: 1, totalDays: 1 });
    expect(describeStreak(streak)).toBe('1 day');
  });

  it('counts across a month boundary', () => {
    const { sessions, trials } = history([
      localNoon(2026, 2, 27),
      localNoon(2026, 2, 28),
      localNoon(2026, 3, 1),
    ]);
    expect(computeStreak(sessions, trials, localNoon(2026, 3, 1)).current).toBe(3);
  });
});
