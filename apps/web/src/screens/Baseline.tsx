import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { Banner, Button, Card, Stat } from '../components/ui';
import type { MicController } from '../lib/audio/useMicFeatures';
import { type BaselineRow, httpClient } from '../lib/api';
import { newId } from '../lib/db';
import { exercisesForLevel } from '../lib/exercises';
import { formatDate } from '../lib/progress';
import { useApiStatus } from '../lib/useApiStatus';

/** Spec §3.10: sixty seconds of free speech, once a week, kept forever. */
const BASELINE_MS = 60000;

type Phase = 'idle' | 'recording' | 'uploading' | 'done';

export function Baseline({ mic }: { mic: MicController }) {
  const api = useApiStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [prompt, setPrompt] = useState(() => pickPrompt());
  const [elapsed, setElapsed] = useState(0);
  const [rows, setRows] = useState<BaselineRow[] | null>(null);
  const [result, setResult] = useState<{ transcript: string | null; wpm: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  const client = httpClient();

  const refresh = useCallback(async () => {
    try {
      setRows(await client.baselines());
    } catch {
      setRows([]);
    }
    // client is recreated per render but is stateless; refreshing on mount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (api.available) void refresh();
  }, [api.available, refresh]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );

  const stop = useCallback(async () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    const durationMs = performance.now() - startedAt.current;
    mic.endCapture();
    setPhase('uploading');
    setError(null);

    const blob = await mic.takeRecording();
    if (!blob) {
      setError('Nothing was recorded. This browser may not support recording audio.');
      setPhase('idle');
      return;
    }
    try {
      const response = await client.postBaseline(newId('base'), blob, durationMs);
      setResult({ transcript: response.transcript, wpm: response.wpm });
      setPhase('done');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setPhase('idle');
    }
  }, [mic, client, refresh]);

  const begin = async () => {
    if (mic.state.status !== 'running') await mic.start();
    setResult(null);
    setError(null);
    setElapsed(0);
    startedAt.current = performance.now();
    mic.beginCapture(true);
    setPhase('recording');
    timer.current = window.setInterval(() => {
      const ms = performance.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= BASELINE_MS) void stop();
    }, 200);
  };

  if (api.checked && !api.available) {
    return (
      <ScreenShell title="Weekly baseline" back="/">
        <Banner tone="warn">
          Baselines are stored on the server so they survive this browser, and it is not reachable
          right now. Nothing else in the app needs it — the drills work offline.
        </Banner>
        <Button variant="secondary" onClick={api.recheck}>
          Try again
        </Button>
      </ScreenShell>
    );
  }

  const remaining = Math.max(0, BASELINE_MS - elapsed);
  const previous = rows ?? [];

  return (
    <ScreenShell title="Weekly baseline" back="/">
      {error ? <Banner tone="error">{error}</Banner> : null}

      <Card>
        <p className="text-xs uppercase tracking-wide text-slate-500">Speak for a minute about</p>
        <p className="mt-2 text-xl font-semibold leading-snug tracking-tight text-slate-50">
          {prompt}
        </p>
        {phase === 'idle' ? (
          <button
            type="button"
            onClick={() => setPrompt(pickPrompt(prompt))}
            className="mt-3 text-sm text-slate-400 underline"
          >
            Different prompt
          </button>
        ) : null}
      </Card>

      <Card>
        <p className="text-sm leading-relaxed text-slate-400">
          This one is not scored and there is no gauge. Talk normally — the point is a recording of
          how you actually sound today, to put beside the one from six months from now.
        </p>
      </Card>

      {phase === 'recording' ? (
        <>
          <div className="rounded-3xl bg-rose-500/90 px-5 py-8 text-center">
            <p className="font-mono text-4xl tabular-nums text-white">
              {Math.ceil(remaining / 1000)}s
            </p>
            <p className="mt-1 text-sm text-white/80">recording</p>
          </div>
          <Button onClick={() => void stop()}>Stop and save</Button>
        </>
      ) : null}

      {phase === 'idle' ? <Button onClick={() => void begin()}>Start recording</Button> : null}
      {phase === 'uploading' ? (
        <Button disabled>Uploading and transcribing…</Button>
      ) : null}

      {phase === 'done' && result ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Rate"
              value={result.wpm === null ? '—' : Math.round(result.wpm)}
              hint="words per minute"
            />
            <Stat label="Saved" value="Yes" hint="kept forever" />
          </div>
          {result.transcript ? (
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-500">Transcript</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{result.transcript}</p>
            </Card>
          ) : (
            <Banner tone="warn">
              The recording is saved, but transcription did not come back. The audio is what matters
              here; the transcript can be regenerated.
            </Banner>
          )}
          <Button variant="secondary" onClick={() => setPhase('idle')}>
            Record another
          </Button>
        </>
      ) : null}

      {previous.length > 0 ? (
        <Card>
          <p className="text-sm font-semibold text-slate-200">Listen back</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Oldest against newest. This comparison is the only honest measure of months of practice.
          </p>
          <div className="mt-3 flex flex-col gap-4">
            {comparisonPair(previous).map(([label, row]) => (
              <div key={row.key}>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {label} · {formatDate(row.createdAt)}
                  {row.wpm ? ` · ${Math.round(row.wpm)} wpm` : ''}
                </p>
                <audio
                  controls
                  preload="none"
                  src={client.recordingUrl(row.key)}
                  className="mt-1 w-full"
                />
              </div>
            ))}
          </div>
          {previous.length > 2 ? (
            <p className="mt-3 text-xs text-slate-600">
              {previous.length} baselines recorded in total.
            </p>
          ) : null}
        </Card>
      ) : null}
    </ScreenShell>
  );
}

/** Oldest and newest, or just the one when only one exists. */
function comparisonPair(rows: readonly BaselineRow[]): [string, BaselineRow][] {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  if (!oldest || !newest) return [];
  if (oldest.key === newest.key) return [['First', oldest]];
  return [
    ['First', oldest],
    ['Latest', newest],
  ];
}

function pickPrompt(avoid?: string): string {
  const prompts = exercisesForLevel(8).map((exercise) => exercise.text);
  const options = prompts.filter((text) => text !== avoid);
  const pool = options.length > 0 ? options : prompts;
  return pool[Math.floor(Math.random() * pool.length)] ?? 'Describe your day so far.';
}
