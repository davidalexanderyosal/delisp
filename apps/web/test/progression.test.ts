import { describe, expect, it } from 'vitest';
import {
  RETEST_DAYS,
  RETEST_TRIALS,
  accuracyOf,
  activeLevel,
  dueRetestLevels,
  failRetest,
  markPassed,
  newProgression,
  passRetest,
  planSession,
  practiceMode,
  progressionTarget,
  readyToAdvance,
  recordOutcome,
} from '../src/lib/progression';
import { levelDef } from '../src/lib/levels';
import { exercisesForLevel, sustainedExercise } from '../src/lib/exercises';

const L2 = levelDef(2);
const NOW = '2026-01-01T00:00:00.000Z';

/** Deterministic rng so shuffles are reproducible. */
function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withOutcomes(level: number, outcomes: boolean[]) {
  const def = levelDef(level);
  return outcomes.reduce(
    (row, passed) => recordOutcome(row, passed, def),
    newProgression(level, 'active'),
  );
}

describe('rolling accuracy', () => {
  it('is zero before any trial', () => {
    expect(accuracyOf(newProgression(2, 'active'))).toBe(0);
  });

  it('keeps only the level window, so accuracy is rolling and not lifetime', () => {
    // 40 failures then 40 passes: the window holds the last 40 only.
    const row = withOutcomes(2, [
      ...Array<boolean>(40).fill(false),
      ...Array<boolean>(40).fill(true),
    ]);
    expect(row.accuracyWindow.length).toBe(L2.window);
    expect(accuracyOf(row)).toBe(1);
  });
});

describe('readyToAdvance', () => {
  it('will not advance on a short window, however good it looks', () => {
    const row = withOutcomes(2, Array<boolean>(6).fill(true));
    expect(accuracyOf(row)).toBe(1);
    expect(readyToAdvance(row, L2)).toBe(false);
  });

  it('advances at the level threshold over a full window', () => {
    const outcomes = Array.from({ length: 40 }, (_, i) => i < 34); // 85%
    expect(readyToAdvance(withOutcomes(2, outcomes), L2)).toBe(true);
  });

  it('does not advance just below the threshold', () => {
    const outcomes = Array.from({ length: 40 }, (_, i) => i < 33); // 82.5%
    expect(readyToAdvance(withOutcomes(2, outcomes), L2)).toBe(false);
  });

  it('uses each level own criterion', () => {
    const l0 = levelDef(0);
    const outcomes = Array.from({ length: 20 }, (_, i) => i < 16); // 80%
    expect(readyToAdvance(withOutcomes(0, outcomes), l0)).toBe(true);
    // The same 80% is not enough at level 2, which asks for 85%.
    expect(readyToAdvance(withOutcomes(2, Array.from({ length: 40 }, (_, i) => i < 32)), L2)).toBe(
      false,
    );
  });
});

