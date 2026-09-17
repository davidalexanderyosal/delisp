import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RecordButton } from '../components/RecordButton';
import { ScreenShell } from '../components/ScreenShell';
import { SERIES_A, SERIES_B } from '../components/charts';
import { Waveform } from '../components/Waveform';
import { Banner, Button, Card } from '../components/ui';
import { type ModelAudioRow, httpClient } from '../lib/api';
import type { MicController } from '../lib/audio/useMicFeatures';
import { DRILL } from '../lib/config';
import { newId } from '../lib/db';
import { navigate } from '../lib/router';
import { useApiStatus } from '../lib/useApiStatus';
import { type DecodedClip, clipPeaks, timingComment } from '../lib/waveform';

/**
 * Shadowing (spec §3.9): play a model clip, repeat it immediately, compare.
 *
 * "Immediately" is the active ingredient — the point is to copy a rhythm you
 * have just heard rather than read a sentence off the screen, so the record
 * button arms itself the moment the clip finishes.
 */

const BUCKETS = 64;

type Phase = 'idle' | 'playing' | 'ready' | 'scoring' | 'result';

interface Comparison {
  heard: string;
  match: boolean;
  mine: DecodedClip | null;
}

export function Shadow({ mic }: { mic: MicController }) {
  const api = useApiStatus();
  const client = useMemo(() => httpClient(), []);
  const [clips, setClips] = useState<ModelAudioRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [model, setModel] = useState<DecodedClip | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Only shown when the browser refused to start playback for us. */
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  const current = clips && clips.length > 0 ? clips[index % clips.length] : null;

  useEffect(() => {
    if (!api.available) return;
    void client
      .modelAudio()
      .then(setClips)
      .catch(() => setClips([]));
  }, [api.available, client]);

  // Decode the model clip once per prompt, for the waveform.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setModel(null);
    void (async () => {
      try {
        const response = await fetch(client.recordingUrl(current.modelAudioKey!), {
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const context = (contextRef.current ??= new AudioContext());
        const decoded = await clipPeaks(await response.arrayBuffer(), BUCKETS, context);
        if (!cancelled) setModel(decoded);
      } catch {
        // The clip still plays; only the picture is missing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, client]);

  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
    },
    [],
  );

  const play = async () => {
    if (!current) return;
    setComparison(null);
    setNote(null);
    setPhase('playing');
    if (mic.state.status !== 'running') await mic.start();
    const audio = audioRef.current;
    if (!audio) {
      setPhase('ready');
      return;
    }
    audio.currentTime = 0;
    try {
      await audio.play();
    } catch {
      // Autoplay refused: fall back to the browser's own control.
      setNeedsManualPlay(true);
      setPhase('ready');
    }
  };

  const onStop = useCallback(
    async (durationMs: number) => {
      mic.endCapture();
      if (!current) return;
      if (durationMs < DRILL.minRecordMs) {
        void mic.takeRecording();
        setNote('Too short — hold the button while you repeat the phrase.');
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

      const context = (contextRef.current ??= new AudioContext());
      const mine = await clipPeaks(await blob.arrayBuffer(), BUCKETS, context);

      try {
        const key = await client.postRecording('trial', newId('rec'), blob, durationMs);
        const result = await client.scoreAsr({ key, target: current.text });
        setComparison({ heard: result.text, match: result.match, mine });
        setPhase('result');
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'Could not score that one.');
        setPhase('ready');
      }
    },
    [mic, current, client],
  );

  if (api.checked && !api.available) {
    return (
      <ScreenShell title="Shadowing" back="/">
        <Banner tone="warn">
          Shadowing plays a model clip and compares transcripts, so it needs the server.
        </Banner>
        <Button variant="secondary" onClick={api.recheck}>
          Try again
        </Button>
      </ScreenShell>
    );
  }

  if (clips === null) {
    return (
      <ScreenShell title="Shadowing" back="/">
        <p className="text-sm text-slate-500">Loading…</p>
      </ScreenShell>
    );
  }

  if (clips.length === 0) {
    return (
      <ScreenShell title="Shadowing" back="/">
        <Card>
          <h2 className="text-base font-semibold text-slate-100">No model audio yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Shadowing needs a clip to copy. Generate the model voice once with{' '}
            <code className="text-slate-300">pnpm content:voices</code>, which walks the curriculum
            and synthesises each prompt into R2. It takes a few minutes and only has to run once.
          </p>
        </Card>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Shadowing" back="/">
      {note ? <Banner tone="warn">{note}</Banner> : null}

      <Card>
        <p className="text-xs uppercase tracking-wide text-slate-500">Listen, then repeat</p>
        <p className="mt-2 text-lg font-semibold leading-snug tracking-tight text-slate-50">
          {current?.text}
        </p>
        <audio
          ref={audioRef}
          src={current ? client.recordingUrl(current.modelAudioKey!) : undefined}
          preload="auto"
          onEnded={() => setPhase('ready')}
          controls={needsManualPlay}
          className={needsManualPlay ? 'mt-3 w-full' : 'hidden'}
        />
      </Card>

      {model ? (
        <Card>
          <Waveform peaks={model.peaks} color={SERIES_A} label="Model" durationMs={model.durationMs} />
          {comparison?.mine ? (
            <>
              <div className="mt-4">
                <Waveform
                  peaks={comparison.mine.peaks}
                  color={SERIES_B}
                  label="You"
                  durationMs={comparison.mine.durationMs}
                />
              </div>
              {timingComment(model.durationMs, comparison.mine.durationMs) ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  {timingComment(model.durationMs, comparison.mine.durationMs)}
                </p>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {phase === 'idle' || phase === 'playing' ? (
        <Button onClick={() => void play()} disabled={phase === 'playing'}>
          {phase === 'playing' ? 'Listening to the model…' : 'Play the model'}
        </Button>
      ) : null}

      {phase === 'ready' ? (
        <>
          <RecordButton
            onStart={() => mic.beginCapture(true)}
            onStop={(ms) => void onStop(ms)}
            disabled={mic.state.status !== 'running'}
            label="Hold and repeat it"
          />
          <p className="text-center text-xs text-slate-500">
            Copy the rhythm, not just the words. Repeating straight after hearing it is the point.
          </p>
        </>
      ) : null}

      {phase === 'scoring' ? (
        <Card>
          <p className="text-sm text-slate-400">Checking what was heard…</p>
        </Card>
      ) : null}

      {phase === 'result' && comparison ? (
        <>
          <Card>
            <p
              className={`text-xl font-semibold tracking-tight ${
                comparison.match ? 'text-zone-good' : 'text-zone-off'
              }`}
            >
              {comparison.match ? 'Matched the model' : 'Not quite the same words'}
            </p>
            {!comparison.match ? (
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Heard “{comparison.heard || '—'}”. Play it once more and copy the timing before you
                worry about the sounds.
              </p>
            ) : null}
          </Card>
          <Button onClick={() => void play()}>Again</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setIndex((i) => i + 1);
              setComparison(null);
              setPhase('idle');
            }}
          >
            Next phrase
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            Done
          </Button>
        </>
      ) : null}
    </ScreenShell>
  );
}
