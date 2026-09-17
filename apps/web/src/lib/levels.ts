/** How a level's trials are judged. */
export type Scoring = 'acoustic' | 'asr' | 'baseline';

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
 * The articulation hierarchy, spec §3.7. Levels 5 and up need word-level
 * transcription to score at all, so they stay locked until the Whisper endpoint
 * exists in Phase 3 — the content is already written and waiting.
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
    scoring: 'acoustic',
    blockSize: 4,
  },
  {
    level: 4,
    title: 'Medial /s/ + clusters',
    instruction: 'Say the word once. Clusters are the hardest place to hold the groove.',
    window: 50,
    advanceAt: 0.85,
    scoring: 'acoustic',
    blockSize: 3,
  },
  {
    level: 5,
    title: 'Phrases + minimal pairs',
    instruction: 'Say the target word or phrase. Minimal pairs are judged on which word was heard.',
    window: 50,
    advanceAt: 0.85,
    scoring: 'asr',
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

/** Highest level that can be scored without server-side transcription. */
export const MAX_ACOUSTIC_LEVEL = 4;

export function levelDef(level: number): LevelDef {
  const found = LEVELS.find((l) => l.level === level);
  if (!found) throw new Error(`no such level: ${level}`);
  return found;
}

export function isPlayable(level: number): boolean {
  return level <= MAX_ACOUSTIC_LEVEL;
}

/** Why a level cannot be started yet, or null when it can. */
export function blockedReason(level: number): string | null {
  if (isPlayable(level)) return null;
  return 'Needs word-level transcription, which arrives with the Phase 3 backend.';
}
