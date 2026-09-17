/**
 * How a level's trials are judged (spec §3.6):
 *
 *   acoustic — zone hit rate alone
 *   hybrid   — zone hit rate *and* the word being transcribed correctly
 *   asr      — transcription only; no gauge
 *   baseline — not scored; recorded for comparison over months
 */
export type Scoring = 'acoustic' | 'hybrid' | 'asr' | 'baseline';

export interface LevelDef {
  level: number;
  title: string;
  instruction: string;
  /** Rolling window the advance criterion is measured over (spec §3.7). */
  window: number;
  /** Accuracy needed over that window to advance. */
  advanceAt: number;
  scoring: Scoring;
  /** Consecutive repeats of one prompt during blocked practice. */
  blockSize: number;
}

/**
 * The articulation hierarchy, spec §3.7, with the scoring method from §3.6.
 * Levels 3–5 combine the gauge with a transcription check; 6 and up are judged
 * on the transcript alone.
 */
export const LEVELS: readonly LevelDef[] = [
  {
    level: 0,
    title: 'Sustained /s/',
    instruction: 'Hold one long “ssss” at a normal speaking volume.',
    window: 20,
    advanceAt: 0.8,
    scoring: 'acoustic',
    blockSize: 1,
  },
  {
    level: 1,
    title: 'Syllables',
    instruction: 'Say the syllable once, cleanly. The vowel changes what the tongue has to do.',
    window: 30,
    advanceAt: 0.8,
    scoring: 'acoustic',
    blockSize: 5,
  },
  {
    level: 2,
    title: 'Initial /s/ words',
    instruction: 'Say the word once. The /s/ leads, so the placement has to be right before you start.',
    window: 40,
    advanceAt: 0.85,
    scoring: 'acoustic',
    blockSize: 4,
  },
  {
    level: 3,
    title: 'Final /s/ words',
    instruction: 'Say the word once, and do not let the ending trail off.',
    window: 40,
    advanceAt: 0.85,
    scoring: 'hybrid',
    blockSize: 4,
  },
  {
    level: 4,
    title: 'Medial /s/ + clusters',
    instruction: 'Say the word once. Clusters are the hardest place to hold the groove.',
    window: 50,
    advanceAt: 0.85,
    scoring: 'hybrid',
    blockSize: 3,
  },
  {
    level: 5,
    title: 'Phrases + minimal pairs',
    instruction: 'Say the target word or phrase. Minimal pairs are judged on which word was heard.',
    window: 50,
    advanceAt: 0.85,
    scoring: 'hybrid',
    blockSize: 2,
  },
  {
    level: 6,
    title: 'Sentences',
    instruction: 'Read the sentence at a normal pace. Three to five /s/ sounds in each.',
    window: 50,
    advanceAt: 0.9,
    scoring: 'asr',
    blockSize: 1,
  },
  {
    level: 7,
    title: 'Reading passages',
    instruction: 'Read the passage aloud, straight through.',
    window: 20,
    advanceAt: 0.9,
    scoring: 'asr',
    blockSize: 1,
  },
  {
    level: 8,
    title: 'Free speech',
    instruction: 'Speak for sixty seconds. This is the weekly baseline, not a drill.',
    window: 10,
    advanceAt: 1,
    scoring: 'baseline',
    blockSize: 1,
  },
];

export function levelDef(level: number): LevelDef {
  const found = LEVELS.find((l) => l.level === level);
  if (!found) throw new Error(`no such level: ${level}`);
  return found;
}

/** A level that cannot be scored at all without the transcription endpoint. */
export function requiresApi(level: number): boolean {
  const scoring = levelDef(level).scoring;
  return scoring === 'asr' || scoring === 'baseline';
}

/**
 * A hybrid level still works offline — it just falls back to the gauge alone.
 * Refusing to drill words because the network is down would be the wrong trade
 * in an app whose whole premise is ten minutes wherever you happen to be.
 */
export function degradesOffline(level: number): boolean {
  return levelDef(level).scoring === 'hybrid';
}

export function isPlayable(level: number, apiAvailable: boolean): boolean {
  return apiAvailable || !requiresApi(level);
}

/** Why a level cannot be started, or null when it can. */
export function blockedReason(level: number, apiAvailable: boolean): string | null {
  if (isPlayable(level, apiAvailable)) return null;
  return levelDef(level).scoring === 'baseline'
    ? 'Weekly baselines are stored on the server, which is not reachable right now.'
    : 'This level is scored on what was actually heard, which needs the server. Reconnect, or drill a lower level.';
}
