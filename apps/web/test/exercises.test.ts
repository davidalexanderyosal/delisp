import { describe, expect, it } from 'vitest';
import { EXERCISES, exercisesForLevel, promptLabel, sustainedExercise } from '../src/lib/exercises';
import { LEVELS } from '../src/lib/levels';

describe('curriculum content', () => {
  it('has unique ids', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  });

  it('only uses levels the progression knows about', () => {
    const known = new Set(LEVELS.map((l) => l.level));
    for (const e of EXERCISES) expect(known.has(e.level)).toBe(true);
  });

  it('meets the minimum counts in spec §6', () => {
    // level: [minimum exercises]
    const minimums: Record<number, number> = { 1: 20, 2: 30, 3: 30, 4: 50, 5: 40, 6: 30, 8: 10 };
    for (const [level, min] of Object.entries(minimums)) {
      expect(exercisesForLevel(Number(level)).length).toBeGreaterThanOrEqual(min);
    }
  });

  it('has exactly one sustained /s/ prompt for the warm-up', () => {
    expect(EXERCISES.filter((e) => e.position === 'isolation').length).toBe(1);
    expect(sustainedExercise().level).toBe(0);
  });

  it('introduces the voiced twin /z/ at level 2 and not before', () => {
    const voiced = EXERCISES.filter((e) => e.sound === 'z');
    expect(voiced.length).toBeGreaterThan(0);
    expect(Math.min(...voiced.map((e) => e.level))).toBe(2);
  });

  it('puts /s/ where each level says it is', () => {
    expect(exercisesForLevel(2).every((e) => e.position === 'initial')).toBe(true);
    expect(exercisesForLevel(3).every((e) => e.position === 'final')).toBe(true);
    expect(
      exercisesForLevel(4).every((e) => e.position === 'medial' || e.position === 'cluster'),
    ).toBe(true);
  });

  it('covers every cluster the spec lists at level 4', () => {
    const tags = new Set(exercisesForLevel(4).flatMap((e) => e.tags));
    for (const cluster of ['st-', 'sp-', 'sk-', 'sl-', 'sm-', 'sn-', 'sw-']) {
      expect(tags.has(cluster)).toBe(true);
    }
  });

  it('gives every minimal pair a contrasting word, and has at least 20', () => {
    const pairs = EXERCISES.filter((e) => e.tags.includes('minimal-pair'));
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    for (const pair of pairs) {
      expect(pair.minimalPair).toBeTruthy();
      expect(pair.minimalPair).not.toBe(pair.text);
    }
  });

  it('includes the pairs the spec names by hand', () => {
    const byText = new Map(
      EXERCISES.filter((e) => e.minimalPair).map((e) => [e.text, e.minimalPair]),
    );
    for (const [word, pair] of [
      ['sink', 'think'],
      ['mouth', undefined],
      ['sip', 'ship'],
      ['class', 'clash'],
    ] as const) {
      if (pair) expect(byText.get(word)).toBe(pair);
    }
  });

  it('loads every level 6 sentence with at least three /s/ letters', () => {
    for (const e of exercisesForLevel(6)) {
      const count = (e.text.toLowerCase().match(/s/g) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it('labels prompts by what the user has to do with them', () => {
    expect(promptLabel(sustainedExercise())).toBe('Hold the sound');
    const minimalPair = EXERCISES.find((e) => e.tags.includes('minimal-pair'))!;
    expect(promptLabel(minimalPair)).toMatch(/not its pair/);
  });
});
