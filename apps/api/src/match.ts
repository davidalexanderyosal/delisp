/**
 * Comparing what Whisper heard against what the prompt asked for (spec §5).
 *
 * The question is never "are these the same string" — it is "did the /s/ survive".
 * Three checks, in decreasing order of how much they can be trusted:
 *
 *   1. The exercise's declared minimal pair. If the transcript is the pair, the
 *      substitution is certain: that is what a minimal pair is for.
 *   2. A sibilant skeleton — the word with every /s/-family grapheme collapsed to
 *      one marker. If two words differ only there, the sibilant is the error.
 *   3. Edit distance, to separate "a different word" from "Whisper misheard".
 *
 * The skeleton works on spelling, not phonemes, so it catches sink/think and
 * pass/path but not sue/shoe or seat/sheet, where the vowel is spelled
 * differently. Those are exactly the cases check 1 covers, which is why the
 * declared pair is consulted first. A real CMUdict phoneme comparison is the
 * upgrade, and it belongs with the Phase 4 phoneme work.
 */

export type MatchReason =
  | 'exact'
  | 'minimal-pair'
  | 'sibilant-substitution'
  | 'different-word'
  | 'nothing-heard';

export interface Substitution {
  expected: string;
  heard: string;
  /** Index into the target's words. */
  position: number;
}

export interface MatchResult {
  match: boolean;
  target: string;
  heard: string;
  reason: MatchReason;
  substitutions: Substitution[];
}

export interface MatchOptions {
  /** The contrasting word from the exercise, e.g. 'think' for 'sink'. */
  minimalPair?: string | null;
  /** Word-level edit distance above which a word is a different word entirely. */
  maxWordDistance?: number;
}

/** Marker for a collapsed sibilant. Uppercase is safe: everything is lowercased first. */
const SIBILANT = 'S';

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  const normalized = normalize(text);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/**
 * Collapses the /s/ family — s, z, ss, zz, sh, th, soft c — to a single marker,
 * so two words that differ only in their sibilant compare equal.
 */
export function sibilantSkeleton(word: string): string {
  let w = word.toLowerCase();
  // Soft c is /s/; resolve it before the trailing vowel it depends on is dropped.
  w = w.replace(/c(?=[eiy])/g, 's');
  // Digraphs before single letters, or 'sh' would become two markers.
  w = w.replace(/sh|th|ss|zz/g, SIBILANT);
  w = w.replace(/[sz]/g, SIBILANT);
  // Silent finals that survive the substitution and would otherwise split a
  // pair: thumb/sum, and the magic e in mouse/mouth or save/shave.
  w = w.replace(/mb$/, 'm');
  w = w.replace(/e$/, '');
  // Adjacent markers can still double up, e.g. an s next to an sh.
  return w.replace(/S{2,}/g, SIBILANT);
}

/** Does the word contain any of the /s θ ʃ z/ family, in any spelling? */
export function hasSibilant(word: string): boolean {
  return sibilantSkeleton(word).includes(SIBILANT);
}

/**
 * Does the word carry an actual /s/ or /z/ — the sounds being drilled?
 *
 * Distinct from `hasSibilant`, which includes θ and ʃ because those are the
 * *error* forms and the skeleton has to collapse them to compare. A word like
 * "with" is in the sibilant family and carries no /s/ at all, so dropping it is
 * a missed word rather than a lisp.
 */
export function carriesS(word: string): boolean {
  const withoutDigraphs = word.toLowerCase().replace(/sh|th/g, '');
  return /[sz]/.test(withoutDigraphs) || /c[eiy]/.test(word.toLowerCase());
}

