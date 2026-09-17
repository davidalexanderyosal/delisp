import type { ApiClient, SessionPayload } from './api';
import type { Settings, TrialRow } from './db';
import type { ProgressionRow } from './progression';

/**
 * Flushes the local IndexedDB mirror to D1 (spec §4: "a sync worker flushes to
 * the API when online; server is source of truth after sync").
 *
 * The ordering is not incidental. Sessions go first because trials carry a
 * foreign key to them; a trial pushed before its session is rejected. And
 * nothing is marked synced until the server has acknowledged it, so a flush
 * interrupted halfway is retried rather than silently dropped — which is why
 * the server side of `POST /api/trials` is idempotent.
 */

export interface SyncStore {
  unsyncedSessions(): Promise<SessionPayload[]>;
  unsyncedTrials(): Promise<TrialRow[]>;
  markSessionsSynced(ids: readonly string[]): Promise<void>;
  markTrialsSynced(ids: readonly string[]): Promise<void>;
  settings(): Promise<Settings>;
  progression(): Promise<ProgressionRow[]>;
}

export interface SyncResult {
  ran: boolean;
  sessions: number;
  trials: number;
  progression: number;
  settings: boolean;
  /** Human-readable reasons, in the order they happened. */
  errors: string[];
}

export interface SyncOptions {
  /** Trials per request. D1 is happier with tens than with thousands. */
  batchSize?: number;
  /** Injected in tests; defaults to the browser's own notion of connectivity. */
  isOnline?: () => boolean;
}

const EMPTY: SyncResult = {
  ran: false,
  sessions: 0,
  trials: 0,
  progression: 0,
  settings: false,
  errors: [],
};

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function syncNow(
  store: SyncStore,
  client: ApiClient,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const online = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  if (!online()) return { ...EMPTY, errors: ['offline'] };

  const batchSize = options.batchSize ?? 50;
  const result: SyncResult = { ...EMPTY, ran: true, errors: [] };

  // Sessions first: trials reference them.
  const sessions = await store.unsyncedSessions();
  const pushedSessions: string[] = [];
  for (const session of sessions) {
    try {
      await client.postSession(session);
      pushedSessions.push(session.id);
    } catch (err) {
      result.errors.push(`session ${session.id}: ${describe(err)}`);
    }
  }
  if (pushedSessions.length > 0) {
    await store.markSessionsSynced(pushedSessions);
    result.sessions = pushedSessions.length;
  }

  // Only trials whose session is already on the server can be pushed. A trial
  // whose session failed waits for the next flush rather than being rejected.
  const accepted = new Set(pushedSessions);
  const previouslySynced = new Set(
    sessions.filter((s) => !accepted.has(s.id)).map((s) => s.id),
  );
  const trials = (await store.unsyncedTrials()).filter(
    (trial) => !previouslySynced.has(trial.sessionId),
  );

  for (let i = 0; i < trials.length; i += batchSize) {
    const batch = trials.slice(i, i + batchSize);
    try {
      await client.postTrials(batch);
      await store.markTrialsSynced(batch.map((t) => t.id));
      result.trials += batch.length;
    } catch (err) {
      // Stop at the first failed batch: the rest are almost certainly going to
      // fail the same way, and retrying them now would just multiply the noise.
      result.errors.push(`trials ${i}-${i + batch.length}: ${describe(err)}`);
      break;
    }
  }

  // Settings and progression are single rows the client owns outright, so
  // last-write-wins is the whole conflict story for a single-user app.
  try {
    await client.putSettings(await store.settings());
    result.settings = true;
  } catch (err) {
    result.errors.push(`settings: ${describe(err)}`);
  }

  try {
    const rows = await store.progression();
    if (rows.length > 0) {
      await client.putProgression(rows);
      result.progression = rows.length;
    }
  } catch (err) {
    result.errors.push(`progression: ${describe(err)}`);
  }

  return result;
}

export function syncSucceeded(result: SyncResult): boolean {
  return result.ran && result.errors.length === 0;
}

export function describeSync(result: SyncResult): string {
  if (!result.ran) return result.errors[0] === 'offline' ? 'Offline — nothing sent.' : 'Not run.';
  const pushed = result.trials + result.sessions;
  if (result.errors.length > 0) {
    return `Sent ${pushed} record${pushed === 1 ? '' : 's'}, ${result.errors.length} failed.`;
  }
  return pushed === 0 ? 'Already up to date.' : `Sent ${pushed} record${pushed === 1 ? '' : 's'}.`;
}
