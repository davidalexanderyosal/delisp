import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_GATE_CONFIG,
  DEFAULT_VOICING_CONFIG,
  type UtteranceFeatures,
  type ZoneScore,
  aggregateUtterance,
  scoreUtterance,
  voicingRate,
} from '@delisp/dsp';
import { Gauge } from '../components/Gauge';
import { Prompt } from '../components/Prompt';
import { RecordButton } from '../components/RecordButton';
import { ScreenShell } from '../components/ScreenShell';
import { SelfRating } from '../components/SelfRating';
import { Banner, Button, Card } from '../components/ui';
import { cuesFor } from '../content/cues';
import type { MicController } from '../lib/audio/useMicFeatures';
import { DRILL, HOP_SIZE, MIN_SAMPLE_RATE } from '../lib/config';
import {
  type SelfRating as Rating,
  type Settings,
  type TrialRow,
  addTrial,
  allProgression,
  createSession,
  endSession,
  newId,
  recentTrials,
  saveProgression,
  saveSettings,
  targetZone,
  unlockNext,
} from '../lib/db';
import { httpClient } from '../lib/api';
import { type Exercise, exercisesForLevel, sustainedExercise } from '../lib/exercises';
import { shouldStoreAudio } from '../lib/recording';
import { useApiStatus } from '../lib/useApiStatus';
import { type FeedbackPlan, feedbackPlanFor, showScoreOnTrial, summariseBlock } from '../lib/fading';
import { type TrialOutcome, feedbackFor, trialPassed } from '../lib/feedback';
import { blockedReason, levelDef } from '../lib/levels';
import { formatPercent } from '../lib/progress';
import {
  type PlannedTrial,
  type ProgressionRow,
  type SessionPlan,
  RETEST_PASS,
  accuracyOf,
  activeLevel,
  dueRetestLevels,
  failRetest,
  markPassed,
  passRetest,
  planSession,
  progressionTarget,
  readyToAdvance,
  recordOutcome,
} from '../lib/progression';
import { navigate } from '../lib/router';

