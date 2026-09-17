import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import {
  DEFAULT_TARGET_ZONE,
  type AcousticPattern,
  type TargetZone,
  zoneCentre,
  zoneFromCentre,
} from '@delisp/dsp';
import { DEFAULT_TOLERANCE } from './config';
import { LEVELS, levelDef } from './levels';
import { type ProgressionRow, activeLevel, newProgression } from './progression';

export type LispPattern = 'frontal' | 'lateral' | 'mixed' | 'unknown';
export type SelfRating = 'good' | 'unsure' | 'off';

/**
 * Local mirror of the D1 tables in spec §4. Phase 1 is local-only; the `synced`
 * flag is already here so the Phase 3 sync worker has something to filter on.
 */
export interface Settings {
  id: 'singleton';
  lispPattern: LispPattern;
  noiseFloor: number | null;
  targetCentroid: number | null;
  tolerance: number;
  targetRatio: number;
  feedbackRate: number;
  sampleRate: number | null;
  deviceLabel: string | null;
  calibratedAt: string | null;
  diagnosedAt: string | null;
  updatedAt: string;
}

export interface SessionRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  level: number;
  trialCount: number;
  synced: 0 | 1;
}

export interface TrialRow {
  id: string;
  sessionId: string;
  exerciseId: string;
  level: number;
  createdAt: string;
  centroid: number;
  bandRatio: number;
  spread: number;
  sDurationMs: number;
  fricativeFrames: number;
  acousticScore: number;
  selfRating: SelfRating | null;
  score: number;
  passed: 0 | 1;
  feedbackShown: 0 | 1;
  deviceLabel: string | null;
  synced: 0 | 1;
  /** Blocked or random practice at the time (spec §3.7). */
  practice?: 'blocked' | 'random';
  /** Warm-up, main block or spaced re-test. */
  kind?: 'warmup' | 'main' | 'retest';
  /** Share of audible frames that looked voiced — the /z/ check. */
  voicing?: number;
  /** What the transcript said, on levels judged by transcription. */
  asrText?: string | null;
  /** 1 / 0 / null when transcription did not run. */
  asrMatch?: 0 | 1 | null;
  /** R2 key, when the clip was kept (spec §4 retention). */
  recordingKey?: string | null;
  /** JSON array of {expected, heard, position} — the substitution log (spec §3.9). */
  asrSubstitutions?: string | null;
}

export interface CalibrationRep {
  medianCentroid: number;
  medianBandRatio: number;
  meanSpread: number;
  sDurationMs: number;
}

export interface DiagnosticRow {
  id: string;
  createdAt: string;
  /** Acoustic pattern from the sustained /s/ in calibration. */
  acoustic: string;
  tongueVisible: boolean | null;
  airAtCorners: boolean | null;
  pattern: LispPattern;
  signalCount: number;
}

export interface CalibrationRow {
  id: string;
  createdAt: string;
  /** Tentative pattern read off the sustained /s/ — one of the diagnostic signals. */
  acousticPattern: AcousticPattern;
  noiseFloor: number;
  medianCentroid: number;
  medianBandRatio: number;
  reps: CalibrationRep[];
  sampleRate: number;
  deviceLabel: string | null;
}

interface DelispDb extends DBSchema {
  settings: { key: string; value: Settings };
  sessions: { key: string; value: SessionRow; indexes: { 'by-startedAt': string } };
  trials: {
    key: string;
    value: TrialRow;
    indexes: { 'by-session': string; 'by-createdAt': string };
  };
  calibrations: { key: string; value: CalibrationRow; indexes: { 'by-createdAt': string } };
  progression: { key: number; value: ProgressionRow };
  diagnostics: { key: string; value: DiagnosticRow; indexes: { 'by-createdAt': string } };
}

const DB_NAME = 'delisp';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<DelispDb>> | null = null;

export function db(): Promise<IDBPDatabase<DelispDb>> {
  dbPromise ??= openDB<DelispDb>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('settings', { keyPath: 'id' });

        const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-startedAt', 'startedAt');

        const trials = database.createObjectStore('trials', { keyPath: 'id' });
        trials.createIndex('by-session', 'sessionId');
        trials.createIndex('by-createdAt', 'createdAt');

        const calibrations = database.createObjectStore('calibrations', { keyPath: 'id' });
        calibrations.createIndex('by-createdAt', 'createdAt');
      }

      if (oldVersion < 2) {
        // Phase 2: the curriculum needs somewhere to keep level state.
        database.createObjectStore('progression', { keyPath: 'level' });
        const diagnostics = database.createObjectStore('diagnostics', { keyPath: 'id' });
        diagnostics.createIndex('by-createdAt', 'createdAt');
      }
    },
  });
  return dbPromise;
}

