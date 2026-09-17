import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { DEFAULT_TARGET_ZONE, type TargetZone, zoneCentre, zoneFromCentre } from '@delisp/dsp';
import { DEFAULT_TOLERANCE } from './config';

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
}

export interface CalibrationRep {
  medianCentroid: number;
  medianBandRatio: number;
  meanSpread: number;
  sDurationMs: number;
}

export interface CalibrationRow {
  id: string;
  createdAt: string;
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
}

const DB_NAME = 'delisp';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DelispDb>> | null = null;

export function db(): Promise<IDBPDatabase<DelispDb>> {
  dbPromise ??= openDB<DelispDb>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('settings', { keyPath: 'id' });

      const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('by-startedAt', 'startedAt');

      const trials = database.createObjectStore('trials', { keyPath: 'id' });
      trials.createIndex('by-session', 'sessionId');
      trials.createIndex('by-createdAt', 'createdAt');

      const calibrations = database.createObjectStore('calibrations', { keyPath: 'id' });
      calibrations.createIndex('by-createdAt', 'createdAt');
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

export async function addCalibration(row: CalibrationRow): Promise<void> {
  await (await db()).put('calibrations', row);
}

export async function latestCalibration(): Promise<CalibrationRow | null> {
  const rows = await (await db()).getAllFromIndex('calibrations', 'by-createdAt');
  return rows.at(-1) ?? null;
}

export async function clearAllData(): Promise<void> {
  const database = await db();
  const tx = database.transaction(['settings', 'sessions', 'trials', 'calibrations'], 'readwrite');
  await Promise.all([
    tx.objectStore('settings').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('trials').clear(),
    tx.objectStore('calibrations').clear(),
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
  };
}
