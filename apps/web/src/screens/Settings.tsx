import { useState } from 'react';
import { zoneCentre } from '@delisp/dsp';
import { ScreenShell } from '../components/ScreenShell';
import { Banner, Button, Card, Stat } from '../components/ui';
import { DEFAULT_TOLERANCE } from '../lib/config';
import {
  type Settings,
  clearAllData,
  defaultZoneCentre,
  exportAll,
  isCalibrated,
  saveSettings,
  targetZone,
} from '../lib/db';
import { patternLabel } from '../lib/diagnostic';
import { httpClient } from '../lib/api';
import { apiExportOptions, archiveName, buildExportArchive, saveBlob } from '../lib/exportArchive';
import { formatDate, formatHz } from '../lib/progress';
import { navigate } from '../lib/router';

export function SettingsScreen({
  settings,
  onChanged,
}: {
  settings: Settings;
  onChanged: () => Promise<void>;
}) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const zone = targetZone(settings);

  const setTolerance = async (value: number) => {
    await saveSettings({ tolerance: value });
    await onChanged();
  };

  const download = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveBlob(blob, `delisp-export-${new Date().toISOString().slice(0, 10)}.json`);
    setNote('Exported every session, trial and calibration as JSON.');
  };

  /**
   * The full archive: the JSON record plus the baseline audio, which is the one
   * thing here that cannot be regenerated.
   */
  const downloadArchive = async () => {
    setNote(null);
    setArchiving('Preparing…');
    try {
      const result = await buildExportArchive({
        ...apiExportOptions(httpClient()),
        onProgress: (done, total) =>
          setArchiving(total === 0 ? 'Preparing…' : `Fetching baselines ${done}/${total}…`),
      });
      saveBlob(result.blob, archiveName());
      setNote(
        result.baselinesFailed.length > 0
          ? `Exported with ${result.baselinesIncluded} baselines; ${result.baselinesFailed.length} could not be fetched and are listed in the manifest.`
          : `Exported everything, including ${result.baselinesIncluded} baseline recordings.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setArchiving(null);
    }
  };

  return (
    <ScreenShell title="Settings" back="/">
      {note ? <Banner tone="info">{note}</Banner> : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Calibrated"
          value={isCalibrated(settings) ? 'Yes' : 'No'}
          hint={settings.calibratedAt ? formatDate(settings.calibratedAt) : 'not yet run'}
        />
        <Stat
          label="Noise floor"
          value={settings.noiseFloor === null ? '—' : settings.noiseFloor.toFixed(4)}
          hint="rms"
        />
        <Stat
          label="Capture"
          value={settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)} kHz` : '—'}
        />
        <Stat label="Target" value={formatHz(zoneCentre(zone))} hint="reference /s/" />
        <Stat
          label="Pattern"
          value={patternLabel(settings.lispPattern)}
          hint={settings.diagnosedAt ? formatDate(settings.diagnosedAt) : 'not diagnosed'}
        />
        <Stat
          label="Feedback"
          value={`${Math.round(settings.feedbackRate * 100)}%`}
          hint="score shown per trial"
        />
      </div>

      <Card>
        <p className="text-sm font-semibold text-slate-200">Device</p>
        <p className="mt-1 break-words text-sm text-slate-400">
          {settings.deviceLabel ?? 'Not recorded yet'}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Wired earphones and the built-in mic give different centroids for the same sound, so the
          device is stored with every trial. Re-calibrate when you switch.
        </p>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-slate-200">Tolerance</p>
          <p className="font-mono text-sm tabular-nums text-slate-300">
            ±{Math.round(settings.tolerance)} Hz
          </p>
        </div>
        <input
          type="range"
          min={600}
          max={2500}
          step={50}
          value={settings.tolerance}
          onChange={(e) => void setTolerance(Number(e.target.value))}
          className="mt-3 h-11 w-full accent-emerald-500"
        />
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Zone: {formatHz(zone.centroidMin)} – {formatHz(zone.centroidMax)}. Widen it if nothing you
          do reaches the green band; narrow it once you are living there.
        </p>
      </Card>

      <Button variant="secondary" onClick={() => navigate('/calibrate')}>
        Re-run calibration
      </Button>
      <Button variant="secondary" onClick={() => navigate('/diagnostic')}>
        Re-run the diagnostic
      </Button>
      <Button variant="secondary" onClick={() => void download()}>
        Export data as JSON
      </Button>
      <Button variant="secondary" onClick={() => void downloadArchive()} disabled={archiving !== null}>
        {archiving ?? 'Export everything (JSON + baseline audio)'}
      </Button>

      {confirmingReset ? (
        <Card>
          <p className="text-sm leading-relaxed text-slate-300">
            This erases every session, trial and calibration on this device. There is no backup and
            no undo — export first if you want to keep the history.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmingReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await clearAllData();
                await onChanged();
                setConfirmingReset(false);
                setNote('All local data erased.');
              }}
            >
              Erase
            </Button>
          </div>
        </Card>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmingReset(true)}>
          Erase all data
        </Button>
      )}

      <p className="mt-2 text-xs leading-relaxed text-slate-600">
        Phase 1: everything is stored in this browser only. Default target centre is{' '}
        {formatHz(defaultZoneCentre())}, default tolerance ±{DEFAULT_TOLERANCE} Hz.
      </p>
    </ScreenShell>
  );
}
