import { useEffect, useState } from 'react';
import { zoneCentre } from '@delisp/dsp';
import { Banner, Button, Card, Stat } from '../components/ui';
import { ScreenShell } from '../components/ScreenShell';
import { type Settings, allProgression, isCalibrated, targetZone } from '../lib/db';
import { patternLabel } from '../lib/diagnostic';
import { LEVELS, blockedReason, levelDef } from '../lib/levels';
import { useApiStatus } from '../lib/useApiStatus';
import { formatHz, formatPercent } from '../lib/progress';
import {
  type ProgressionRow,
  accuracyOf,
  activeLevel,
  dueRetestLevels,
} from '../lib/progression';
import { navigate } from '../lib/router';

export function Home({ settings }: { settings: Settings }) {
  const [rows, setRows] = useState<ProgressionRow[] | null>(null);
  const api = useApiStatus();

  useEffect(() => {
    void allProgression().then(setRows);
  }, []);

  const calibrated = isCalibrated(settings);
  const diagnosed = settings.diagnosedAt !== null;
  const zone = targetZone(settings);
  const level = rows ? activeLevel(rows) : 0;
  const current = rows?.find((r) => r.level === level) ?? null;
  const due = rows ? dueRetestLevels(rows, new Date().toISOString()) : [];

  return (
    <ScreenShell
      title="Pronunciation Trainer"
      action={
        <button
          type="button"
          onClick={() => navigate('/settings')}
          aria-label="Settings"
          className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 active:bg-ink-700"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h.1A1.7 1.7 0 0010 3.1V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
          </svg>
        </button>
      }
    >
      {!calibrated ? (
        <Banner tone="warn">
          Calibrate first. One second of silence sets the noise floor, then three sustained /s/
          sounds record where you are starting from.
        </Banner>
      ) : !diagnosed ? (
        <Banner tone="info">
          Two quick questions will pick your cue set — a frontal lisp and a lateral one need opposite
          advice.
        </Banner>
      ) : null}

      {due.length > 0 ? (
        <Banner tone="info">
          Re-test due for level{due.length > 1 ? 's' : ''} {due.join(', ')} — ten trials are already
          queued into your next session.
        </Banner>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Now drilling"
          value={`Level ${level}`}
          hint={levelDef(level).title}
        />
        <Stat
          label={`Last ${current?.accuracyWindow.length ?? 0}`}
          value={current && current.accuracyWindow.length > 0 ? formatPercent(accuracyOf(current)) : '—'}
          hint={`${Math.round(levelDef(level).advanceAt * 100)}% over ${levelDef(level).window} to advance`}
        />
        <Stat
          label="Target zone"
          value={`${(zone.centroidMin / 1000).toFixed(1)}–${(zone.centroidMax / 1000).toFixed(1)}k`}
          hint={`centre ${formatHz(zoneCentre(zone))}`}
        />
        <Stat label="Pattern" value={patternLabel(settings.lispPattern)} hint="cue set" />
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={() => navigate(calibrated ? '/drill' : '/calibrate')}>
          {calibrated ? 'Start session' : 'Calibrate'}
        </Button>
        {calibrated && !diagnosed ? (
          <Button variant="secondary" onClick={() => navigate('/diagnostic')}>
            Run the diagnostic
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => navigate('/progress')}>
          Progress
        </Button>
        {api.available ? (
          <Button variant="secondary" onClick={() => navigate('/baseline')}>
            Weekly baseline
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => navigate('/history')}>
          History
        </Button>
      </div>

      <Card>
        <p className="text-sm font-semibold text-slate-200">The hierarchy</p>
        <ul className="mt-3 flex flex-col gap-2">
          {LEVELS.map((def) => {
            const progress = rows?.find((r) => r.level === def.level);
            const status = progress?.status ?? 'locked';
            const blocked = blockedReason(def.level, api.available);
            return (
              <li key={def.level} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    status === 'passed'
                      ? 'bg-emerald-500 text-ink-900'
                      : status === 'active'
                        ? 'bg-slate-200 text-ink-900'
                        : 'bg-ink-600 text-slate-500'
                  }`}
                >
                  {def.level}
                </span>
                <span className={status === 'locked' ? 'text-slate-600' : 'text-slate-300'}>
                  {def.title}
                </span>
                {blocked ? (
                  <span className="ml-auto shrink-0 text-xs text-slate-600">needs server</span>
                ) : status === 'passed' ? (
                  <span className="ml-auto shrink-0 text-xs text-emerald-500">passed</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <p className="text-xs leading-relaxed text-slate-500">
          The gauge is a proxy, not a diagnosis. It measures where the energy of your /s/ sits, which
          tracks tongue placement closely enough to practise against — but one session with a
          speech-language pathologist will confirm placement.
        </p>
      </Card>
    </ScreenShell>
  );
}
