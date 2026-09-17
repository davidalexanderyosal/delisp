import { useEffect, useState } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Stat } from '../components/ui';
import { type TrialRow, allTrials, listSessions } from '../lib/db';
import {
  type SessionSummary,
  formatDate,
  formatHz,
  formatPercent,
  summariseSession,
} from '../lib/progress';

export function History() {
  const [summaries, setSummaries] = useState<SessionSummary[] | null>(null);
  const [trials, setTrials] = useState<TrialRow[]>([]);

  useEffect(() => {
    void (async () => {
      const [sessions, everyTrial] = await Promise.all([listSessions(), allTrials()]);
      const bySession = new Map<string, TrialRow[]>();
      for (const trial of everyTrial) {
        const list = bySession.get(trial.sessionId) ?? [];
        list.push(trial);
        bySession.set(trial.sessionId, list);
      }
      setTrials(everyTrial);
      setSummaries(
        sessions
          .map((session) => summariseSession(session, bySession.get(session.id) ?? []))
          .filter((s) => s.trials > 0),
      );
    })();
  }, []);

  const scored = trials.filter((t) => t.fricativeFrames > 0);
  const overallCentroid =
    scored.length === 0 ? null : scored.reduce((a, t) => a + t.centroid, 0) / scored.length;
  const overallPass =
    trials.length === 0 ? null : trials.filter((t) => t.passed === 1).length / trials.length;

  return (
    <ScreenShell title="History" back="/">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Trials" value={trials.length} />
        <Stat label="Mean" value={formatHz(overallCentroid)} hint="centroid" />
        <Stat label="Passed" value={formatPercent(overallPass)} />
      </div>

      {summaries === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : summaries.length === 0 ? (
        <Card>
          <p className="text-sm leading-relaxed text-slate-400">
            No sessions yet. Every trial you record is logged here with its mean centroid, so the
            week-over-week drift is visible even when a single session feels like nothing changed.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {summaries.map((summary) => (
            <li key={summary.session.id}>
              <Card>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-slate-200">
                    {formatDate(summary.session.startedAt)}
                  </p>
                  <p className="text-xs text-slate-500">Level {summary.session.level}</p>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Trials</dt>
                    <dd className="font-mono tabular-nums text-slate-200">{summary.trials}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Centroid</dt>
                    <dd className="font-mono tabular-nums text-slate-200">
                      {formatHz(summary.meanCentroid)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">In zone</dt>
                    <dd className="font-mono tabular-nums text-slate-200">
                      {formatPercent(summary.passRate)}
                    </dd>
                  </div>
                </dl>
                {summary.selfRatingAgreement !== null ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Self-rating matched the gauge {formatPercent(summary.selfRatingAgreement)} of the
                    time.
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </ScreenShell>
  );
}
