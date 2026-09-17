import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_GATE_CONFIG,
  type UtteranceFeatures,
  type ZoneScore,
  aggregateUtterance,
  scoreUtterance,
} from '@delisp/dsp';
import { Gauge } from '../components/Gauge';
import { RecordButton } from '../components/RecordButton';
import { ScreenShell } from '../components/ScreenShell';
import { Banner, Button, Card } from '../components/ui';
import { cuesFor } from '../content/cues';
import type { MicController } from '../lib/audio/useMicFeatures';
import { DRILL, HOP_SIZE, MIN_SAMPLE_RATE } from '../lib/config';
import {
  type SelfRating,
  type Settings,
  type TrialRow,
  addTrial,
  createSession,
  endSession,
  newId,
  recentTrials,
  targetZone,
} from '../lib/db';
import { feedbackFor } from '../lib/feedback';
import { formatPercent, rollingAccuracy } from '../lib/progress';
import { navigate } from '../lib/router';

const LEVEL = 0;
const EXERCISE_ID = 'l0-sustained-s';

type Phase = 'arming' | 'ready' | 'rate' | 'result';

interface Attempt {
  score: ZoneScore;
  utterance: UtteranceFeatures | null;
  durationMs: number;
}

export function Drill({ mic, settings }: { mic: MicController; settings: Settings }) {
  const [phase, setPhase] = useState<Phase>('arming');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [rating, setRating] = useState<SelfRating | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [history, setHistory] = useState<TrialRow[]>([]);
  const sessionId = useRef<string | null>(null);

  const zone = useMemo(() => targetZone(settings), [settings]);
  const gate = useMemo(
    () => ({
      ...DEFAULT_GATE_CONFIG,
      noiseFloor: settings.noiseFloor ?? DEFAULT_GATE_CONFIG.noiseFloor,
    }),
    [settings.noiseFloor],
  );
  const sampleRate = mic.state.sampleRate ?? settings.sampleRate ?? 48000;
  const hopMs = (HOP_SIZE / sampleRate) * 1000;

  useEffect(() => {
    void recentTrials(LEVEL, DRILL.windowSize).then(setHistory);
  }, []);

  // One session row per visit to this screen (spec §4).
  useEffect(() => {
    if (mic.state.status !== 'running' || sessionId.current) return;
    void createSession(LEVEL).then((row) => {
      sessionId.current = row.id;
      setPhase((p) => (p === 'arming' ? 'ready' : p));
    });
  }, [mic.state.status]);

  useEffect(
    () => () => {
      if (sessionId.current) void endSession(sessionId.current);
    },
    [],
  );

  const rolling = rollingAccuracy(history);

  const onStop = useCallback(
    (durationMs: number) => {
      const frames = mic.endCapture();
      if (durationMs < DRILL.minRecordMs) {
        setNote('Too short — hold the button while you make the sound.');
        return;
      }
      const utterance = aggregateUtterance(frames, { hopMs, gate });
      const score = scoreUtterance(frames, zone, gate);
      setNote(null);
      setAttempt({ score, utterance, durationMs });
      setRating(null);
      setPhase('rate');
    },
    [mic, hopMs, gate, zone],
  );

  const commit = useCallback(
    async (selfRating: SelfRating) => {
      if (!attempt || !sessionId.current) return;
      setRating(selfRating);
      const passed =
        attempt.score.score >= DRILL.passScore &&
        attempt.score.fricativeFrames >= DRILL.minFricativeFrames;
      const row: TrialRow = {
        id: newId('trl'),
        sessionId: sessionId.current,
        exerciseId: EXERCISE_ID,
        level: LEVEL,
        createdAt: new Date().toISOString(),
        centroid: attempt.utterance?.medianCentroid ?? 0,
        bandRatio: attempt.utterance?.meanBandRatio ?? 0,
        spread: attempt.utterance?.meanSpread ?? 0,
        sDurationMs: attempt.utterance?.sDurationMs ?? 0,
        fricativeFrames: attempt.score.fricativeFrames,
        acousticScore: attempt.score.score,
        selfRating,
        score: attempt.score.score,
        passed: passed ? 1 : 0,
        feedbackShown: 1,
        deviceLabel: mic.state.deviceLabel,
        synced: 0,
      };
      await addTrial(row);
      setHistory((prev) => [...prev, row].slice(-DRILL.windowSize));
      setPhase('result');
    },
    [attempt, mic.state.deviceLabel],
  );

  const feedback = attempt
    ? feedbackFor(attempt.score, attempt.utterance, zone, rolling.accuracy)
    : null;

  const staticValue =
    attempt?.utterance && attempt.score.fricativeFrames >= DRILL.minFricativeFrames
      ? {
          centroid: attempt.utterance.medianCentroid,
          bandRatio: attempt.utterance.meanBandRatio,
          inZone: attempt.score.score >= DRILL.passScore,
        }
      : null;

  const cues = cuesFor(settings.lispPattern);

  if (mic.state.status !== 'running' && phase === 'arming') {
    return (
      <ScreenShell title="Level 0 · Sustained /s/" back="/">
        {mic.state.error ? <Banner tone="error">{mic.state.error}</Banner> : null}
        <Card>
          <h2 className="text-base font-semibold text-slate-100">Enable the microphone</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            One tap. iOS does not reliably keep the permission for an installed PWA, so this screen
            asks at the start of every session instead of failing silently mid-drill.
          </p>
        </Card>
        <Button onClick={() => void mic.start()} disabled={mic.state.status === 'starting'}>
          {mic.state.status === 'starting' ? 'Starting…' : 'Enable microphone'}
        </Button>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Level 0 · Sustained /s/" back="/">
      {mic.state.status === 'paused' ? (
        <Banner tone="warn">
          Paused — the app went to the background.
          <button className="ml-2 underline" type="button" onClick={() => void mic.start()}>
            Resume
          </button>
        </Banner>
      ) : null}
      {mic.state.lowSampleRate ? (
        <Banner tone="warn">
          Capturing at {Math.round(sampleRate / 1000)} kHz, below the {MIN_SAMPLE_RATE / 1000} kHz
          this needs. The centroid will read low.
        </Banner>
      ) : null}

      <Card className="py-3">
        <Gauge
          zone={zone}
          {...(phase === 'ready'
            ? { latest: mic.latest, gate }
            : { value: staticValue, blind: phase === 'rate' })}
        />
      </Card>

      <div className="flex items-center justify-between text-xs text-slate-500">
        {rolling.total === 0 ? (
          <span>No trials yet — the first {rolling.windowSize} set the baseline.</span>
        ) : (
          <>
            <span>
              Last {rolling.total}/{rolling.windowSize}: {formatPercent(rolling.accuracy)} in zone
            </span>
            <span>
              {rolling.passed}/{rolling.total} passed
            </span>
          </>
        )}
      </div>

      {rolling.readyToAdvance ? (
        <Banner tone="info">
          Level 0 criterion met — {formatPercent(rolling.accuracy)} over the last{' '}
          {rolling.windowSize}. Syllables and words arrive with Phase 2; keep this going as a warm-up
          until then.
        </Banner>
      ) : null}

      {note ? <Banner tone="warn">{note}</Banner> : null}

      {phase === 'ready' ? (
        <>
          <RecordButton
            onStart={mic.beginCapture}
            onStop={onStop}
            disabled={mic.state.status !== 'running'}
          />
          <details className="rounded-2xl bg-ink-800 px-4 py-3">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-300">
              Cues
            </summary>
            <ul className="mt-3 space-y-3">
              {cues.map((cue) => (
                <li key={cue.title}>
                  <p className="text-sm font-semibold text-slate-200">{cue.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{cue.body}</p>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}

      {phase === 'rate' ? (
        <Card>
          <h2 className="text-base font-semibold text-slate-100">How did that one feel?</h2>
          <p className="mt-1 text-sm text-slate-400">
            Your call first — the score stays hidden until you have committed to one.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Button variant="secondary" onClick={() => void commit('good')}>
              Good
            </Button>
            <Button variant="secondary" onClick={() => void commit('unsure')}>
              Not sure
            </Button>
            <Button variant="secondary" onClick={() => void commit('off')}>
              Off
            </Button>
          </div>
        </Card>
      ) : null}

      {phase === 'result' && feedback ? (
        <>
          <Card>
            <p
              className={`text-2xl font-semibold tracking-tight ${
                feedback.tone === 'good'
                  ? 'text-zone-good'
                  : feedback.tone === 'near'
                    ? 'text-zone-near'
                    : 'text-zone-off'
              }`}
            >
              {feedback.result}
            </p>
            {feedback.coaching ? (
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{feedback.coaching}</p>
            ) : null}
            {rating && feedback.tone !== 'none' ? (
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {(rating === 'good') === (attempt!.score.score >= DRILL.passScore)
                  ? 'Your rating agreed with the gauge.'
                  : rating === 'good'
                    ? 'You rated that good; the gauge did not. Trust the gauge for now — that gap is the point of rating first.'
                    : 'You rated that off; the gauge liked it. Your ear may be stricter than it needs to be.'}
              </p>
            ) : null}
          </Card>
          <Button
            onClick={() => {
              setAttempt(null);
              setRating(null);
              setPhase('ready');
            }}
          >
            Next
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            End session
          </Button>
        </>
      ) : null}
    </ScreenShell>
  );
}