describe('spaced re-tests', () => {
  it('books the first re-test one day after passing', () => {
    const row = markPassed(newProgression(2, 'active'), NOW);
    expect(row.status).toBe('passed');
    expect(row.retestStage).toBe(0);
    expect(row.nextRetestAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('walks out the schedule as re-tests are cleared', () => {
    let row = markPassed(newProgression(2, 'active'), NOW);
    const seen: number[] = [];
    for (let i = 0; i < RETEST_DAYS.length + 2; i++) {
      row = passRetest(row, NOW);
      seen.push(row.retestStage);
    }
    expect(seen.slice(0, RETEST_DAYS.length - 1)).toEqual([1, 2, 3, 4]);
    // The last interval repeats rather than running off the end.
    expect(row.retestStage).toBe(RETEST_DAYS.length - 1);
    expect(row.nextRetestAt).toBe('2026-01-31T00:00:00.000Z');
  });

  it('drops back to the shortest interval after a failed re-test', () => {
    let row = markPassed(newProgression(2, 'active'), NOW);
    row = passRetest(row, NOW);
    row = passRetest(row, NOW);
    expect(row.retestStage).toBe(2);
    row = failRetest(row, NOW);
    expect(row.retestStage).toBe(0);
    expect(row.nextRetestAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('reports only levels whose re-test has come due, soonest first', () => {
    const rows = [
      { ...markPassed(newProgression(1, 'active'), '2025-12-01T00:00:00.000Z') },
      { ...markPassed(newProgression(2, 'active'), '2025-12-20T00:00:00.000Z') },
      { ...markPassed(newProgression(3, 'active'), NOW) },
      newProgression(4, 'active'),
    ];
    expect(dueRetestLevels(rows, NOW)).toEqual([1, 2]);
  });
});

describe('activeLevel', () => {
  it('starts at level 0', () => {
    expect(activeLevel([newProgression(0, 'active')])).toBe(0);
  });

  it('is the level above the highest passed one when nothing is active', () => {
    expect(
      activeLevel([
        markPassed(newProgression(0, 'active'), NOW),
        markPassed(newProgression(1, 'active'), NOW),
      ]),
    ).toBe(2);
  });

  it('prefers an explicitly active level', () => {
    expect(
      activeLevel([markPassed(newProgression(0, 'active'), NOW), newProgression(1, 'active')]),
    ).toBe(1);
  });
});

describe('practice mode', () => {
  it('is blocked for the first window of trials and random after', () => {
    expect(practiceMode(0, L2)).toBe('blocked');
    expect(practiceMode(L2.window - 1, L2)).toBe('blocked');
    expect(practiceMode(L2.window, L2)).toBe('random');
  });
});

describe('planSession', () => {
  const pool = exercisesForLevel(2);
  const warmup = sustainedExercise();

  it('opens with the warm-up', () => {
    const plan = planSession({ level: 2, trialsAtLevel: 0, pool, warmup, rng: rng() });
    expect(plan.trials.slice(0, 5).every((t) => t.kind === 'warmup')).toBe(true);
    expect(plan.trials[0]!.exercise.id).toBe(warmup.id);
    expect(plan.trials[5]!.kind).toBe('main');
  });

  it('repeats each prompt in blocks early in a level', () => {
    const plan = planSession({
      level: 2,
      trialsAtLevel: 0,
      pool,
      warmup,
      warmupCount: 0,
      mainCount: 12,
      rng: rng(),
    });
    expect(plan.practice).toBe('blocked');
    const ids = plan.trials.map((t) => t.exercise.id);
    expect(ids.slice(0, L2.blockSize).every((id) => id === ids[0])).toBe(true);
    expect(ids[L2.blockSize]).not.toBe(ids[0]);
  });

  it('mixes the prompts once the level is established', () => {
    const plan = planSession({
      level: 2,
      trialsAtLevel: L2.window,
      pool,
      warmup,
      warmupCount: 0,
      mainCount: 20,
      rng: rng(),
    });
    expect(plan.practice).toBe('random');
    const ids = plan.trials.map((t) => t.exercise.id);
    expect(new Set(ids).size).toBeGreaterThan(10);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });

  it('injects ten trials of a level whose re-test came due, before the main block', () => {
    const plan = planSession({
      level: 2,
      trialsAtLevel: 0,
      pool,
      warmup,
      warmupCount: 2,
      mainCount: 5,
      retestLevels: [1],
      retestPool: (level) => exercisesForLevel(level),
      rng: rng(),
    });
    const retests = plan.trials.filter((t) => t.kind === 'retest');
    expect(retests.length).toBe(RETEST_TRIALS);
    expect(retests.every((t) => t.exercise.level === 1)).toBe(true);
    const firstRetest = plan.trials.findIndex((t) => t.kind === 'retest');
    const firstMain = plan.trials.findIndex((t) => t.kind === 'main');
    expect(firstRetest).toBeLessThan(firstMain);
  });

  it('produces the requested number of main trials even from a small pool', () => {
    const plan = planSession({
      level: 0,
      trialsAtLevel: 0,
      pool: exercisesForLevel(0),
      warmup,
      warmupCount: 0,
      mainCount: 30,
      rng: rng(),
    });
    expect(plan.trials.length).toBe(30);
  });
});

describe('progressionTarget', () => {
  it('keeps the warm-up out of every progression window', () => {
    // The warm-up is level-0 sustained /s/ whatever level is being drilled;
    // scoring it into level 2 would promote on a different exercise.
    expect(progressionTarget('warmup', 0, 2)).toBeNull();
  });

  it('scores a main-block trial against the level being drilled', () => {
    expect(progressionTarget('main', 2, 2)).toEqual({ level: 2, mode: 'window' });
  });

  it('scores a re-test against the older level it came from', () => {
    expect(progressionTarget('retest', 1, 4)).toEqual({ level: 1, mode: 'retest' });
  });
});
