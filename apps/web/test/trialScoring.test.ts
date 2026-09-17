import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGET_ZONE, type UtteranceFeatures, type ZoneScore } from '@delisp/dsp';
import { type TrialOutcome, feedbackFor, trialPassed, voicingOk } from '../src/lib/feedback';
import { LEVELS, blockedReason, degradesOffline, isPlayable, requiresApi } from '../src/lib/levels';

const utterance: UtteranceFeatures = {
  frameCount: 40,
  fricativeFrameCount: 30,
  sDurationMs: 700,
  totalFricativeMs: 700,
  meanCentroid: 6800,
  medianCentroid: 6800,
  meanBandRatio: 12,
  medianBandRatio: 12,
  meanSpread: 900,
  medianPeakHz: 6600,
  meanRms: 0.06,
};

const goodScore: ZoneScore = {
  score: 88,
  framesInZone: 26,
  fricativeFrames: 30,
  centroidErrorHz: -200,
};

const badScore: ZoneScore = { score: 12, framesInZone: 4, fricativeFrames: 30, centroidErrorHz: -2600 };

function outcome(overrides: Partial<TrialOutcome> = {}): TrialOutcome {
  return {
    score: goodScore,
    utterance,
    voicing: 0.02,
    expectVoiced: false,
    scoring: 'acoustic',
    asrMatch: null,
    asrText: null,
    ...overrides,
  };
}

describe('trialPassed — acoustic levels', () => {
  it('passes on the zone hit rate alone', () => {
    expect(trialPassed(outcome())).toBe(true);
    expect(trialPassed(outcome({ score: badScore }))).toBe(false);
  });

  it('ignores a transcript, since the level is not judged on one', () => {
    expect(trialPassed(outcome({ asrMatch: false }))).toBe(true);
  });

  it('fails an /s/ that came out voiced', () => {
    expect(trialPassed(outcome({ voicing: 0.9 }))).toBe(false);
  });

  it('fails a /z/ that came out voiceless', () => {
    expect(trialPassed(outcome({ expectVoiced: true, voicing: 0.05 }))).toBe(false);
    expect(trialPassed(outcome({ expectVoiced: true, voicing: 0.8 }))).toBe(true);
  });

  it('fails when nothing was heard at all', () => {
    expect(
      trialPassed(outcome({ score: { ...goodScore, fricativeFrames: 1 }, utterance: null })),
    ).toBe(false);
  });
});

describe('trialPassed — hybrid levels', () => {
  const hybrid = (o: Partial<TrialOutcome> = {}) => outcome({ scoring: 'hybrid', ...o });

  it('needs both the placement and the word', () => {
    expect(trialPassed(hybrid({ asrMatch: true }))).toBe(true);
    expect(trialPassed(hybrid({ asrMatch: false }))).toBe(false);
    expect(trialPassed(hybrid({ asrMatch: true, score: badScore }))).toBe(false);
  });

  it('falls back to the gauge when transcription did not run', () => {
    // Offline, or the upload failed. Failing a good attempt because the network
    // was down would teach exactly the wrong thing.
    expect(trialPassed(hybrid({ asrMatch: null }))).toBe(true);
    expect(trialPassed(hybrid({ asrMatch: null, score: badScore }))).toBe(false);
  });
});

describe('trialPassed — transcription-only levels', () => {
  const asr = (o: Partial<TrialOutcome> = {}) => outcome({ scoring: 'asr', ...o });

  it('is decided entirely by the transcript', () => {
    expect(trialPassed(asr({ asrMatch: true, score: badScore }))).toBe(true);
    expect(trialPassed(asr({ asrMatch: false }))).toBe(false);
  });

  it('does not pass when transcription failed — there is nothing to fall back to', () => {
    expect(trialPassed(asr({ asrMatch: null }))).toBe(false);
  });
});

describe('feedback with a transcript', () => {
  it('leads with the wrong word, whatever the gauge thought of the placement', () => {
    const result = feedbackFor(
      outcome({ scoring: 'hybrid', asrMatch: false, asrText: 'think' }),
      DEFAULT_TARGET_ZONE,
      'kr',
    );
    expect(result.tone).toBe('off');
    expect(result.coaching).toMatch(/heard as .think./);
  });

  it('reports a transcription-only pass without a percentage', () => {
    const result = feedbackFor(
      outcome({ scoring: 'asr', asrMatch: true }),
      DEFAULT_TARGET_ZONE,
      'kr',
    );
    expect(result.result).toBe('Heard correctly');
    expect(result.tone).toBe('good');
  });

  it('says plainly when a transcription-only trial could not be scored', () => {
    const result = feedbackFor(
      outcome({ scoring: 'asr', asrMatch: null }),
      DEFAULT_TARGET_ZONE,
      'kr',
    );
    expect(result.result).toBe('Not scored');
    expect(result.tone).toBe('none');
  });

  it('reports a voicing error whatever the fading schedule says', () => {
    const result = feedbackFor(outcome({ voicing: 0.9 }), DEFAULT_TARGET_ZONE, 'kr');
    expect(result.coaching).toMatch(/voiced/);
    expect(voicingOk(outcome({ voicing: 0.9 }))).toBe(false);
  });
});

describe('level availability', () => {
  it('lets the gauge-scored levels run with no server at all', () => {
    for (const level of [0, 1, 2]) {
      expect(requiresApi(level)).toBe(false);
      expect(isPlayable(level, false)).toBe(true);
    }
  });

  it('lets the hybrid levels run offline, degraded', () => {
    for (const level of [3, 4, 5]) {
      expect(degradesOffline(level)).toBe(true);
      expect(requiresApi(level)).toBe(false);
      expect(isPlayable(level, false)).toBe(true);
    }
  });

  it('locks the transcription-only levels without a server', () => {
    for (const level of [6, 7, 8]) {
      expect(requiresApi(level)).toBe(true);
      expect(isPlayable(level, false)).toBe(false);
      expect(isPlayable(level, true)).toBe(true);
      expect(blockedReason(level, false)).toBeTruthy();
      expect(blockedReason(level, true)).toBeNull();
    }
  });

  it('matches the scoring methods in spec §3.6', () => {
    const byLevel = Object.fromEntries(LEVELS.map((l) => [l.level, l.scoring]));
    expect(byLevel).toMatchObject({
      0: 'acoustic',
      1: 'acoustic',
      2: 'acoustic',
      3: 'hybrid',
      4: 'hybrid',
      5: 'hybrid',
      6: 'asr',
      7: 'asr',
      8: 'baseline',
    });
  });
});
