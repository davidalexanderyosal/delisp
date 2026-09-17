import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_BAND,
  MIN_RATE_DURATION_MS,
  describeRate,
  readRate,
  wordCount,
  wordsPerMinute,
} from '../src/lib/rate';

const minute = 60000;

describe('wordCount', () => {
  it('counts words, not whitespace', () => {
    expect(wordCount('one two   three')).toBe(3);
    expect(wordCount('  padded  ')).toBe(1);
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });
});

describe('wordsPerMinute', () => {
  it('scales with the recording length', () => {
    expect(wordsPerMinute('a b c d', minute)).toBe(4);
    expect(wordsPerMinute('a b c d', minute / 2)).toBe(8);
  });

  it('returns null rather than dividing by zero', () => {
    expect(wordsPerMinute('a b', 0)).toBeNull();
  });
});

describe('readRate', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  it('reports a rate inside the band', () => {
    const reading = readRate(words(130), minute);
    expect(reading.verdict).toBe('in-band');
    expect(reading.deviation).toBe(0);
    expect(reading.wpm).toBeCloseTo(130, 5);
  });

  it('flags rushing, which is where the /s/ goes first', () => {
    const reading = readRate(words(200), minute);
    expect(reading.verdict).toBe('fast');
    expect(reading.deviation).toBeCloseTo(200 - DEFAULT_RATE_BAND.max, 5);
    expect(describeRate(reading)).toMatch(/Rushing/);
  });

  it('flags over-careful speech too — a band, not a maximum', () => {
    const reading = readRate(words(70), minute);
    expect(reading.verdict).toBe('slow');
    expect(reading.deviation).toBeCloseTo(DEFAULT_RATE_BAND.min - 70, 5);
    expect(describeRate(reading)).toMatch(/does not sound like conversation/);
  });

  it('treats the band edges as inside it', () => {
    expect(readRate(words(DEFAULT_RATE_BAND.min), minute).verdict).toBe('in-band');
    expect(readRate(words(DEFAULT_RATE_BAND.max), minute).verdict).toBe('in-band');
  });

  it('refuses to judge a clip too short to mean anything', () => {
    const reading = readRate(words(30), MIN_RATE_DURATION_MS - 1);
    expect(reading.verdict).toBe('unknown');
    expect(reading.wpm).toBeNull();
    expect(describeRate(reading)).toMatch(/Too short/);
  });

  it('handles a missing transcript', () => {
    expect(readRate(null, minute).verdict).toBe('unknown');
    expect(readRate('', minute).verdict).toBe('unknown');
  });

  it('accepts a custom band', () => {
    const band = { min: 90, max: 110 };
    expect(readRate(words(100), minute, band).verdict).toBe('in-band');
    expect(readRate(words(130), minute, band).verdict).toBe('fast');
  });
});