/** "2nd", "3rd" — the fading schedule reads badly as a bare number. */
function ordinal(n: number): string {
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

type Phase = 'arming' | 'loading' | 'ready' | 'rate' | 'result';

interface Attempt extends TrialOutcome {
  durationMs: number;
}

interface RemoteScore {
  asrMatch: boolean | null;
  asrText: string | null;
  key: string | null;
}

const NO_REMOTE: RemoteScore = { asrMatch: null, asrText: null, key: null };

export function Drill({ mic, settings }: { mic: MicController; settings: Settings }) {
  const [phase, setPhase] = useState<Phase>('arming');
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [cursor, setCursor] = useState(0);
  const [rows, setRows] = useState<ProgressionRow[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [rating, setRating] = useState<Rating | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<number | null>(null);
  const [blockOutcomes, setBlockOutcomes] = useState<boolean[]>([]);
  const [showScore, setShowScore] = useState(true);
  /**
   * The schedule in force when this trial was judged. Committing a trial changes
   * the rolling accuracy, and therefore the schedule — reading the live plan on
   * the result screen would describe a rule that was not the one applied.
   */
  const [appliedPlan, setAppliedPlan] = useState<FeedbackPlan | null>(null);
  const [checking, setChecking] = useState(false);
  const sessionId = useRef<string | null>(null);
  const retestOutcomes = useRef(new Map<number, boolean[]>());
  const pendingScore = useRef<Promise<RemoteScore> | null>(null);
  const storedThisSession = useRef(0);
  const api = useApiStatus();

  const zone = useMemo(() => targetZone(settings), [settings]);
  const gate = useMemo(
    () => ({
      ...DEFAULT_GATE_CONFIG,
      noiseFloor: settings.noiseFloor ?? DEFAULT_GATE_CONFIG.noiseFloor,
    }),
    [settings.noiseFloor],
  );
  const voicingCfg = useMemo(() => ({ ...gate, ...DEFAULT_VOICING_CONFIG }), [gate]);
  const sampleRate = mic.state.sampleRate ?? settings.sampleRate ?? 48000;
  const hopMs = (HOP_SIZE / sampleRate) * 1000;

  const level = plan?.level ?? 0;
  const def = levelDef(level);
  const row = rows.find((r) => r.level === level);
  const accuracy = row ? accuracyOf(row) : 0;
  const feedback: FeedbackPlan = feedbackPlanFor(accuracy);

  const current: PlannedTrial | null = plan?.trials[cursor] ?? null;

  // Build the session once the mic is live (spec §3.6: warm-up, re-tests, main).
  useEffect(() => {
    if (mic.state.status !== 'running' || sessionId.current) return;
    let cancelled = false;
    void (async () => {
      setPhase('loading');
      const progression = await allProgression();
      const target = activeLevel(progression);
      const trialsAtLevel = (await recentTrials(target, 1000)).length;
      const retests = dueRetestLevels(progression, new Date().toISOString()).filter(
        (l) => l !== target,
      );
      const built = planSession({
        level: target,
        trialsAtLevel,
        pool: exercisesForLevel(target),
        warmup: sustainedExercise(),
        retestLevels: retests,
        retestPool: (l) => exercisesForLevel(l),
      });
      const session = await createSession(target);
      if (cancelled) return;
      sessionId.current = session.id;
      setRows(progression);
      setPlan(built);
      setCursor(0);
      setPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [mic.state.status]);

  useEffect(
    () => () => {
      if (sessionId.current) void endSession(sessionId.current);
    },
    [],
  );

  /**
   * Uploads the clip and, on a level that needs it, asks the Worker what was
   * heard. Runs in the background while the user self-rates, so the round trip
   * costs nothing — and fails soft: no clip, no network, or a rejected upload
   * all return "not scored" rather than failing the trial.
   */
  const uploadAndScore = useCallback(
    async (exercise: Exercise, durationMs: number, wantsAsr: boolean): Promise<RemoteScore> => {
      const blob = await mic.takeRecording();
      if (!blob || !api.available) return NO_REMOTE;
      try {
        const client = httpClient();
        const key = await client.postRecording('trial', newId('rec'), blob, durationMs);
        storedThisSession.current += 1;
        if (!wantsAsr) return { ...NO_REMOTE, key };
        const result = await client.scoreAsr({
          key,
          target: exercise.text,
          minimalPair: exercise.minimalPair ?? null,
        });
        return { asrMatch: result.match, asrText: result.text, key };
      } catch {
        return NO_REMOTE;
      }
    },
    [mic, api.available],
  );

  const onStop = useCallback(
    (durationMs: number) => {
      const frames = mic.endCapture();
      if (durationMs < DRILL.minRecordMs) {
        void mic.takeRecording();
        setNote('Too short — hold the button while you make the sound.');
        return;
      }
      const exercise = current?.exercise;
      const scoring = exercise ? levelDef(exercise.level).scoring : 'acoustic';
      const utterance = aggregateUtterance(frames, { hopMs, gate });
      const score = scoreUtterance(frames, zone, gate);
      setNote(null);
      setAttempt({
        score,
        utterance,
        voicing: voicingRate(frames, voicingCfg),
        expectVoiced: exercise?.sound === 'z',
        scoring,
        asrMatch: null,
        asrText: null,
        durationMs,
      });
      if (exercise) {
        pendingScore.current = uploadAndScore(exercise, durationMs, scoring !== 'acoustic');
      }
      setRating(null);
      setPhase('rate');
    },
    [mic, hopMs, gate, zone, voicingCfg, current, uploadAndScore],
  );

  /** Applies the spec §3.7 rule once a re-test block for a level is complete. */
  const settleRetest = useCallback(
    async (retestLevel: number, outcomes: boolean[]) => {
      const planned = plan?.trials.filter(
        (t) => t.kind === 'retest' && t.exercise.level === retestLevel,
      ).length;
      if (!planned || outcomes.length < planned) return;
      const scored = outcomes.filter(Boolean).length / outcomes.length;
      const target = rows.find((r) => r.level === retestLevel);
      if (!target) return;
      const now = new Date().toISOString();
      const updated = scored < RETEST_PASS ? failRetest(target, now) : passRetest(target, now);
      await saveProgression(updated);
      setRows((prev) => prev.map((r) => (r.level === retestLevel ? updated : r)));
      setNote(
        scored < RETEST_PASS
          ? `Level ${retestLevel} re-test came in at ${formatPercent(scored)} — it will come round again tomorrow.`
          : `Level ${retestLevel} re-test passed at ${formatPercent(scored)}.`,
      );
    },
    [plan, rows],
  );

  const commit = useCallback(
    async (selfRating: Rating) => {
      if (!attempt || !sessionId.current || !current || !row) return;
      setRating(selfRating);

      // The upload and transcription overlapped with the rating; collect it now.
      setChecking(pendingScore.current !== null);
      const remote = pendingScore.current ? await pendingScore.current : NO_REMOTE;
      pendingScore.current = null;
      setChecking(false);

      const finished: Attempt = { ...attempt, asrMatch: remote.asrMatch, asrText: remote.asrText };
      setAttempt(finished);

      const passed = trialPassed(finished);
      const trialLevel = current.exercise.level;

      const trial: TrialRow = {
        id: newId('trl'),
        sessionId: sessionId.current,
        exerciseId: current.exercise.id,
        level: trialLevel,
        createdAt: new Date().toISOString(),
        centroid: finished.utterance?.medianCentroid ?? 0,
        bandRatio: finished.utterance?.meanBandRatio ?? 0,
        spread: finished.utterance?.meanSpread ?? 0,
        sDurationMs: finished.utterance?.sDurationMs ?? 0,
        fricativeFrames: finished.score.fricativeFrames,
        acousticScore: finished.score.score,
        selfRating,
        score: finished.score.score,
        passed: passed ? 1 : 0,
        feedbackShown: showScoreOnTrial(feedback, cursor) ? 1 : 0,
        deviceLabel: mic.state.deviceLabel,
        synced: 0,
        practice: plan?.practice,
        kind: current.kind,
        voicing: finished.voicing,
        asrText: remote.asrText,
        asrMatch: remote.asrMatch === null ? null : remote.asrMatch ? 1 : 0,
        recordingKey: remote.key,
      };
      await addTrial(trial);

      const target = progressionTarget(current.kind, trialLevel, level);
      if (target?.mode === 'retest') {
        const seen = [...(retestOutcomes.current.get(target.level) ?? []), passed];
        retestOutcomes.current.set(target.level, seen);
        await settleRetest(target.level, seen);
      } else if (target?.mode === 'window') {
        const updated = recordOutcome(row, passed, def);
        await saveProgression(updated);
        setRows((prev) => prev.map((r) => (r.level === level ? updated : r)));

        if (readyToAdvance(updated, def) && updated.status !== 'passed') {
          const now = new Date().toISOString();
          const done = markPassed(updated, now);
          await saveProgression(done);
          await unlockNext(level);
          setRows((prev) => prev.map((r) => (r.level === level ? done : r)));
          setAdvanced(level);
        }
      }

      setBlockOutcomes((prev) => [...prev, passed]);
      setShowScore(showScoreOnTrial(feedback, cursor));
      setAppliedPlan(feedback);
      setPhase('result');
    },
    [
      attempt,
      current,
      row,
      def,
      level,
      cursor,
      feedback,
      plan,
      settleRetest,
      mic.state.deviceLabel,
    ],
  );

  // Keep the stored feedback rate in step with the schedule, for Phase 3 sync.
  useEffect(() => {
    if (settings.feedbackRate !== feedback.feedbackRate) {
      void saveSettings({ feedbackRate: feedback.feedbackRate });
    }
  }, [feedback.feedbackRate, settings.feedbackRate]);

  const next = () => {
    setAttempt(null);
    setRating(null);
    if (showScore) setBlockOutcomes([]);
    setCursor((c) => {
      const total = plan?.trials.length ?? 0;
      return total === 0 ? 0 : (c + 1) % total;
    });
    setPhase('ready');
  };

  const outcome = attempt
    ? feedbackFor(attempt, zone, feedback.kind, current?.exercise)
    : null;

  const staticValue =
    attempt?.utterance && attempt.score.fricativeFrames >= DRILL.minFricativeFrames
      ? {
          centroid: attempt.utterance.medianCentroid,
          bandRatio: attempt.utterance.meanBandRatio,
          inZone: trialPassed(attempt),
        }
      : null;

  if (mic.state.status !== 'running' && (phase === 'arming' || phase === 'loading')) {
    return (
      <ScreenShell title="Drill" back="/">
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

  if (!plan || !current) {
    return (
      <ScreenShell title="Drill" back="/">
        <p className="text-sm text-slate-500">Building the session…</p>
      </ScreenShell>
    );
  }

  const locked = blockedReason(level, api.available);
  if (locked) {
    return (
      <ScreenShell title={`Level ${level} · ${def.title}`} back="/">
        <Banner tone="info">{locked}</Banner>
        <Card>
          <p className="text-sm leading-relaxed text-slate-400">
            Levels 0–2 are scored by the gauge alone, right here on the phone. Levels 3–5 add a
            check on which word was actually heard, and fall back to the gauge when the server is
            out of reach. From level 6 the transcript is the whole score, so there is nothing to
            fall back to.
          </p>
        </Card>
        <Button onClick={() => navigate('/')}>Back to home</Button>
      </ScreenShell>
    );
  }

  const cues = cuesFor(settings.lispPattern);
  const block = summariseBlock(blockOutcomes);
  const trialScoring = levelDef(current.exercise.level).scoring;
  // Keep the clip when the level is judged on it, or when the sampling policy
  // in spec §4 wants this one for the record.
  const recordThisTrial =
    api.available &&
    (trialScoring !== 'acoustic' ||
      shouldStoreAudio({
        trialIndex: cursor,
        passed: true,
        storedThisSession: storedThisSession.current,
      }));

  return (
    <ScreenShell title={`Level ${level} · ${def.title}`} back="/">
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
      {advanced !== null ? (
        <Banner tone="info">
          Level {advanced} passed at {formatPercent(accuracy)} over {def.window} trials. Level{' '}
          {advanced + 1} is unlocked — it starts at your next session.
        </Banner>
      ) : null}

      <Prompt exercise={current.exercise} kind={current.kind} />

      {phase === 'ready' && feedback.liveGauge ? (
        <Card className="py-3">
          <Gauge zone={zone} latest={mic.latest} gate={gate} />
        </Card>
      ) : null}
      {phase !== 'ready' ? (
        <Card className="py-3">
          <Gauge zone={zone} value={staticValue} blind={phase === 'rate' || !showScore} />
        </Card>
      ) : null}

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {row && row.accuracyWindow.length > 0
            ? `Level ${level}: ${formatPercent(accuracy)} over ${row.accuracyWindow.length}/${def.window}`
            : `No scored trials yet at level ${level}`}
        </span>
        <span>
          {plan.practice} · trial {cursor + 1}
        </span>
      </div>

      {note ? <Banner tone="warn">{note}</Banner> : null}

      {phase === 'ready' ? (
        <>
          {!feedback.liveGauge ? (
            <p className="text-xs leading-relaxed text-slate-500">
              The gauge is hidden while you record — at {formatPercent(accuracy)} you are reliable
              enough that watching it would become a crutch. It comes back on the result.
            </p>
          ) : null}
          <RecordButton
            onStart={() => mic.beginCapture(recordThisTrial)}
            onStop={onStop}
            disabled={mic.state.status !== 'running'}
            label={current.exercise.position === 'isolation' ? 'Hold and say “ssss”' : 'Hold and say it'}
          />
          <p className="text-center text-xs text-slate-500">
            {levelDef(current.exercise.level).instruction}
          </p>
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
        checking ? (
          <Card>
            <p className="text-sm text-slate-400">Checking what was heard…</p>
          </Card>
        ) : (
          <SelfRating onRate={(r) => void commit(r)} />
        )
      ) : null}

      {phase === 'result' && outcome ? (
        <>
          <Card>
            {showScore ? (
              <>
                <p
                  className={`text-2xl font-semibold tracking-tight ${
                    outcome.tone === 'good'
                      ? 'text-zone-good'
                      : outcome.tone === 'near'
                        ? 'text-zone-near'
                        : 'text-zone-off'
                  }`}
                >
                  {outcome.result}
                </p>
                {outcome.coaching ? (
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{outcome.coaching}</p>
                ) : null}
                {block.trials > 1 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Last {block.trials} trials: {block.passed} in zone ({formatPercent(block.accuracy)}).
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold tracking-tight text-slate-300">Recorded</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {appliedPlan && appliedPlan.scoreEvery > 1
                    ? `You are accurate enough that scores now come every ${ordinal(
                        appliedPlan.scoreEvery,
                      )} trial, with a summary after each block. Trust what the sound felt like.`
                    : 'Logged. Trust what the sound felt like.'}
                </p>
                {block.trials > 1 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Last {block.trials} trials: {block.passed} in zone (
                    {formatPercent(block.accuracy)}).
                  </p>
                ) : null}
              </>
            )}
            {rating && showScore && outcome.tone !== 'none' ? (
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {(rating === 'good') === trialPassed(attempt!)
                  ? 'Your rating agreed with the gauge.'
                  : rating === 'good'
                    ? 'You rated that good; the gauge did not. That gap is the point of rating first.'
                    : 'You rated that off; the gauge liked it. Your ear may be stricter than it needs to be.'}
              </p>
            ) : null}
          </Card>
          <Button onClick={next}>Next</Button>
          <Button variant="ghost" onClick={() => navigate('/')}>
            End session
          </Button>
        </>
      ) : null}
    </ScreenShell>
  );
}
