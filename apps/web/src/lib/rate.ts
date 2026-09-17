/**
 * Speaking rate (spec §3.9): "a band, not a maximum".
 *
 * Both ends matter. Rushing is where a lisp reappears first — the tongue stops
 * reaching its target when there is no time to get there — but slowing right
 * down to place every /s/ deliberately produces speech that is careful and
 * unnatural, and does not transfer to a real conversation. So the readout says
 * "too slow" as readily as "too fast".
 */

export type RateVerdict = 'slow' | 'in-band' | 'fast' | 'unknown';

export interface RateBand {
  min: number;
  max: number;
}

/**
 * Unhurried conversational English. Published ranges for conversation run about
 * 120–180 wpm; the upper bound here is deliberately below that, because the
 * point of the exercise is clarity under a rate you can actually hold.
 */
export const DEFAULT_RATE_BAND: RateBand = { min: 110, max: 160 };

/** A recording shorter than this cannot give a meaningful rate. */
export const MIN_RATE_DURATION_MS = 10000;

export interface RateReading {
  wpm: number | null;
  verdict: RateVerdict;
  band: RateBand;
  /** How far outside the band, in wpm. Zero when inside it. */
  deviation: number;
}

export function wordCount(transcript: string): number {
  const trimmed = transcript.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function wordsPerMinute(transcript: string, durationMs: number): number | null {
  if (durationMs <= 0) return null;
  return (wordCount(transcript) / durationMs) * 60000;
}

export function readRate(
  transcript: string | null,
  durationMs: number | null,
  band: RateBand = DEFAULT_RATE_BAND,
): RateReading {
  if (!transcript || durationMs === null || durationMs < MIN_RATE_DURATION_MS) {
    return { wpm: null, verdict: 'unknown', band, deviation: 0 };
  }
  const wpm = wordsPerMinute(transcript, durationMs);
  if (wpm === null || wpm === 0) return { wpm, verdict: 'unknown', band, deviation: 0 };

  if (wpm < band.min) return { wpm, verdict: 'slow', band, deviation: band.min - wpm };
  if (wpm > band.max) return { wpm, verdict: 'fast', band, deviation: wpm - band.max };
  return { wpm, verdict: 'in-band', band, deviation: 0 };
}

export function describeRate(reading: RateReading): string {
  const { wpm, verdict, band } = reading;
  if (wpm === null) return 'Too short to measure a rate.';
  const rounded = Math.round(wpm);
  switch (verdict) {
    case 'in-band':
      return `${rounded} words per minute — inside the ${band.min}–${band.max} band.`;
    case 'fast':
      return `${rounded} words per minute, above the ${band.min}–${band.max} band. Rushing is where the /s/ goes first: the tongue stops arriving before the sound starts.`;
    case 'slow':
      return `${rounded} words per minute, below the ${band.min}–${band.max} band. Placing every /s/ deliberately works in a drill, but it does not sound like conversation — let it run.`;
    default:
      return `${rounded} words per minute.`;
  }
}
