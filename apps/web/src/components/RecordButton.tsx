import { useEffect, useRef, useState } from 'react';
import { DRILL } from '../lib/config';

/**
 * Hold to record. One thumb, no aiming: press anywhere on the button, speak,
 * release. Auto-stops at `DRILL.maxRecordMs` so a stuck pointer cannot run the
 * capture forever, and ignores anything shorter than `minRecordMs`.
 */
export function RecordButton({
  disabled,
  onStart,
  onStop,
  label = 'Hold and say “ssss”',
}: {
  disabled?: boolean;
  onStart: () => void;
  onStop: (durationMs: number) => void;
  label?: string;
}) {
  const [held, setHeld] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  const finish = () => {
    if (!held) return;
    setHeld(false);
    const duration = performance.now() - startedAt.current;
    onStop(duration);
  };

  const begin = () => {
    if (disabled || held) return;
    startedAt.current = performance.now();
    setElapsed(0);
    setHeld(true);
    onStart();
  };

  useEffect(() => {
    if (!held) {
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = window.setInterval(() => {
      const ms = performance.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= DRILL.maxRecordMs) finish();
    }, 50);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
    // `finish` closes over `held`, which is the only dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  const seconds = (elapsed / 1000).toFixed(1);
  const progress = Math.min(1, elapsed / DRILL.maxRecordMs);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex h-40 w-full select-none touch-none items-center justify-center overflow-hidden rounded-3xl text-lg font-semibold transition-colors ${
        disabled
          ? 'bg-ink-700 text-slate-600'
          : held
            ? 'bg-rose-500 text-white'
            : 'bg-emerald-500 text-ink-900'
      }`}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {held ? (
        <span
          className="absolute inset-x-0 bottom-0 bg-white/20"
          style={{ height: `${(progress * 100).toFixed(1)}%` }}
        />
      ) : null}
      <span className="relative flex flex-col items-center gap-1">
        <span>{held ? 'Listening…' : label}</span>
        <span className="font-mono text-sm opacity-80 tabular-nums">
          {held ? `${seconds}s` : `up to ${(DRILL.maxRecordMs / 1000).toFixed(0)}s`}
        </span>
      </span>
    </button>
  );
}
