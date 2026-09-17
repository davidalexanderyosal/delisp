const W = 320;
const H = 48;

/**
 * A clip's envelope, drawn symmetrically about the centre line. Bars rather than
 * a filled outline: at phone width the gaps are what make two clips comparable
 * at a glance.
 */
export function Waveform({
  peaks,
  color,
  label,
  durationMs,
}: {
  peaks: readonly number[];
  color: string;
  label: string;
  durationMs?: number | null;
}) {
  const bars = peaks.length;
  const slot = bars > 0 ? W / bars : W;
  const width = Math.max(1.5, slot - 2);

  return (
    <figure className="m-0">
      <figcaption className="flex items-baseline justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          {label}
        </span>
        {durationMs ? (
          <span className="font-mono tabular-nums">{(durationMs / 1000).toFixed(1)}s</span>
        ) : null}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${label} waveform`}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#1d2942" strokeWidth={1} />
        {peaks.map((peak, i) => {
          const height = Math.max(1.5, peak * (H - 6));
          return (
            <rect
              key={i}
              x={i * slot + (slot - width) / 2}
              y={(H - height) / 2}
              width={width}
              height={height}
              rx={Math.min(1.5, width / 2)}
              fill={color}
            />
          );
        })}
      </svg>
    </figure>
  );
}
