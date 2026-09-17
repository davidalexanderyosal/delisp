/**
 * Schematic illustrations for the two self-report questions (spec §3.4). Drawn
 * inline rather than shipped as assets: they are diagrams, not artwork, and
 * they have to stay legible on a dark background at phone size.
 */

/** Side view of the mouth: is the tongue tip between the teeth? */
export function MirrorIllustration({ protruding }: { protruding: boolean }) {
  return (
    <svg viewBox="0 0 160 110" className="w-full" role="img" aria-hidden="true">
      <path
        d="M14 92 C 14 46, 44 20, 86 20 C 120 20, 144 34, 152 52"
        className="stroke-ink-500"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <rect x={96} y={44} width={12} height={18} rx={3} className="fill-slate-300" />
      <rect x={96} y={70} width={12} height={18} rx={3} className="fill-slate-300" />
      {protruding ? (
        <path d="M40 70 C 66 66, 92 64, 122 66 C 110 74, 84 78, 44 78 Z" className="fill-rose-400" />
      ) : (
        <path d="M38 72 C 62 62, 82 58, 94 58 C 92 70, 74 80, 42 80 Z" className="fill-emerald-400" />
      )}
      <text x={124} y={100} className="fill-slate-500 text-[10px]" textAnchor="middle">
        {protruding ? 'tip visible' : 'tip behind'}
      </text>
    </svg>
  );
}

/** Front view of the lips: where is the airstream leaving? */
export function StrawIllustration({ corners }: { corners: boolean }) {
  return (
    <svg viewBox="0 0 160 110" className="w-full" role="img" aria-hidden="true">
      <ellipse cx={80} cy={58} rx={52} ry={26} className="fill-none stroke-ink-500" strokeWidth={3} />
      <path d="M28 58 C 52 44, 108 44, 132 58" className="stroke-ink-500" strokeWidth={3} fill="none" />
      {corners ? (
        <>
          <path d="M34 58 L 8 40" className="stroke-rose-400" strokeWidth={4} strokeLinecap="round" />
          <path d="M126 58 L 152 40" className="stroke-rose-400" strokeWidth={4} strokeLinecap="round" />
        </>
      ) : (
        <path d="M80 54 L 80 16" className="stroke-emerald-400" strokeWidth={4} strokeLinecap="round" />
      )}
      <text x={80} y={100} className="fill-slate-500 text-[10px]" textAnchor="middle">
        {corners ? 'air at the corners' : 'air down the centre'}
      </text>
    </svg>
  );
}
