import { useEffect, useState } from 'react';
import type { AcousticPattern } from '@delisp/dsp';
import { MirrorIllustration, StrawIllustration } from '../components/Illustrations';
import { ScreenShell } from '../components/ScreenShell';
import { Banner, Button, Card } from '../components/ui';
import { cuesFor } from '../content/cues';
import {
  DIAGNOSTIC_DISCLAIMER,
  type DiagnosticResult,
  classifyPattern,
  patternLabel,
} from '../lib/diagnostic';
import {
  type Settings,
  addDiagnostic,
  isCalibrated,
  latestCalibration,
  newId,
  saveSettings,
} from '../lib/db';
import { navigate } from '../lib/router';

type Step = 'intro' | 'mirror' | 'straw' | 'result';

export function Diagnostic({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [acoustic, setAcoustic] = useState<AcousticPattern>('unknown');
  const [tongueVisible, setTongueVisible] = useState<boolean | null>(null);
  const [airAtCorners, setAirAtCorners] = useState<boolean | null>(null);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  useEffect(() => {
    void latestCalibration().then((row) => {
      if (row?.acousticPattern) setAcoustic(row.acousticPattern);
    });
  }, []);

  const finish = async (corners: boolean) => {
    setAirAtCorners(corners);
    const outcome = classifyPattern({
      acoustic,
      selfReport: { tongueVisible, airAtCorners: corners },
    });
    setResult(outcome);
    await addDiagnostic({
      id: newId('dia'),
      createdAt: new Date().toISOString(),
      acoustic,
      tongueVisible,
      airAtCorners: corners,
      pattern: outcome.pattern,
      signalCount: outcome.signalCount,
    });
    await saveSettings({ lispPattern: outcome.pattern, diagnosedAt: new Date().toISOString() });
    await onSaved();
    setStep('result');
  };

  if (!isCalibrated(settings)) {
    return (
      <ScreenShell title="Diagnostic" back="/">
        <Banner tone="warn">
          Calibrate first — the acoustic half of this needs your sustained /s/.
        </Banner>
        <Button onClick={() => navigate('/calibrate')}>Go to calibration</Button>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Diagnostic" back="/">
      {step === 'intro' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">Which pattern is it?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Two questions, about thirty seconds. The answer decides which cues you get during
              drills — a frontal lisp and a lateral one need opposite advice, so guessing wrong makes
              practice harder rather than easier.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Your sustained /s/ from calibration reads as{' '}
              <span className="font-semibold text-slate-200">{acousticLabel(acoustic)}</span>. That
              is one of the signals; your answers are the other.
            </p>
          </Card>
          <Banner tone="info">{DIAGNOSTIC_DISCLAIMER}</Banner>
          <Button onClick={() => setStep('mirror')}>Start</Button>
        </>
      ) : null}

      {step === 'mirror' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">The mirror test</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Say a long “ssss” in front of a mirror. Is the tip of your tongue visible between your
              teeth?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-ink-700 p-2">
                <MirrorIllustration protruding={false} />
              </div>
              <div className="rounded-xl bg-ink-700 p-2">
                <MirrorIllustration protruding />
              </div>
            </div>
          </Card>
          <Button
            onClick={() => {
              setTongueVisible(true);
              setStep('straw');
            }}
          >
            Yes, I can see the tip
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setTongueVisible(false);
              setStep('straw');
            }}
          >
            No, it stays behind my teeth
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setTongueVisible(null);
              setStep('straw');
            }}
          >
            Cannot tell
          </Button>
        </>
      ) : null}

      {step === 'straw' ? (
        <>
          <Card>
            <h2 className="text-base font-semibold text-slate-100">The straw test</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Hold a straw — or just a finger — at the centre of your lips and say “ssss”. Where is
              the air coming out?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-ink-700 p-2">
                <StrawIllustration corners={false} />
              </div>
              <div className="rounded-xl bg-ink-700 p-2">
                <StrawIllustration corners />
              </div>
            </div>
          </Card>
          <Button variant="secondary" onClick={() => void finish(false)}>
            Mostly through the centre
          </Button>
          <Button onClick={() => void finish(true)}>Mostly at the corners</Button>
        </>
      ) : null}

      {step === 'result' && result ? (
        <>
          <Card>
            <p className="text-xs uppercase tracking-wide text-slate-500">Tentative pattern</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">
              {patternLabel(result.pattern)}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {result.signalCount === 0
                ? 'Nothing pointed either way, so the shared cues stay in place.'
                : `${result.signalCount} of 3 signals had an opinion · confidence ${result.confidence}. The third, a minimal-pair reading test, arrives with Phase 3.`}
            </p>
          </Card>
          <Banner tone="info">{DIAGNOSTIC_DISCLAIMER}</Banner>
          <Card>
            <p className="text-sm font-semibold text-slate-200">Your cues from now on</p>
            <ul className="mt-3 space-y-3">
              {cuesFor(result.pattern).map((cue) => (
                <li key={cue.title}>
                  <p className="text-sm font-semibold text-slate-200">{cue.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{cue.body}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Button onClick={() => navigate('/drill')}>Start drilling</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Back to home
          </Button>
        </>
      ) : null}
    </ScreenShell>
  );
}

function acousticLabel(pattern: AcousticPattern): string {
  switch (pattern) {
    case 'clear':
      return 'a clear /s/';
    case 'frontal':
      return 'low and narrow — frontal';
    case 'lateral':
      return 'broad with no clear peak — lateral';
    case 'postalveolar':
      return 'drifted toward /ʃ/';
    default:
      return 'inconclusive';
  }
}
