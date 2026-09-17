import { describe, expect, it } from 'vitest';
import { acousticVote, classifyPattern, selfReportVote } from '../src/lib/diagnostic';

const NO_REPORT = { tongueVisible: null, airAtCorners: null };

describe('acousticVote', () => {
  it('votes for the patterns it can actually distinguish', () => {
    expect(acousticVote('frontal')).toBe('frontal');
    expect(acousticVote('lateral')).toBe('lateral');
  });

  it('abstains on a clear /s/ — there is nothing to diagnose', () => {
    expect(acousticVote('clear')).toBeNull();
  });

  it('abstains on a /ʃ/-like centroid rather than guessing a lisp pattern', () => {
    expect(acousticVote('postalveolar')).toBeNull();
    expect(acousticVote('unknown')).toBeNull();
  });
});

describe('selfReportVote', () => {
  it('reads the mirror question as frontal', () => {
    expect(selfReportVote({ tongueVisible: true, airAtCorners: false })).toBe('frontal');
  });

  it('reads the straw question as lateral', () => {
    expect(selfReportVote({ tongueVisible: false, airAtCorners: true })).toBe('lateral');
  });

  it('reports both as mixed', () => {
    expect(selfReportVote({ tongueVisible: true, airAtCorners: true })).toBe('mixed');
  });

  it('abstains when neither is reported or the questions were skipped', () => {
    expect(selfReportVote({ tongueVisible: false, airAtCorners: false })).toBeNull();
    expect(selfReportVote(NO_REPORT)).toBeNull();
  });
});

describe('classifyPattern', () => {
  it('agrees with itself when both signals point the same way', () => {
    const result = classifyPattern({
      acoustic: 'frontal',
      selfReport: { tongueVisible: true, airAtCorners: false },
    });
    expect(result.pattern).toBe('frontal');
    expect(result.signalCount).toBe(2);
    expect(result.confidence).toBe('moderate');
  });

  it('returns mixed when the signals disagree', () => {
    const result = classifyPattern({
      acoustic: 'lateral',
      selfReport: { tongueVisible: true, airAtCorners: false },
    });
    expect(result.pattern).toBe('mixed');
  });

  it('follows a lone signal, but calls the confidence low', () => {
    const result = classifyPattern({ acoustic: 'lateral', selfReport: NO_REPORT });
    expect(result.pattern).toBe('lateral');
    expect(result.signalCount).toBe(1);
    expect(result.confidence).toBe('low');
  });

  it('returns unknown when nothing votes', () => {
    const result = classifyPattern({ acoustic: 'clear', selfReport: NO_REPORT });
    expect(result.pattern).toBe('unknown');
    expect(result.signalCount).toBe(0);
  });

  it('lets a third signal break a tie, as the Phase 3 minimal-pair test will', () => {
    const tied = {
      acoustic: 'lateral' as const,
      selfReport: { tongueVisible: true, airAtCorners: false },
    };
    expect(classifyPattern(tied).pattern).toBe('mixed');
    expect(classifyPattern({ ...tied, minimalPair: 'lateral' }).pattern).toBe('lateral');
    expect(classifyPattern({ ...tied, minimalPair: 'frontal' }).pattern).toBe('frontal');
  });

  it('counts a mixed self-report as a vote for each pattern', () => {
    const result = classifyPattern({
      acoustic: 'clear',
      selfReport: { tongueVisible: true, airAtCorners: true },
    });
    expect(result.pattern).toBe('mixed');
    expect(result.signalCount).toBe(1);
  });
});
