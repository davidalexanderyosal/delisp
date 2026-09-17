import { type Exercise, promptLabel } from '../lib/exercises';

/** The thing the user has to say. Sized by how much text there is. */
export function Prompt({ exercise, kind }: { exercise: Exercise; kind: 'warmup' | 'main' | 'retest' }) {
  const long = exercise.text.length > 60;
  const veryLong = exercise.text.length > 220;

  return (
    <div className="rounded-2xl bg-ink-800 px-4 py-5 text-center">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        {kind === 'warmup' ? 'Warm-up' : kind === 'retest' ? 'Re-test' : promptLabel(exercise)}
        {exercise.sound === 'z' ? ' · voiced /z/' : ''}
      </p>
      <p
        className={`mt-2 font-semibold tracking-tight text-slate-50 ${
          veryLong ? 'text-base leading-relaxed' : long ? 'text-xl leading-snug' : 'text-4xl'
        }`}
      >
        {exercise.text}
      </p>
      {exercise.minimalPair ? (
        <p className="mt-3 text-sm text-slate-500">
          not <span className="font-semibold text-slate-400">{exercise.minimalPair}</span>
        </p>
      ) : null}
    </div>
  );
}
