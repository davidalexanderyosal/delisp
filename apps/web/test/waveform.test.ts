import { describe, expect, it } from 'vitest';
import { peaks, timingComment, toMono } from '../src/lib/waveform';

const ramp = (n: number, fn: (i: number) => number) =>
  Float32Array.from({ length: n }, (_, i) => fn(i));

describe('peaks', () => {
  it('returns one value per bucket', () => {
    expect(peaks(ramp(1000, () => 0.5), 16)).toHaveLength(16);
  });

  it('normalises to the loudest point, so quiet clips are still visible', () => {
    // Half the clip at 0.02, half at 0.04: the shape matters, not the level.
    const samples = ramp(200, (i) => (i < 100 ? 0.02 : 0.04));
    const result = peaks(samples, 2);
    expect(result[0]).toBeCloseTo(0.5, 5);
    expect(result[1]).toBeCloseTo(1, 5);
  });

  it('takes the peak of each bucket, not the mean', () => {
    // One loud sample in an otherwise silent bucket must still show.
    const samples = new Float32Array(100);
    samples[50] = 1;
    const result = peaks(samples, 2);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(1);
  });

  it('is sign-insensitive', () => {
    expect(peaks(ramp(100, () => -0.8), 4)).toEqual([1, 1, 1, 1]);
  });

  it('handles silence without dividing by zero', () => {
    expect(peaks(new Float32Array(100), 4)).toEqual([0, 0, 0, 0]);
  });

  it('handles an empty clip and a zero bucket count', () => {
    expect(peaks(new Float32Array(0), 4)).toEqual([0, 0, 0, 0]);
    expect(peaks(ramp(100, () => 1), 0)).toEqual([]);
  });

  it('does not lose buckets when there are fewer samples than buckets', () => {
    const result = peaks(ramp(3, () => 1), 8);
    expect(result).toHaveLength(8);
    expect(result.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('toMono', () => {
  it('passes a mono clip straight through', () => {
    const channel = ramp(10, (i) => i / 10);
    expect(toMono([channel])).toBe(channel);
  });

  it('averages stereo channels', () => {
    const left = Float32Array.from([1, 0, -1]);
    const right = Float32Array.from([0, 0, 1]);
    expect([...toMono([left, right])]).toEqual([0.5, 0, 0]);
  });

  it('handles no channels at all', () => {
    expect(toMono([])).toHaveLength(0);
  });
});

describe('timingComment', () => {
  it('calls out a rushed attempt', () => {
    expect(timingComment(2000, 1200)).toMatch(/less time than the model/);
  });

  it('calls out an over-careful one — shadowing is about matching rhythm', () => {
    expect(timingComment(2000, 3000)).toMatch(/longer than the model/);
  });

  it('says nothing critical when the timing is close', () => {
    expect(timingComment(2000, 2100)).toBe('Your timing is close to the model.');
    expect(timingComment(2000, 1600)).toBe('Your timing is close to the model.');
  });

  it('returns null when either clip has no duration', () => {
    expect(timingComment(0, 2000)).toBeNull();
    expect(timingComment(2000, 0)).toBeNull();
  });
});
