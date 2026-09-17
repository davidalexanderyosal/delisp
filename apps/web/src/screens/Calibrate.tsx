import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GATE_CONFIG,
  DEFAULT_TARGET_ZONE,
  aggregateUtterance,
  median,
  percentile,
} from '@delisp/dsp';
import { Banner, Button, Card, Stat } from '../components/ui';
import { ScreenShell } from '../components/ScreenShell';
import type { MicController } from '../lib/audio/useMicFeatures';
import type { TimedFrame } from '../lib/audio/worklet-protocol';
import { CALIBRATION, DEFAULT_TOLERANCE, HOP_SIZE, MIN_SAMPLE_RATE } from '../lib/config';
import {
  type CalibrationRep,
  type Settings,
  addCalibration,
  defaultZoneCentre,
  newId,
  saveSettings,
} from '../lib/db';
import { formatHz } from '../lib/progress';
import { navigate } from '../lib/router';

type Step = 'intro' | 'silence' | 'sustain' | 'done';

export function Calibrate({
  mic,
  settings,
  onSaved,
}: {
  mic: MicController;
  settings: Settings;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);
  const [reps, setReps] = useState<CalibrationRep[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    if (step === 'intro' && mic.state.status === 'running') setStep('silence');
  }, [step, mic.state.status]);

  const sampleRate = mic.state.sampleRate ?? 48000;
  const hopMs = (HOP_SIZE / sampleRate) * 1000;

  const capture = useCallback(
    async (ms: number): Promise<TimedFrame[]> => {
      setBusy(true);
      setNote(null);
      mic.beginCapture();
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const left = ms - (performance.now() - started);
          setRemaining(Math.max(0, left));
          if (left <= 0) resolve();
          else window.setTimeout(tick, 80);
        };
        tick();
      });
      const frames = mic.endCapture();
      setBusy(false);
      setRemaining(0);
      return frames;
    },
    [mic],
  );

  const doSilence = async () => {
    const frames = await capture(CALIBRATION.silenceMs);
    if (cancelled.current) return;
    if (frames.length === 0) {
      setNote('No audio arrived. Check that the microphone is not muted, then try again.');
      return;
    }
    const measured = percentile(
      frames.map((f) => f.rms),
      CALIBRATION.noiseFloorPercentile,
    );
    if (measured > CALIBRATION.maxNoiseFloor) {
      setNote(
        `This room is too loud to measure against (${measured.toFixed(3)} rms). Move somewhere quieter, or use wired earphones, and record the silence again.`,
      );
      return;
    }
    setNoiseFloor(Math.max(CALIBRATION.minNoiseFloor, measured));
    setStep('sustain');
  };

  const doSustain = async () => {
    const frames = await capture(CALIBRATION.sustainMs);
    if (cancelled.current) return;
    const gate = { ...DEFAULT_GATE_CONFIG, noiseFloor: noiseFloor ?? DEFAULT_GATE_CONFIG.noiseFloor };
    const utterance = aggregateUtterance(frames, { hopMs, gate });
    if (!utterance || utterance.sDurationMs < 500) {
      setNote('That did not register as an /s/. Keep the sound going for the whole three seconds.');
      return;
    }
    const rep: CalibrationRep = {
      medianCentroid: utterance.medianCentroid,
      medianBandRatio: utterance.medianBandRatio,
      meanSpread: utterance.meanSpread,
      sDurationMs: utterance.sDurationMs,
    };
    const next = [...reps, rep];
    setReps(next);
    if (next.length >= CALIBRATION.reps) await save(next);
  };

  const save = async (finished: CalibrationRep[]) => {
    const floor = noiseFloor ?? DEFAULT_GATE_CONFIG.noiseFloor;
    await addCalibration({
      id: newId('cal'),
      createdAt: new Date().toISOString(),
      noiseFloor: floor,
      medianCentroid: median(finished.map((r) => r.medianCentroid)),
      medianBandRatio: median(finished.map((r) => r.medianBandRatio)),
      reps: finished,
      sampleRate,
      deviceLabel: mic.state.deviceLabel,
    });
    await saveSettings({
      noiseFloor: floor,
      // The target is the spec's reference zone, NOT the user's own baseline —
      // calibrating the target to a lisped /s/ would train the error in.
      targetCentroid: settings.targetCentroid ?? defaultZoneCentre(),
      targetRatio: settings.targetRatio ?? DEFAULT_TARGET_ZONE.minBandRatio,
      tolerance: settings.tolerance || DEFAULT_TOLERANCE,
      sampleRate,
      deviceLabel: mic.state.deviceLabel,
      calibratedAt: new Date().toISOString(),
    });
    await onSaved();
    setStep('done');
  };

  const baseline = reps.length > 0 ? median(reps.map((r) => r.medianCentroid)) : null;

  return (
    <ScreenShell title="Calibration" back="/">
      {mic.state.error ? <Banner tone="error">{mic.state.error}</Banner> : null}
      {mic.state.status === 'paused' ? (
        <Banner tone="warn">
          Paused because the app went to the background.
          <button className="ml-2 underline" type="button" onClick={() => void mic.start()}>
            Resume
          </button>
        </Banner>
      ) : null}
      {mic.state.lowSampleRate ? (
        <Banner tone="warn">
          This device is capturing at {Math.round(sampleRate / 1000)} kHz. Below{' '}
          {MIN_SAMPLE_RATE / 1000} kHz there is nothing above {Math.round(sampleRate / 2000)} kHz to
          measure, so the centroid will read low. Try wired earphones or another browser.
        </Banner>
      ) : null}

      {step === 'intro' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">Three steps, about 15 seconds</h2>
            <ol className="mt-3 space-y-2 text-sm leading-relaxed text-slate-400">
              <li>1. One second of silence — sets the noise floor for this room and this device.</li>
              <li>2. Three sustained “ssss” sounds, three seconds each — records where you start.</li>
              <li>3. The target zone comes from the reference values in the spec, not from your
                baseline: the point is to move toward a clear /s/, not to aim at the current one.</li>
            </ol>
          </Card>
          <Banner tone="info">
            Microphone permission is not always kept by an installed PWA on iOS, so it is asked for
            at the start of every session rather than failing silently mid-drill.
          </Banner>
          <Button onClick={() => void mic.start()} disabled={mic.state.status === 'starting'}>
            {mic.state.status === 'starting' ? 'Starting…' : 'Enable microphone'}
          </Button>
        </>
      ) : null}

      {step === 'silence' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">Stay quiet</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              One second of room tone. Do not speak, and hold the phone the way you will hold it
              during the drill.
            </p>
          </Card>
          {note ? <Banner tone="warn">{note}</Banner> : null}
          <Button onClick={() => void doSilence()} disabled={busy}>
            {busy ? `Listening… ${(remaining / 1000).toFixed(1)}s` : 'Record silence'}
          </Button>
        </>
      ) : null}

      {step === 'sustain' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">
              Sustained /s/ — {reps.length + 1} of {CALIBRATION.reps}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Say “ssss” at a normal speaking volume and keep it going for the full three seconds.
              Whatever your /s/ sounds like right now is exactly what this step wants.
            </p>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Noise floor" value={noiseFloor === null ? '—' : noiseFloor.toFixed(4)} hint="rms" />
            <Stat label="Baseline" value={formatHz(baseline)} hint={`${reps.length}/${CALIBRATION.reps} recorded`} />
          </div>
          {note ? <Banner tone="warn">{note}</Banner> : null}
          <Button onClick={() => void doSustain()} disabled={busy}>
            {busy ? `Listening… ${(remaining / 1000).toFixed(1)}s` : `Record “ssss” (${CALIBRATION.sustainMs / 1000}s)`}
          </Button>
        </>
      ) : null}

      {step === 'done' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">Calibrated</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Your starting point is {formatHz(baseline)}. The target zone is centred on{' '}
              {formatHz(settings.targetCentroid ?? defaultZoneCentre())}. The distance between those
              two numbers is the thing this app exists to close.
            </p>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Baseline" value={formatHz(baseline)} hint="your sustained /s/" />
            <Stat label="Target" value={formatHz(settings.targetCentroid ?? defaultZoneCentre())} hint="reference /s/" />
          </div>
          <Button onClick={() => navigate('/drill')}>Start drill</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Back to home
          </Button>
        </>
      ) : null}
    </ScreenShell>
  );
}
