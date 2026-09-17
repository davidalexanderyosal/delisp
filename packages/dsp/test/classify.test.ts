import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GATE_CONFIG,
  DEFAULT_VOICING_CONFIG,
  aggregateUtterance,
  classifySustained,
  voicingRate,
} from '../src/index.js';
import { HOP_MS, bandLimitedNoise, concat, framesOf, mix, silence, sine } from './signals.js';

const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: 0.004 };
const opts = { hopMs: HOP_MS, gate };
const voicing = { ...gate, ...DEFAULT_VOICING_CONFIG };

function utteranceOf(signal: Float32Array) {
  const u = aggregateUtterance(framesOf(signal), opts);
  if (!u) throw new Error('nothing survived the gate');
  return u;
}

describe('classifySustained', () => {
  it('calls a 5–8 kHz /s/ clear', () => {
    expect(classifySustained(utteranceOf(bandLimitedNoise(48000, 5500, 8000, { rms: 0.06 })))).toBe(
      'clear',
    );
  });

  it('calls a narrow low-frequency hiss frontal', () => {
    expect(classifySustained(utteranceOf(bandLimitedNoise(48000, 2000, 2800, { rms: 0.06 })))).toBe(
      'frontal',
    );
  });

  it('calls a broad peakless spectrum lateral', () => {
    const u = utteranceOf(bandLimitedNoise(48000, 1000, 9000, { rms: 0.06 }));
    expect(u.meanSpread).toBeGreaterThan(1800);
    expect(classifySustained(u)).toBe('lateral');
  });

  it('calls a 3–4.5 kHz band postalveolar, the /ʃ/ region', () => {
    expect(classifySustained(utteranceOf(bandLimitedNoise(48000, 3200, 4300, { rms: 0.06 })))).toBe(
      'postalveolar',
    );
  });

  it('returns unknown when no fricative frames were found', () => {
    expect(
      classifySustained({
        frameCount: 10,
        fricativeFrameCount: 0,
        sDurationMs: 0,
        totalFricativeMs: 0,
        meanCentroid: 0,
        medianCentroid: 0,
        meanBandRatio: 0,
        medianBandRatio: 0,
        meanSpread: 0,
        medianPeakHz: 0,
        meanRms: 0,
      }),
    ).toBe('unknown');
  });

  it('prefers the lateral shape over the frequency band when both could apply', () => {
    // Centre of mass lands in the /ʃ/ region, but the spectrum is far too wide
    // to be a /ʃ/ — that shape is what distinguishes a lateral lisp.
    const u = utteranceOf(bandLimitedNoise(48000, 700, 8000, { rms: 0.06 }));
    expect(u.medianCentroid).toBeGreaterThan(3000);
    expect(u.medianCentroid).toBeLessThan(4500);
    expect(classifySustained(u)).toBe('lateral');
  });
});

describe('voicingRate', () => {
  it('is low for voiceless /s/ frication', () => {
    expect(voicingRate(framesOf(bandLimitedNoise(48000, 5500, 8000, { rms: 0.06 })), voicing)).toBeLessThan(
      0.1,
    );
  });

  it('is high for frication mixed with voicing, as /z/ is', () => {
    const z = mix(
      sine(48000, 140, { rms: 0.05 }),
      bandLimitedNoise(48000, 5000, 8000, { rms: 0.04 }),
    );
    expect(voicingRate(framesOf(z), voicing)).toBeGreaterThan(0.9);
  });

  it('separates /z/ from /s/ at the same placement and level', () => {
    const s = bandLimitedNoise(48000, 5000, 8000, { rms: 0.06 });
    const z = mix(
      sine(48000, 140, { rms: 0.05 }),
      bandLimitedNoise(48000, 5000, 8000, { rms: 0.04 }),
    );
    expect(voicingRate(framesOf(z), voicing)).toBeGreaterThan(
      voicingRate(framesOf(s), voicing) + 0.8,
    );
  });

  it('ignores the vowel in a word and reads only the fricative', () => {
    // A crude "sun": voiced vowel energy, then voiceless /s/-like frication.
    const vowelish = mix(sine(24000, 180, { rms: 0.08 }), bandLimitedNoise(24000, 700, 2500, { rms: 0.05 }));
    const ess = bandLimitedNoise(24000, 5500, 8000, { rms: 0.05 });
    expect(voicingRate(framesOf(concat(ess, vowelish)), voicing)).toBeLessThan(0.1);
  });

  it('is zero when there is no frication at all', () => {
    expect(voicingRate(framesOf(silence(48000)), voicing)).toBe(0);
    const vowel = mix(sine(48000, 180, { rms: 0.08 }), bandLimitedNoise(48000, 700, 2500, { rms: 0.05 }));
    expect(voicingRate(framesOf(vowel), voicing)).toBe(0);
  });
});
