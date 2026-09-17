import { describe, expect, it } from 'vitest';
import {
  alignWords,
  carriesS,
  editDistance,
  hasSibilant,
  matchTranscript,
  normalize,
  sibilantSkeleton,
  words,
  wordsPerMinute,
} from '../src/match';

describe('normalize', () => {
  it('strips case, punctuation and stray whitespace', () => {
    expect(normalize('  Sales, Solutions—and  Security! ')).toBe('sales solutions and security');
  });

  it('drops apostrophes rather than splitting the word', () => {
    expect(normalize("let's")).toBe('lets');
    expect(normalize('let’s')).toBe('lets');
  });

  it('handles an empty transcript', () => {
    expect(normalize('   ')).toBe('');
    expect(words('   ')).toEqual([]);
  });
});

describe('sibilantSkeleton', () => {
  it('collapses the pairs the spec names by hand', () => {
    const pairs = [
      ['sink', 'think'],
      ['sum', 'thumb'],
      ['sick', 'thick'],
      ['mouse', 'mouth'],
      ['pass', 'path'],
      ['sip', 'ship'],
      ['sock', 'shock'],
      ['mass', 'mash'],
      ['class', 'clash'],
      ['sing', 'thing'],
      ['saw', 'thaw'],
      ['sell', 'shell'],
      ['save', 'shave'],
    ] as const;
    for (const [a, b] of pairs) {
      expect(sibilantSkeleton(a), `${a} vs ${b}`).toBe(sibilantSkeleton(b));
    }
  });

  it('treats a soft c as /s/', () => {
    expect(sibilantSkeleton('city')).toBe(sibilantSkeleton('sity'));
    expect(sibilantSkeleton('face')).toBe(sibilantSkeleton('fase'));
  });

  it('leaves a hard c alone', () => {
    expect(sibilantSkeleton('cat')).toBe('cat');
  });

  it('does not collapse words that differ elsewhere', () => {
    expect(sibilantSkeleton('sun')).not.toBe(sibilantSkeleton('sit'));
    expect(sibilantSkeleton('sock')).not.toBe(sibilantSkeleton('sack'));
  });

  it('reports which words carry a sibilant at all', () => {
    expect(hasSibilant('sun')).toBe(true);
    expect(hasSibilant('zoo')).toBe(true);
    expect(hasSibilant('thick')).toBe(true);
    expect(hasSibilant('rabbit')).toBe(false);
  });

  it('separates words that carry an actual /s/ from the wider sibilant family', () => {
    // "with" and "shock" are in the family but carry no /s/ — dropping one is a
    // missed word, not a lisp.
    expect(carriesS('sun')).toBe(true);
    expect(carriesS('zoo')).toBe(true);
    expect(carriesS('city')).toBe(true);
    expect(carriesS('this')).toBe(true);
    expect(carriesS('with')).toBe(false);
    expect(carriesS('shock')).toBe(false);
    expect(carriesS('think')).toBe(false);
    expect(carriesS('rabbit')).toBe(false);
  });
});

describe('editDistance', () => {
  it('is zero for identical strings and counts single edits', () => {
    expect(editDistance('sun', 'sun')).toBe(0);
    expect(editDistance('sun', 'son')).toBe(1);
    expect(editDistance('sun', 'suns')).toBe(1);
    expect(editDistance('', 'sun')).toBe(3);
  });
});

