import { useCallback, useEffect, useState } from 'react';
import { HistogramOverlay, LineChart, type LinePoint } from '../components/charts';
import { ScreenShell } from '../components/ScreenShell';
import { Banner, Button, Card, Stat } from '../components/ui';
import { httpClient } from '../lib/api';
import { type SessionRow, type TrialRow, allTrials, listSessions } from '../lib/db';
import { formatHz, formatHzCompact, formatPercent } from '../lib/progress';
import {
  type LevelSummary,
  type RatingCalibration,
  type WeeklyCentroids,
  levelSummaries,
  ratingCalibration,
  sessionSeries,
  weeklyCentroids,
} from '../lib/progressData';
import { levelDef } from '../lib/levels';
import { type SyncResult, describeSync, syncNow } from '../lib/sync';
import { idbSyncStore } from '../lib/syncStore';

interface Data {
  sessions: SessionRow[];
  trials: TrialRow[];
  points: LinePoint[];
  weekly: WeeklyCentroids;
  rating: RatingCalibration;
  levels: LevelSummary[];
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function Progress() {
  const [data, setData] = useState<Data | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const load = useCallback(async () => {
    const [sessions, trials] = await Promise.all([listSessions(), allTrials()]);
    const series = sessionSeries(sessions, trials);
    setData({
      sessions,
      trials,
      points: series.map((point) => ({
        label: shortDate(point.startedAt),
        value: point.accuracy * 100,
        detail: `level ${point.level} · ${point.trials} trials · ${formatHz(point.meanCentroid)}`,
      })),
      weekly: weeklyCentroids(trials),
      rating: ratingCalibration(trials),
      levels: levelSummaries(trials),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      setSyncResult(await syncNow(idbSyncStore(), httpClient()));
    } finally {
      setSyncing(false);
      await load();
    }
  };

  if (!data) {
    return (
      <ScreenShell title="Progress" back="/">
        <p className="text-sm text-slate-500">Loading…</p>
      </ScreenShell>
    );
  }

  const heard = data.trials.filter((t) => t.fricativeFrames > 0);
  const meanCentroid =
    heard.length === 0 ? null : heard.reduce((a, t) => a + t.centroid, 0) / heard.length;

  return (
    <ScreenShell title="Progress" back="/">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Trials" value={data.trials.length} />
        <Stat label="Sessions" value={data.sessions.length} />
        <Stat label="Mean" value={formatHzCompact(meanCentroid)} hint="centroid" />
      </div>

      <Card>
        <LineChart
          title="Accuracy by session"
          points={data.points}
          format={(value) => `${Math.round(value)}%`}
          max={100}
        />
      </Card>

      <Card>
        {data.weekly.first ? (
          <>
            <HistogramOverlay
              title="Sustained /s/, week over week"
              first={data.weekly.first}
              latest={data.weekly.latest}
              format={(hz) => `${(hz / 1000).toFixed(0)}k`}
            />
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {data.weekly.latest
                ? 'Each line is the share of that week’s sustained /s/ landing in each centroid band. Improvement looks like the whole shape moving right.'
                : 'One week of data so far. A second week adds the comparison line — that shift is what months of practice look like.'}
            </p>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-slate-500">
            No sustained /s/ trials recorded yet. The week-over-week comparison starts with your
            first drill.
          </p>
        )}
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-200">Self-rating calibration</p>
        {data.rating.agreement === null ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Nothing rated yet. Rating each trial before the score is revealed is what trains your
            ear to agree with the gauge.
          </p>
        ) : (
          <>
            <p className="mt-2 font-mono text-3xl tabular-nums text-slate-100">
              {formatPercent(data.rating.agreement)}
            </p>
            <p className="text-xs text-slate-500">
              agreement over {data.rating.rated} rated trials
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Rated good, was off</dt>
                <dd className="font-mono tabular-nums text-slate-200">{data.rating.overconfident}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Rated off, was good</dt>
                <dd className="font-mono tabular-nums text-slate-200">{data.rating.underconfident}</dd>
              </div>
            </dl>
          </>
        )}
      </Card>

      {data.levels.length > 0 ? (
        <Card>
          <p className="text-sm font-semibold text-slate-200">By level</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="font-normal">Level</th>
                <th className="font-normal text-right">Trials</th>
                <th className="font-normal text-right">In zone</th>
                <th className="font-normal text-right">Centroid</th>
              </tr>
            </thead>
            <tbody>
              {data.levels.map((summary) => (
                <tr key={summary.level} className="border-t border-ink-600">
                  <td className="py-1.5 text-slate-300">
                    {summary.level} · {levelDef(summary.level).title}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-300">
                    {summary.trials}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-300">
                    {formatPercent(summary.accuracy)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-300">
                    {formatHz(summary.meanCentroid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {syncResult ? (
        <Banner tone={syncResult.errors.length > 0 ? 'warn' : 'info'}>
          {describeSync(syncResult)}
          {syncResult.errors.length > 0 ? (
            <span className="mt-1 block text-xs opacity-80">{syncResult.errors[0]}</span>
          ) : null}
        </Banner>
      ) : null}

      <Button variant="secondary" onClick={() => void sync()} disabled={syncing}>
        {syncing ? 'Syncing…' : 'Sync to the server'}
      </Button>
      <p className="text-xs leading-relaxed text-slate-600">
        Everything here is computed from this device. Syncing copies sessions, trials and
        progression to D1 so nothing is lost if the browser storage is cleared — it needs the Phase
        3 backend deployed and will report an error until then.
      </p>
    </ScreenShell>
  );
}
