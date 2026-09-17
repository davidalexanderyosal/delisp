import { useEffect, useState } from 'react';
import { zoneCentre } from '@delisp/dsp';
import { Banner, Button, Card, Stat } from '../components/ui';
import { ScreenShell } from '../components/ScreenShell';
import { type Settings, isCalibrated, recentTrials, targetZone } from '../lib/db';
import { formatHz, formatPercent, rollingAccuracy } from '../lib/progress';
import { navigate } from '../lib/router';
import { DRILL } from '../lib/config';

export function Home({ settings }: { settings: Settings }) {
  const [accuracy, setAccuracy] = useState<{ value: number; total: number } | null>(null);

  useEffect(() => {
    void recentTrials(0, DRILL.windowSize).then((trials) => {
      const rolling = rollingAccuracy(trials);
      setAccuracy({ value: rolling.accuracy, total: rolling.total });
    });
  }, []);

  const calibrated = isCalibrated(settings);
  const zone = targetZone(settings);

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
      <p className="text-sm leading-relaxed text-slate-400">
        Ten minutes, sustained /s/, with the gauge telling you what your ear cannot. Level 0 of the
        articulation hierarchy.
      </p>

      {!calibrated ? (
        <Banner tone="warn">
          Calibrate first. One second of silence sets the noise floor, then three sustained /s/
          sounds record where you are starting from.
        </Banner>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Target zone"
          value={`${(zone.centroidMin / 1000).toFixed(1)}–${(zone.centroidMax / 1000).toFixed(1)}k`}
          hint={`centre ${formatHz(zoneCentre(zone))}`}
        />
        <Stat
          label={`Last ${DRILL.windowSize}`}
          value={accuracy && accuracy.total > 0 ? formatPercent(accuracy.value) : '—'}
          hint={accuracy ? `${accuracy.total} trials logged` : 'no trials yet'}
        />
      </div>

      <div className="mt-2 flex flex-col gap-3">
        <Button onClick={() => navigate(calibrated ? '/drill' : '/calibrate')}>
          {calibrated ? 'Start drill' : 'Calibrate'}
        </Button>
        {calibrated ? (
          <Button variant="secondary" onClick={() => navigate('/calibrate')}>
            Re-calibrate
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => navigate('/history')}>
          History
        </Button>
      </div>

      <Card className="mt-auto">
        <p className="text-xs leading-relaxed text-slate-500">
          The gauge is a proxy, not a diagnosis. It measures where the energy of your /s/ sits, which
          tracks tongue placement closely enough to practise against — but one session with a
          speech-language pathologist will confirm placement.
        </p>
      </Card>
    </ScreenShell>
  );
}
