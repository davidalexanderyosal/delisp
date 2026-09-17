import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RecordButton } from '../components/RecordButton';
import { ScreenShell } from '../components/ScreenShell';
import { Banner, Button, Card, Stat } from '../components/ui';
import { httpClient } from '../lib/api';
import type { MicController } from '../lib/audio/useMicFeatures';
import { DRILL } from '../lib/config';
import { type ContrastSet, contrastSets, fallbackContrastSets } from '../lib/confusions';
import { allTrials, newId } from '../lib/db';
import { formatPercent } from '../lib/progress';
import { navigate } from '../lib/router';
import { useApiStatus } from '../lib/useApiStatus';

/**
 * HVPT-style contrast drilling (spec §3.9), aimed at the pairs this speaker
 * actually fails rather than a generic list.
 *
 * The listening half of high-variability training — the same contrast from
 * several different voices — needs model audio, which is a TTS asset job that
 * has not run yet. What is here is the production half: say the target, and the
 * transcript decides which word came out. That is the half that carries the
 * feedback, and it works today.
 */

type Phase = 'choosing' | 'ready' | 'scoring' | 'result';

interface Attempt {
  heard: string;
  correct: boolean;
}

export function Contrasts({ mic }: { mic: MicController }) {
  const api = useApiStatus();
  const [sets, setSets] = useState<ContrastSet[] | null>(null);
  const [fromHistory, setFromHistory] = useState(false);
  const [active, setActive] = useState<ContrastSet | null>(null);
  const [phase, setPhase] = useState<Phase>('choosing');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [history, setHistory] = useState<boolean[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const client = useMemo(() => httpClient(), []);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void allTrials().then((trials) => {
      if (cancelled.current) return;
      const learned = contrastSets(trials);
      setFromHistory(learned.length > 0);
      setSets(learned.length > 0 ? learned : fallbackContrastSets());
    });
    return () => {
      cancelled.current = true;
    };
  }, []);

  const start = async (set: ContrastSet) => {
    setActive(set);
    setHistory([]);
    setAttempt(null);
    setNote(null);
    if (mic.state.status !== 'running') await mic.start();
    setPhase('ready');
  };

  const onStop = useCallback(
    async (durationMs: number) => {
      mic.endCapture();
      if (!active) return;
      if (durationMs < DRILL.minRecordMs) {
        void mic.takeRecording();
        setNote('Too short — hold the button while you say the word.');
        return;
      }
      setNote(null);
      setPhase('scoring');

      const blob = await mic.takeRecording();
      if (!blob) {
        setNote('Nothing was recorded. This browser may not support recording audio.');
        setPhase('ready');
        return;
      }
      try {
        const key = await client.postRecording('trial', newId('rec'), blob, durationMs);
        const result = await client.scoreAsr({
          key,
          target: active.target,
          minimalPair: active.contrast,
        });
        setAttempt({ heard: result.text, correct: result.match });
        setHistory((prev) => [...prev, result.match]);
        setPhase('result');
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'Could not score that one.');
        setPhase('ready');
      }
    },
    [mic, active, client],
  );

  if (api.checked && !api.available) {
    return (
      <ScreenShell title="Contrasts" back="/">
        <Banner tone="warn">
          Contrast drilling is judged on which word was heard, so it needs the server. The gauge
          levels work offline.
        </Banner>
        <Button variant="secondary" onClick={api.recheck}>
          Try again
        </Button>
      </ScreenShell>
    );
  }

  if (phase === 'choosing' || !active) {
    return (
      <ScreenShell title="Contrasts" back="/">
        <Card>
          <h2 className="text-base font-semibold text-slate-100">
            {fromHistory ? 'The pairs you actually confuse' : 'Minimal pairs to start with'}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {fromHistory
              ? 'Built from what the transcripts heard instead of what was asked for, most frequent first. Drilling the contrast you personally fail is the point of this exercise.'
              : 'Nothing has been misheard yet, so these are the curriculum’s own pairs. Once you have drilled levels 5 and up, this list becomes yours.'}
          </p>
        </Card>

        {sets === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : sets.length === 0 ? (
          <Card>
            <p className="text-sm leading-relaxed text-slate-400">No pairs to drill.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {sets.map((set) => (
              <li key={set.id}>
                <button
                  type="button"
                  onClick={() => void start(set)}
                  className="flex w-full items-center justify-between rounded-2xl bg-ink-800 px-4 py-4 text-left active:bg-ink-700"
                >
                  <span>
                    <span className="text-lg font-semibold tracking-tight text-slate-100">
                      {set.target}
                    </span>
                    <span className="text-lg text-slate-600"> vs </span>
                    <span className="text-lg text-slate-400">{set.contrast}</span>
                  </span>
                  {set.count > 0 ? (
                    <span className="shrink-0 text-xs text-slate-500">
                      missed {set.count}×
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScreenShell>
    );
  }

  const correct = history.filter(Boolean).length;

  return (
    <ScreenShell title={`${active.target} vs ${active.contrast}`} back="/">
      {note ? <Banner tone="warn">{note}</Banner> : null}

      <Card className="text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500">Say</p>
        <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-50">{active.target}</p>
        <p className="mt-3 text-sm text-slate-500">
          not <span className="font-semibold text-slate-400">{active.contrast}</span>
        </p>
      </Card>

      {history.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Heard right" value={`${correct}/${history.length}`} />
          <Stat label="Rate" value={formatPercent(correct / history.length)} />
        </div>
      ) : null}

      {phase === 'ready' ? (
        <>
          <RecordButton
            onStart={() => mic.beginCapture(true)}
            onStop={(ms) => void onStop(ms)}
            disabled={mic.state.status !== 'running'}
            label="Hold and say it"
          />
          <p className="text-center text-xs text-slate-500">
            Say the word once, at a normal volume. The transcript decides which one came out.
          </p>
        </>
      ) : null}

      {phase === 'scoring' ? (
        <Card>
          <p className="text-sm text-slate-400">Checking what was heard…</p>
        </Card>
      ) : null}

      {phase === 'result' && attempt ? (
        <>
          <Card>
            <p
              className={`text-2xl font-semibold tracking-tight ${
                attempt.correct ? 'text-zone-good' : 'text-zone-off'
              }`}
            >
              {attempt.correct ? `Heard “${active.target}”` : `Heard “${attempt.heard || '—'}”`}
            </p>
            {!attempt.correct ? (
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                That came out closer to “{active.contrast}”. The two differ only in where the tongue
                is — hold the placement and try the same word again.
              </p>
            ) : null}
          </Card>
          <Button
            onClick={() => {
              setAttempt(null);
              setPhase('ready');
            }}
          >
            Again
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setActive(null);
              setPhase('choosing');
            }}
          >
            Pick another pair
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Done
          </Button>
        </>
      ) : null}
    </ScreenShell>
  );
}