describe('matchTranscript — single words', () => {
  it('passes an exact transcription', () => {
    const result = matchTranscript('Sun.', 'sun');
    expect(result.match).toBe(true);
    expect(result.reason).toBe('exact');
  });

  it('fails when the declared minimal pair came back instead', () => {
    const result = matchTranscript('think', 'sink', { minimalPair: 'think' });
    expect(result.match).toBe(false);
    expect(result.reason).toBe('minimal-pair');
    expect(result.substitutions).toEqual([{ expected: 'sink', heard: 'think', position: 0 }]);
  });

  it('catches a th-substitution even with no pair declared', () => {
    const result = matchTranscript('thing', 'sing');
    expect(result.match).toBe(false);
    expect(result.reason).toBe('sibilant-substitution');
    expect(result.substitutions[0]).toMatchObject({ expected: 'sing', heard: 'thing' });
  });

  it('catches an sh-substitution', () => {
    const result = matchTranscript('shock', 'sock');
    expect(result.match).toBe(false);
    expect(result.reason).toBe('sibilant-substitution');
  });

  it('catches the pairs whose spelling defeats the skeleton, via the declared pair', () => {
    for (const [target, pair] of [
      ['sue', 'shoe'],
      ['seat', 'sheet'],
      ['so', 'show'],
      ['said', 'shed'],
      ['face', 'faith'],
    ] as const) {
      const result = matchTranscript(pair, target, { minimalPair: pair });
      expect(result.match, `${target} heard as ${pair}`).toBe(false);
      expect(result.reason).toBe('minimal-pair');
    }
  });

  it('reports a genuinely different word as a different word, not a lisp', () => {
    const result = matchTranscript('elephant', 'sun');
    expect(result.match).toBe(false);
    expect(result.reason).toBe('different-word');
    expect(result.substitutions).toEqual([]);
  });

  it('reports an empty transcript rather than calling it a substitution', () => {
    const result = matchTranscript('', 'sun');
    expect(result.match).toBe(false);
    expect(result.reason).toBe('nothing-heard');
  });

  it('tolerates a one-character mishearing on a word with a sibilant', () => {
    // "son" for "sun" is Whisper's vowel, not the user's tongue — but it is
    // still not the target, so it is reported rather than passed.
    const result = matchTranscript('son', 'sun');
    expect(result.match).toBe(false);
    expect(result.reason).toBe('sibilant-substitution');
  });
});

describe('matchTranscript — phrases and sentences', () => {
  it('passes a sentence transcribed correctly, punctuation and all', () => {
    const result = matchTranscript(
      'Sales solutions start with simple conversations!',
      'Sales solutions start with simple conversations.',
    );
    expect(result.match).toBe(true);
  });

  it('names every /s/ word that came back wrong, with its position', () => {
    const result = matchTranscript(
      'Thales solutions start with thimple conversations',
      'Sales solutions start with simple conversations',
    );
    expect(result.match).toBe(false);
    expect(result.reason).toBe('sibilant-substitution');
    expect(result.substitutions.map((s) => s.expected)).toEqual(['sales', 'simple']);
    expect(result.substitutions.map((s) => s.position)).toEqual([0, 4]);
  });

  it('does not let a dropped word shift every later comparison', () => {
    // "with" is missing; the words after it must still line up.
    const result = matchTranscript(
      'sales solutions start simple conversations',
      'sales solutions start with simple conversations',
    );
    expect(result.reason).toBe('different-word');
    expect(result.substitutions).toEqual([]);
  });

  it('flags an /s/ word that was dropped entirely', () => {
    const result = matchTranscript('pass the', 'pass the salt');
    expect(result.match).toBe(false);
    expect(result.substitutions.map((s) => s.expected)).toEqual(['salt']);
    expect(result.substitutions[0]!.heard).toBe('');
  });

  it('ignores a word Whisper added that the prompt never asked for', () => {
    const result = matchTranscript('um pass the salt', 'pass the salt');
    expect(result.match).toBe(true);
  });

  it('finds the substitution in a long sentence', () => {
    const result = matchTranscript(
      'Thix customers signed subscriptions last Saturday',
      'Six customers signed subscriptions last Saturday',
    );
    expect(result.substitutions.map((s) => s.expected)).toEqual(['six']);
  });
});

describe('alignWords', () => {
  it('lines up equal sequences one to one', () => {
    expect(alignWords(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('leaves a gap where a word was dropped', () => {
    expect(alignWords(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', null, 'c']);
  });

  it('pairs a sibilant variant with the word it replaced', () => {
    expect(alignWords(['sink', 'fast'], ['think', 'fast'])).toEqual(['think', 'fast']);
  });
});

describe('wordsPerMinute', () => {
  it('counts words over the recording length', () => {
    expect(wordsPerMinute('one two three four', 60000)).toBe(4);
    expect(wordsPerMinute('one two three four', 30000)).toBe(8);
  });

  it('is zero for a zero-length recording rather than dividing by zero', () => {
    expect(wordsPerMinute('one two', 0)).toBe(0);
    expect(Number.isFinite(wordsPerMinute('one two', 0))).toBe(true);
  });
});
