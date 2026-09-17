import type { SessionPayload } from './api';
import {
  allProgression,
  getSettings,
  markSessionsSynced,
  markTrialsSynced,
  unsyncedSessions,
  unsyncedTrials,
} from './db';
import type { SyncStore } from './sync';

/** Binds the sync worker to IndexedDB. Kept apart so the logic stays testable. */
export function idbSyncStore(): SyncStore {
  return {
    async unsyncedSessions(): Promise<SessionPayload[]> {
      const rows = await unsyncedSessions();
      return rows.map((row) => ({
        id: row.id,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        level: row.level,
        trialCount: row.trialCount,
      }));
    },
    unsyncedTrials,
    markSessionsSynced,
    markTrialsSynced,
    settings: getSettings,
    progression: allProgression,
  };
}