export function defaultSettings(): Settings {
  return {
    id: 'singleton',
    lispPattern: 'unknown',
    noiseFloor: null,
    targetCentroid: null,
    tolerance: DEFAULT_TOLERANCE,
    targetRatio: DEFAULT_TARGET_ZONE.minBandRatio,
    feedbackRate: 1,
    sampleRate: null,
    deviceLabel: null,
    calibratedAt: null,
    diagnosedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getSettings(): Promise<Settings> {
  const existing = await (await db()).get('settings', 'singleton');
  return existing ?? defaultSettings();
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, id: 'singleton', updatedAt: new Date().toISOString() };
  await (await db()).put('settings', next);
  return next;
}

/** The green band on the gauge, from whatever calibration we have. */
export function targetZone(settings: Settings): TargetZone {
  if (settings.targetCentroid === null) return DEFAULT_TARGET_ZONE;
  return zoneFromCentre(settings.targetCentroid, settings.tolerance, settings.targetRatio);
}

export function isCalibrated(settings: Settings): boolean {
  return settings.noiseFloor !== null && settings.calibratedAt !== null;
}

export function defaultZoneCentre(): number {
  return zoneCentre(DEFAULT_TARGET_ZONE);
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export async function createSession(level: number): Promise<SessionRow> {
  const row: SessionRow = {
    id: newId('ses'),
    startedAt: new Date().toISOString(),
    endedAt: null,
    level,
    trialCount: 0,
    synced: 0,
  };
  await (await db()).put('sessions', row);
  return row;
}

export async function endSession(id: string): Promise<void> {
  const database = await db();
  const row = await database.get('sessions', id);
  if (!row) return;
  await database.put('sessions', { ...row, endedAt: new Date().toISOString() });
}

export async function addTrial(trial: TrialRow): Promise<void> {
  const database = await db();
  const tx = database.transaction(['trials', 'sessions'], 'readwrite');
  await tx.objectStore('trials').put(trial);
  const session = await tx.objectStore('sessions').get(trial.sessionId);
  if (session) {
    await tx.objectStore('sessions').put({ ...session, trialCount: session.trialCount + 1 });
  }
  await tx.done;
}

export async function listSessions(): Promise<SessionRow[]> {
  const rows = await (await db()).getAllFromIndex('sessions', 'by-startedAt');
  return rows.reverse();
}

export async function listTrials(sessionId: string): Promise<TrialRow[]> {
  return (await db()).getAllFromIndex('trials', 'by-session', sessionId);
}

export async function allTrials(): Promise<TrialRow[]> {
  return (await db()).getAllFromIndex('trials', 'by-createdAt');
}

/** Most recent `count` trials at `level`, oldest first. */
export async function recentTrials(level: number, count: number): Promise<TrialRow[]> {
  const rows = await allTrials();
  return rows.filter((t) => t.level === level).slice(-count);
}

/* ------------------------------------------------------------------- sync */

export async function unsyncedSessions(): Promise<SessionRow[]> {
  const rows = await (await db()).getAll('sessions');
  return rows.filter((row) => row.synced === 0);
}

export async function unsyncedTrials(): Promise<TrialRow[]> {
  const rows = await (await db()).getAll('trials');
  return rows.filter((row) => row.synced === 0);
}

async function markSynced(
  store: 'sessions' | 'trials',
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const database = await db();
  const tx = database.transaction(store, 'readwrite');
  for (const id of ids) {
    const row = await tx.store.get(id);
    if (row) await tx.store.put({ ...row, synced: 1 });
  }
  await tx.done;
}

export const markSessionsSynced = (ids: readonly string[]) => markSynced('sessions', ids);
export const markTrialsSynced = (ids: readonly string[]) => markSynced('trials', ids);

export async function addCalibration(row: CalibrationRow): Promise<void> {
  await (await db()).put('calibrations', row);
}

export async function latestCalibration(): Promise<CalibrationRow | null> {
  const rows = await (await db()).getAllFromIndex('calibrations', 'by-createdAt');
  return rows.at(-1) ?? null;
}

/**
 * Progression rows for every level, creating them on first read. Level 0 starts
 * active; everything above it is locked until the level below is passed.
 */
export async function allProgression(): Promise<ProgressionRow[]> {
  const database = await db();
  const existing = await database.getAll('progression');
  const byLevel = new Map(existing.map((row) => [row.level, row]));
  const rows = LEVELS.map(
    (def) => byLevel.get(def.level) ?? newProgression(def.level, def.level === 0 ? 'active' : 'locked'),
  );
  const missing = rows.filter((row) => !byLevel.has(row.level));
  if (missing.length > 0) {
    const tx = database.transaction('progression', 'readwrite');
    await Promise.all(missing.map((row) => tx.store.put(row)));
    await tx.done;
  }
  return rows;
}

export async function saveProgression(row: ProgressionRow): Promise<void> {
  await (await db()).put('progression', row);
}

/** Unlocks the next level and marks it active. */
export async function unlockNext(level: number): Promise<void> {
  const next = LEVELS.find((l) => l.level === level + 1);
  if (!next) return;
  const database = await db();
  const existing = await database.get('progression', next.level);
  const row = existing ?? newProgression(next.level, 'locked');
  if (row.status === 'locked') {
    await database.put('progression', { ...row, status: 'active' });
  }
}

export async function currentLevel(): Promise<number> {
  return activeLevel(await allProgression());
}

export function windowFor(level: number): number {
  return levelDef(level).window;
}

export async function addDiagnostic(row: DiagnosticRow): Promise<void> {
  await (await db()).put('diagnostics', row);
}

export async function latestDiagnostic(): Promise<DiagnosticRow | null> {
  const rows = await (await db()).getAllFromIndex('diagnostics', 'by-createdAt');
  return rows.at(-1) ?? null;
}

export async function clearAllData(): Promise<void> {
  const database = await db();
  const tx = database.transaction(
    ['settings', 'sessions', 'trials', 'calibrations', 'progression', 'diagnostics'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('settings').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('trials').clear(),
    tx.objectStore('calibrations').clear(),
    tx.objectStore('progression').clear(),
    tx.objectStore('diagnostics').clear(),
  ]);
  await tx.done;
}

/** Everything, as one JSON-serialisable object (spec §8, Phase 5 export). */
export async function exportAll(): Promise<Record<string, unknown>> {
  const database = await db();
  return {
    exportedAt: new Date().toISOString(),
    settings: await database.getAll('settings'),
    sessions: await database.getAll('sessions'),
    trials: await database.getAll('trials'),
    calibrations: await database.getAll('calibrations'),
    progression: await database.getAll('progression'),
    diagnostics: await database.getAll('diagnostics'),
  };
}
