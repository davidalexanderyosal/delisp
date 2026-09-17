import { describe, expect, it } from 'vitest';
import type { TrialRow } from '../src/lib/db';
import {
  MIN_CONFUSIONS,
  confusions,
  contrastSets,
  fallbackContrastSets,
  parseSubstitutions,
} from '../src/lib/confusions';

function trial(
  id: string,
  substitutions: { expected: string; heard: string; position?: number }[] | string | null,
  createdAt = '2026-01-05T10:00:00.000Z',
): TrialRow {
  return {
    id,
    sessionId: 'ses_1',
    exerciseId: 'l5-mp-sink-think',
    level: 5,
    createdAt,
    asrSubstitutions:
      typeof substitutions === 'string' || substitutions === null
        ? substitutions
        : JSON.stringify(substitutions.map((s) => ({ position: 0, ...s }))),
  } as unknown as TrialRow;
}

describe('parseSubstitutions', () => {
  it('reads the stored JSON', () => {
    expect(parseSubstitutions('[{"expected":"sink","heard":"think","position":0}]')).toEqual([
      { expected: 'sink', heard: 'think', position: 0 },
    ]);
  });

  it('returns nothing for an absent or empty field', () => {
    expect(parseSubstitutions(null)).toEqual([]);
    expect(parseSubstitutions(undefined)).toEqual([]);
    expect(parseSubstitutions('')).toEqual([]);
  });

  it('survives a corrupted row rather than taking the screen down with it', () => {
    expect(parseSubstitutions('{not json')).toEqual([]);
    expect(parseSubstitutions('"a string"')).toEqual([]);
    expect(parseSubstitutions('[{"expected":1}]')).toEqual([]);
  });
});

describe('confusions', () => {
  it('counts repeated pairs and ranks the most frequent first', () => {
    const trials = [
      trial('a', [{ expected: 'sink', heard: 'think' }]),
      trial('b', [{ expected: 'sink', heard: 'think' }]),
      trial('c', [{ expected: 'sue', heard: 'shoe' }]),
    ];
    const result = confusions(trials);
    expect(result[0]).toMatchObject({ expected: 'sink', heard: 'think', count: 2 });
    expect(result[1]).toMatchObject({ expected: 'sue', heard: 'shoe', count: 1 });
  });

  it('keeps the most recent occurrence', () => {
    const trials = [
      trial('a', [{ expected: 'sink', heard: 'think' }], '2026-01-05T10:00:00.000Z'),
      trial('b', [{ expected: 'sink', heard: 'think' }], '2026-03-01T10:00:00.000Z'),
    ];
    expect(confusions(trials)[0]!.lastAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('is case-insensitive, since transcripts are not consistently cased', () => {
    const trials = [
      trial('a', [{ expected: 'Sink', heard: 'Think' }]),
      trial('b', [{ expected: 'sink', heard: 'think' }]),
    ];
    expect(confusions(trials)).toHaveLength(1);
    expect(confusions(trials)[0]!.count).toBe(2);
  });

  it('counts several substitutions within one sentence separately', () => {
    const trials = [
      trial('a', [
        { expected: 'sales', heard: 'thales' },
        { expected: 'simple', heard: 'thimple' },
      ]),
    ];
    expect(confusions(trials)).toHaveLength(2);
  });

  it('returns nothing when no trial has been transcribed', () => {
    expect(confusions([trial('a', null)])).toEqual([]);
    expect(confusions([])).toEqual([]);
  });
});

describe('contrastSets', () => {
  const repeat = (n: number, expected: string, heard: string) =>
    Array.from({ length: n }, (_, i) => trial(`${expected}-${i}`, [{ expected, heard }]));

  it('drills the pairs confused most often, in order', () => {
    const trials = [...repeat(4, 'sink', 'think'), ...repeat(2, 'sue', 'shoe')];
    const sets = contrastSets(trials);
    expect(sets.map((s) => s.id)).toEqual(['sink-vs-think', 'sue-vs-shoe']);
    expect(sets[0]!.count).toBe(4);
  });

  it('ignores a pair seen only once — one mishearing is not a pattern', () => {
    expect(contrastSets(repeat(1, 'sink', 'think'))).toEqual([]);
    expect(contrastSets(repeat(MIN_CONFUSIONS, 'sink', 'think'))).toHaveLength(1);
  });

  it('ignores a dropped word, which has no contrast to train against', () => {
    const trials = repeat(3, 'salt', '');
    expect(contrastSets(trials)).toEqual([]);
  });

  it('attaches the curriculum exercise when the content already has the pair', () => {
    const sets = contrastSets(repeat(3, 'sink', 'think'));
    expect(sets[0]!.exercise?.minimalPair).toBe('think');
  });

  it('still returns a set for a pair the curriculum does not cover', () => {
    // Whisper can hear anything; the drill should not depend on us having
    // anticipated the substitution.
    const sets = contrastSets(repeat(3, 'sausage', 'thausage'));
    expect(sets).toHaveLength(1);
    expect(sets[0]!.exercise).toBeUndefined();
  });

  it('caps the number of sets', () => {
    const trials = [
      ...repeat(5, 'sink', 'think'),
      ...repeat(4, 'sue', 'shoe'),
      ...repeat(3, 'sock', 'shock'),
      ...repeat(2, 'sum', 'thumb'),
    ];
    expect(contrastSets(trials, { limit: 2 })).toHaveLength(2);
  });

  it('returns nothing before anything has been transcribed', () => {
    expect(contrastSets([])).toEqual([]);
  });
});

describe('fallbackContrastSets', () => {
  it('offers the curriculum pairs when there is no history to learn from', () => {
    const sets = fallbackContrastSets(4);
    expect(sets).toHaveLength(4);
    for (const set of sets) {
      expect(set.target).toBeTruthy();
      expect(set.contrast).toBeTruthy();
      expect(set.target).not.toBe(set.contrast);
      expect(set.count).toBe(0);
    }
  });
});