/** Levenshtein distance, used both for words and for aligning word sequences. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

type WordVerdict = 'exact' | 'sibilant' | 'different';

function compareWord(target: string, heard: string, maxDistance: number): WordVerdict {
  if (target === heard) return 'exact';
  if (sibilantSkeleton(target) === sibilantSkeleton(heard)) return 'sibilant';
  return editDistance(target, heard) <= maxDistance ? 'sibilant' : 'different';
}

/**
 * Aligns two word sequences so an inserted or dropped word does not shift every
 * later comparison. Returns target-index → heard word (null when nothing lines
 * up with it).
 */
export function alignWords(target: readonly string[], heard: readonly string[]): (string | null)[] {
  const rows = target.length;
  const cols = heard.length;
  const cost: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = 0; i <= rows; i++) cost[i]![0] = i;
  for (let j = 0; j <= cols; j++) cost[0]![j] = j;

  const corresponds = (a: string, b: string) =>
    a === b || sibilantSkeleton(a) === sibilantSkeleton(b);

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      // A sibilant-only difference is a cheap substitution: it is the error we
      // are looking for, not evidence that the words do not correspond.
      const same = corresponds(target[i - 1]!, heard[j - 1]!);
      cost[i]![j] = Math.min(
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
        cost[i - 1]![j - 1]! + (same ? 0 : 1),
      );
    }
  }

  const aligned: (string | null)[] = new Array<string | null>(rows).fill(null);
  let i = rows;
  let j = cols;
  while (i > 0) {
    if (j > 0) {
      const same = corresponds(target[i - 1]!, heard[j - 1]!);
      if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
        aligned[i - 1] = heard[j - 1]!;
        i--;
        j--;
        continue;
      }
      if (cost[i]![j] === cost[i]![j - 1]! + 1) {
        j--;
        continue;
      }
    }
    i--;
  }
  return aligned;
}

export function matchTranscript(
  transcript: string,
  target: string,
  options: MatchOptions = {},
): MatchResult {
  const maxDistance = options.maxWordDistance ?? 1;
  const heardWords = words(transcript);
  const targetWords = words(target);
  const heard = heardWords.join(' ');
  const wanted = targetWords.join(' ');

  const base = { target: wanted, heard, substitutions: [] as Substitution[] };

  if (heardWords.length === 0) {
    return { ...base, match: false, reason: 'nothing-heard' };
  }
  if (heard === wanted) {
    return { ...base, match: true, reason: 'exact' };
  }

  // The declared pair is the one comparison that is certain rather than inferred.
  const pair = options.minimalPair ? normalize(options.minimalPair) : null;
  if (pair && heard === pair) {
    return {
      ...base,
      match: false,
      reason: 'minimal-pair',
      substitutions: [{ expected: wanted, heard, position: 0 }],
    };
  }

  const aligned = alignWords(targetWords, heardWords);
  const substitutions: Substitution[] = [];
  let sawDifferentWord = false;

  for (const [index, expected] of targetWords.entries()) {
    const actual = aligned[index];
    if (actual === null || actual === undefined) {
      // A dropped word is only a lisp failure if it had an /s/ to lose; a word
      // like "with" is simply a word the user did not say.
      if (carriesS(expected)) {
        substitutions.push({ expected, heard: '', position: index });
      } else {
        sawDifferentWord = true;
      }
      continue;
    }
    const verdict = compareWord(expected, actual, maxDistance);
    if (verdict === 'exact') continue;
    if (verdict === 'sibilant') {
      substitutions.push({ expected, heard: actual, position: index });
    } else {
      sawDifferentWord = true;
    }
  }

  if (substitutions.length > 0) {
    return { ...base, match: false, reason: 'sibilant-substitution', substitutions };
  }
  if (sawDifferentWord) {
    return { ...base, match: false, reason: 'different-word' };
  }
  // Every target word was matched exactly; anything left over is a word Whisper
  // added, which does not make the /s/ wrong.
  return { ...base, match: true, reason: 'exact' };
}

/** Words per minute over a free-speech recording (spec §3.9). */
export function wordsPerMinute(transcript: string, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (words(transcript).length / durationMs) * 60000;
}
