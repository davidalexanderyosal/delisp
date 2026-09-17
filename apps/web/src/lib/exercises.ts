import { EXERCISES } from '../content/exercises.generated';

export type Sound = 's' | 'z';

export type Position =
  | 'isolation'
  | 'initial'
  | 'medial'
  | 'final'
  | 'cluster'
  | 'phrase'
  | 'sentence'
  | 'passage'
  | 'free';

/** One prompt. Mirrors the `exercises` table in spec §4. */
export interface Exercise {
  id: string;
  level: number;
  sound: Sound;
  position: Position;
  text: string;
  /** The contrasting word, e.g. 'think' for 'sink'. */
  minimalPair?: string;
  tags: readonly string[];
}

export { EXERCISES };

export function exercisesForLevel(level: number): readonly Exercise[] {
  return EXERCISES.filter((e) => e.level === level);
}

export function exerciseById(id: string): Exercise | undefined {
  return EXERCISES.find((e) => e.id === id);
}

/** The level-0 warm-up prompt. */
export function sustainedExercise(): Exercise {
  const found = EXERCISES.find((e) => e.position === 'isolation');
  if (!found) throw new Error('content is missing the sustained /s/ exercise');
  return found;
}

/** How the prompt is introduced, so the user knows what to do with it. */
export function promptLabel(exercise: Exercise): string {
  switch (exercise.position) {
    case 'isolation':
      return 'Hold the sound';
    case 'phrase':
      return exercise.minimalPair ? 'Say the word — not its pair' : 'Say the phrase';
    case 'sentence':
      return 'Read the sentence';
    case 'passage':
      return 'Read the passage';
    case 'free':
      return 'Speak for 60 seconds';
    default:
      return 'Say the word';
  }
}
