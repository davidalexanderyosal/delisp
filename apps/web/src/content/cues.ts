import type { LispPattern } from '../lib/db';

export interface Cue {
  title: string;
  body: string;
}

/**
 * Cue library, spec §3.5. The diagnostic module that picks a pattern arrives in
 * Phase 2; until then `lispPattern` is 'unknown' and the shared cues are shown.
 */
export const CUES: Record<LispPattern | 'both', Cue[]> = {
  frontal: [
    {
      title: 'Tongue behind the teeth',
      body: 'Teeth lightly together, lips slightly apart, tongue tip behind the teeth — not between them.',
    },
    {
      title: 'Exploding T',
      body: 'Hold “t…”, then release it into a long “sss”. The tongue is already in the right place for /t/.',
    },
    {
      title: 'Tip down',
      body: 'Often easier with an overbite: tuck the tip behind the lower front teeth and raise the blade toward the ridge, air over the centre.',
    },
    { title: 'Smile slightly', body: 'Spreading the lips sharpens the /s/.' },
  ],
  lateral: [
    {
      title: 'Butterfly position',
      body: 'Press the sides of the tongue up against the upper back teeth — the “wings” — leaving a narrow groove down the middle.',
    },
    {
      title: 'Straw target',
      body: 'Aim the airstream through a straw held at the centre of your lips. Feel it on your finger.',
    },
    { title: 'Shape from a long T', body: '“tttt…”, then let the air leak through the groove.' },
    { title: 'Start from “ee”', body: 'The tongue sides are already high — slide from “ee” into /s/.' },
  ],
  mixed: [
    {
      title: 'Placement first',
      body: 'Tongue tip behind the teeth, sides pressed against the upper back teeth, a narrow groove down the centre.',
    },
    {
      title: 'Exploding T',
      body: 'Hold “t…”, then release it into a long “sss”.',
    },
  ],
  unknown: [
    {
      title: 'Placement',
      body: 'Teeth lightly together, tongue tip behind the teeth (never between them), sides of the tongue against the upper back teeth, air down a narrow groove in the centre.',
    },
    {
      title: 'Exploding T',
      body: 'Hold “t…”, then release it into a long “sss”. The tongue starts where /s/ needs it.',
    },
  ],
  both: [
    { title: 'Normal volume', body: 'A louder /s/ is not a clearer one. Keep the volume conversational.' },
    { title: 'Rate yourself first', body: 'Decide how it felt before you look at the gauge.' },
  ],
};

export function cuesFor(pattern: LispPattern): Cue[] {
  return [...CUES[pattern], ...CUES.both];
}
