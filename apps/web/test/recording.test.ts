import { describe, expect, it } from 'vitest';
import {
  AUDIO_EVERY_NTH,
  MAX_STORED_PER_SESSION,
  PREFERRED_MIME_TYPES,
  pickMimeType,
  shouldStoreAudio,
} from '../src/lib/recording';

const supports = (...types: string[]) => (type: string) => types.includes(type);

describe('pickMimeType', () => {
  it('prefers opus-in-webm, which is what Android Chrome gives', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to mp4 on iOS Safari, which supports nothing else here', () => {
    expect(pickMimeType(supports('audio/mp4'))).toBe('audio/mp4');
  });

  it('returns undefined when nothing matches, so the browser picks its own', () => {
    // Forcing an unsupported type would make MediaRecorder throw; letting the
    // browser choose is the correct fallback.
    expect(pickMimeType(() => false)).toBeUndefined();
  });

  it('only ever offers audio types', () => {
    for (const type of PREFERRED_MIME_TYPES) expect(type.startsWith('audio/')).toBe(true);
  });
});

describe('shouldStoreAudio', () => {
  const base = { trialIndex: 1, passed: true, storedThisSession: 0 };

  it('keeps every failed trial', () => {
    expect(shouldStoreAudio({ ...base, trialIndex: 3, passed: false })).toBe(true);
  });

  it('samples every Nth passing trial', () => {
    expect(shouldStoreAudio({ ...base, trialIndex: 0 })).toBe(true);
    expect(shouldStoreAudio({ ...base, trialIndex: AUDIO_EVERY_NTH })).toBe(true);
    expect(shouldStoreAudio({ ...base, trialIndex: AUDIO_EVERY_NTH + 1 })).toBe(false);
  });

  it('stops at the per-session cap, whatever else is true', () => {
    // The cap is what stops a bad session uploading a hundred clips.
    const atCap = { ...base, storedThisSession: MAX_STORED_PER_SESSION };
    expect(shouldStoreAudio({ ...atCap, passed: false })).toBe(false);
    expect(shouldStoreAudio({ ...atCap, trialIndex: 0 })).toBe(false);
    expect(shouldStoreAudio({ ...atCap, required: true })).toBe(false);
  });

  it('uploads a required clip even on a passing off-sample trial', () => {
    // A level scored by transcription has no score at all without the clip.
    expect(shouldStoreAudio({ ...base, trialIndex: 3, passed: true })).toBe(false);
    expect(shouldStoreAudio({ ...base, trialIndex: 3, passed: true, required: true })).toBe(true);
  });

  it('still allows storage one below the cap', () => {
    expect(
      shouldStoreAudio({ ...base, passed: false, storedThisSession: MAX_STORED_PER_SESSION - 1 }),
    ).toBe(true);
  });
});
