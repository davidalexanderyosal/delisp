/**
 * Which container the browser will give us, and which clips are worth keeping.
 *
 * Both are pure so they can be unit-tested: the first is guesswork about browser
 * support that is easy to get subtly wrong, and the second is a retention policy
 * whose failure mode (quietly storing everything, or nothing) is invisible.
 */

/**
 * In preference order. iOS Safari gives `audio/mp4`; Android Chrome gives
 * `audio/webm;codecs=opus`. Whatever comes back is stored as-is and converted
 * server-side only if it ever needs to be (spec §3.1).
 */
export const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/ogg;codecs=opus',
] as const;

/**
 * Returns the first supported type, or `undefined` to let the browser pick —
 * which is the correct thing to pass to MediaRecorder when nothing matches,
 * rather than forcing a type it will reject.
 */
export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return PREFERRED_MIME_TYPES.find((type) => isSupported(type));
}

/** Store audio for every Nth trial (spec §4). */
export const AUDIO_EVERY_NTH = 5;
/** Plus every failed trial — but never more than this many per session. */
export const MAX_STORED_PER_SESSION = 20;

export interface RetentionInput {
  /** 0-based index of the trial within the session. */
  trialIndex: number;
  passed: boolean;
  /** How many clips this session has already stored. */
  storedThisSession: number;
  /** Levels scored by transcription must upload regardless of the sampling. */
  required?: boolean;
}

/**
 * Spec §4: "store audio for every 5th trial plus all failed trials (capped at
 * 20/session)". The cap is what stops a bad session from uploading a hundred
 * clips; a trial that *needs* transcription to be scored at all bypasses the
 * sampling but still respects the cap.
 */
export function shouldStoreAudio({
  trialIndex,
  passed,
  storedThisSession,
  required = false,
}: RetentionInput): boolean {
  if (storedThisSession >= MAX_STORED_PER_SESSION) return false;
  if (required) return true;
  if (!passed) return true;
  return trialIndex % AUDIO_EVERY_NTH === 0;
}
