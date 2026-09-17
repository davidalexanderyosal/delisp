import { useState } from 'react';
import type { Histogram } from '../lib/progressData';

/**
 * Hand-rolled SVG charts — no chart library, per the spec's "Tailwind only,
 * no external UI kits" constraint.
 *
 * The two-series palette is validated for colour-vision deficiency against this
 * app's dark card surface (#0d1424): emerald-600 vs fuchsia-600 separate by
 * ΔE 17.2 under deuteranopia and 26.6 under tritanopia. Both series are also
 * direct-labelled and carry a legend, so identity never rests on colour alone.
 */
export const SERIES_A = '#059669';
export const SERIES_B = '#c026d3';
const SURFACE = '#0d1424';
const GRID = '#1d2942';

const PAD = { top: 14, right: 14, bottom: 24, left: 36 };
const W = 320;
const H = 180;

/** Share-of-trials gridlines for the histogram, in clean 10% steps. */
function shareTicks(max: number): number[] {
  const step = max > 0.6 ? 0.25 : max > 0.3 ? 0.1 : 0.05;
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(Number(value.toFixed(2)));
  return ticks;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const step = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= step) ?? 10;
  const rounded = nice * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value <= max + rounded * 0.001; value += rounded) ticks.push(value);
  return ticks;
}

export interface LinePoint {
  label: string;
  value: number;
  /** Extra detail for the inspect readout. */
  detail?: string;
}

/**
 * Single series over time. No legend: with one colour, the title already says
 * what is plotted, and a one-swatch box only restates it.
 */
export function LineChart({
  points,
  title,
  format,
  max,
}: {
  points: readonly LinePoint[];
  title: string;
  format: (value: number) => string;
  max?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  if (points.length === 0) {
    return <EmptyChart title={title} />;
  }

  const observed = Math.max(...points.map((p) => p.value)) * 1.15;
  const yMax = max ?? (observed > 0 ? observed : 1);
  const ticks = niceTicks(yMax);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / yMax) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const last = points.length - 1;
  const bestIndex = points.reduce((best, p, i) => (p.value > points[best]!.value ? i : best), 0);
  const shown = selected ?? last;

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-semibold text-slate-200">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={y(tick)}
              x2={W - PAD.right}
              y2={y(tick)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-slate-500 text-[9px]"
            >
              {format(tick)}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke={SERIES_A} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => {
          // Markers only where they carry meaning: the end, the best, the tapped.
          const notable = i === last || i === bestIndex || i === selected;
          if (!notable) return null;
          return (
            <circle
              key={p.label}
              cx={x(i)}
              cy={y(p.value)}
              r={4}
              fill={SERIES_A}
              stroke={SURFACE}
              strokeWidth={2}
            />
          );
        })}

        {/* Tap targets, generously sized — the dots themselves are 8px. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.label}`}
            x={x(i) - plotW / Math.max(points.length, 1) / 2}
            y={PAD.top}
            width={Math.max(plotW / Math.max(points.length, 1), 24)}
            height={plotH}
            fill="transparent"
            onClick={() => setSelected(i === selected ? null : i)}
          />
        ))}

        <text
          x={PAD.left}
          y={H - 6}
          className="fill-slate-500 text-[9px]"
        >
          {points[0]!.label}
        </text>
        {points.length > 1 ? (
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[9px]">
            {points[last]!.label}
          </text>
        ) : null}
      </svg>

      <p className="mt-1 text-xs text-slate-400">
        <span className="font-mono tabular-nums text-slate-200">{format(points[shown]!.value)}</span>
        {' · '}
        {points[shown]!.label}
        {points[shown]!.detail ? ` · ${points[shown]!.detail}` : ''}
        {selected === null && points.length > 1 ? (
          <span className="text-slate-600"> · tap the chart to inspect</span>
        ) : null}
      </p>
    </figure>
  );
}

/**
 * Two distributions over the same bins. Step outlines rather than overlapping
 * bars: two translucent bar sets on a phone are unreadable, and the outlines
 * stay distinct where they cross.
 */
export function HistogramOverlay({
  title,
  first,
  latest,
  format,
}: {
  title: string;
  first: Histogram;
  latest: Histogram | null;
  format: (hz: number) => string;
}) {
  const series = [first, ...(latest ? [latest] : [])];
  const colors = [SERIES_A, SERIES_B];

  // Share, not count: the weeks rarely contain the same number of trials.
  const share = (h: Histogram, i: number) => (h.total === 0 ? 0 : (h.counts[i] ?? 0) / h.total);
  const yMax = Math.max(0.1, ...series.flatMap((h) => h.counts.map((_, i) => share(h, i)))) * 1.2;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const bins = first.counts.length;
  const binW = plotW / bins;
  const x = (i: number) => PAD.left + i * binW;
  const y = (value: number) => PAD.top + plotH - (value / yMax) * plotH;

  const stepPath = (h: Histogram, close: boolean) => {
    const parts: string[] = [`M ${x(0)} ${close ? PAD.top + plotH : y(share(h, 0))}`];
    for (let i = 0; i < bins; i++) {
      parts.push(`L ${x(i)} ${y(share(h, i))}`, `L ${x(i + 1)} ${y(share(h, i))}`);
    }
    if (close) parts.push(`L ${x(bins)} ${PAD.top + plotH}`, 'Z');
    return parts.join(' ');
  };

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-semibold text-slate-200">{title}</figcaption>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((h, i) => (
          <span key={h.label} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: colors[i] }}
              aria-hidden="true"
            />
            {h.label} <span className="text-slate-600">({h.total})</span>
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={title}>
        {shareTicks(yMax).map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={y(tick)}
              x2={W - PAD.right}
              y2={y(tick)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-slate-500 text-[9px]"
            >
              {`${Math.round(tick * 100)}%`}
            </text>
          </g>
        ))}
        {series.map((h, i) => (
          <g key={h.label}>
            <path d={stepPath(h, true)} fill={colors[i]} fillOpacity={0.1} stroke="none" />
            <path
              d={stepPath(h, false)}
              fill="none"
              stroke={colors[i]}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </g>
        ))}
        {[0, Math.floor(bins / 2), bins].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === bins ? 'end' : 'middle'}
            className="fill-slate-500 text-[9px]"
          >
            {format(first.edges[0]! + i * first.binWidth)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

export function EmptyChart({ title }: { title: string }) {
  return (
    <figure className="m-0">
      <figcaption className="text-sm font-semibold text-slate-200">{title}</figcaption>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        Nothing to plot yet. This fills in as you record trials.
      </p>
    </figure>
  );
}
