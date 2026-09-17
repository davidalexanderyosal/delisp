import { type MutableRefObject, useEffect, useRef } from 'react';
import { type GateConfig, type TargetZone, isFricativeFrame, isInZone } from '@delisp/dsp';
import { GAUGE_RANGE, RATIO_RANGE } from '../lib/config';
import type { TimedFrame } from '../lib/audio/worklet-protocol';

const CX = 150;
const CY = 152;
const R = 116;
const SWEEP_START = 180;
const SWEEP_END = 0;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Maps a centroid in Hz onto the dial, 180° (low) to 0° (high). */
function angleFor(hz: number): number {
  const [lo, hi] = GAUGE_RANGE;
  const t = clamp((hz - lo) / (hi - lo), 0, 1);
  return SWEEP_START + t * (SWEEP_END - SWEEP_START);
}

function point(deg: number, radius = R): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

function arcPath(fromDeg: number, toDeg: number, radius = R): string {
  const a = point(fromDeg, radius);
  const b = point(toDeg, radius);
  const largeArc = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export interface GaugeValue {
  centroid: number;
  bandRatio: number;
  inZone: boolean;
}

interface GaugeProps {
  zone: TargetZone;
  /** Live source: read under requestAnimationFrame so nothing re-renders per frame. */
  latest?: MutableRefObject<TimedFrame | null>;
  gate?: GateConfig;
  /** Static source, for reviewing a finished trial. */
  value?: GaugeValue | null;
  /** Feedback fading (spec §3.8): hide the needle but keep the dial on screen. */
  blind?: boolean;
}

export function Gauge({ zone, latest, gate, value, blind = false }: GaugeProps) {
  const needleRef = useRef<SVGGElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const ratioRef = useRef<HTMLDivElement | null>(null);

  const zoneStart = angleFor(zone.centroidMin);
  const zoneEnd = angleFor(zone.centroidMax);

  useEffect(() => {
    const needle = needleRef.current;
    const readout = readoutRef.current;
    const ratio = ratioRef.current;
    if (!needle || !readout || !ratio) return;

    const apply = (v: GaugeValue | null) => {
      if (blind || !v) {
        needle.style.opacity = '0';
        readout.textContent = blind ? '••••' : '—';
        readout.dataset.tone = 'idle';
        ratio.style.width = '0%';
        return;
      }
      needle.style.opacity = '1';
      needle.style.transform = `rotate(${(SWEEP_START - angleFor(v.centroid)).toFixed(2)}deg)`;
      needle.dataset.tone = v.inZone ? 'good' : 'off';
      readout.textContent = `${(v.centroid / 1000).toFixed(2)} kHz`;
      readout.dataset.tone = v.inZone ? 'good' : 'off';
      const [rlo, rhi] = RATIO_RANGE;
      ratio.style.width = `${(clamp((v.bandRatio - rlo) / (rhi - rlo), 0, 1) * 100).toFixed(1)}%`;
      ratio.dataset.tone = v.bandRatio >= zone.minBandRatio ? 'good' : 'off';
    };

    if (!latest) {
      apply(value ?? null);
      return;
    }

    let raf = 0;
    const tick = () => {
      const frame = latest.current;
      if (!frame || (gate && !isFricativeFrame(frame, gate))) {
        apply(null);
      } else {
        apply({ centroid: frame.centroid, bandRatio: frame.bandRatio, inZone: isInZone(frame, zone) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [latest, gate, zone, value, blind, zoneStart, zoneEnd]);

  const ticks = [2, 4, 6, 8, 10];

  return (
    <div className="w-full">
      <svg viewBox="-16 0 332 178" className="w-full" role="img" aria-label="Spectral centroid gauge">
        <path d={arcPath(SWEEP_START, SWEEP_END)} className="stroke-ink-600" strokeWidth={18} fill="none" strokeLinecap="round" />
        <path d={arcPath(zoneStart, zoneEnd)} className="stroke-zone-good/70" strokeWidth={18} fill="none" strokeLinecap="butt" />
        {ticks.map((khz) => {
          const deg = angleFor(khz * 1000);
          const outer = point(deg, R + 13);
          const inner = point(deg, R + 4);
          const label = point(deg, R + 24);
          return (
            <g key={khz}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="stroke-ink-500" strokeWidth={2} />
              <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" className="fill-slate-500 text-[11px]">
                {khz}k
              </text>
            </g>
          );
        })}
        <g
          ref={needleRef}
          className="origin-[150px_152px] transition-[transform] duration-75 ease-out data-[tone=good]:text-zone-good data-[tone=off]:text-zone-off"
          style={{ opacity: 0 }}
        >
          <line x1={CX} y1={CY} x2={CX - R * 0.82} y2={CY} stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
        </g>
        <circle cx={CX} cy={CY} r={7} className="fill-ink-500" />
      </svg>

      <div className="mt-1 text-center">
        <span
          ref={readoutRef}
          data-tone="idle"
          className="font-mono text-3xl tabular-nums data-[tone=good]:text-zone-good data-[tone=off]:text-slate-200 data-[tone=idle]:text-slate-600"
        >
          —
        </span>
        <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">spectral centroid</p>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs text-slate-500">
          <span className="uppercase tracking-wide">band ratio 5–8k / 1–4k</span>
        </div>
        <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-ink-600">
          <div
            ref={ratioRef}
            data-tone="off"
            className="h-full rounded-full transition-[width] duration-75 data-[tone=good]:bg-zone-good data-[tone=off]:bg-slate-500"
            style={{ width: '0%' }}
          />
          <div
            className="absolute inset-y-0 w-px bg-slate-300/70"
            style={{
              left: `${(((zone.minBandRatio - RATIO_RANGE[0]) / (RATIO_RANGE[1] - RATIO_RANGE[0])) * 100).toFixed(1)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
