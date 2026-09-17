import { describe, expect, it, vi } from 'vitest';
import type { ApiClient, SessionPayload } from '../src/lib/api';
import type { Settings, TrialRow } from '../src/lib/db';
import type { ProgressionRow } from '../src/lib/progression';
import { type SyncStore, describeSync, syncNow, syncSucceeded } from '../src/lib/sync';

const SETTINGS = { id: 'singleton', lispPattern: 'unknown', feedbackRate: 1 } as unknown as Settings;

function session(id: string, level = 2): SessionPayload {
  return { id, startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, level, trialCount: 0 };
}

function trial(id: string, sessionId: string): TrialRow {
  return { id, sessionId, level: 2, exerciseId: 'l2-sun' } as unknown as TrialRow;
}

function progressionRow(level: number): ProgressionRow {
  return {
    level,
    status: 'active',
    accuracyWindow: [1, 0],
    passedAt: null,
    nextRetestAt: null,
    retestStage: 0,
  };
}

interface Harness {
  store: SyncStore;
  client: ApiClient;
  markedSessions: string[];
  markedTrials: string[];
  order: string[];
}

function harness({
  sessions = [session('ses_1')],
  trials = [trial('trl_1', 'ses_1')],
  progression = [progressionRow(2)],
  failSession,
  failTrialsAfter,
  failSettings = false,
}: {
  sessions?: SessionPayload[];
  trials?: TrialRow[];
  progression?: ProgressionRow[];
  failSession?: string;
  failTrialsAfter?: number;
  failSettings?: boolean;
} = {}): Harness {
  const markedSessions: string[] = [];
  const markedTrials: string[] = [];
  const order: string[] = [];
  let trialCalls = 0;

  const store: SyncStore = {
    unsyncedSessions: async () => sessions,
    unsyncedTrials: async () => trials,
    markSessionsSynced: async (ids) => void markedSessions.push(...ids),
    markTrialsSynced: async (ids) => void markedTrials.push(...ids),
    settings: async () => SETTINGS,
    progression: async () => progression,
  };

  const client: ApiClient = {
    health: async () => true,
    postSession: async (s) => {
      order.push(`session:${s.id}`);
      if (failSession === s.id) throw new Error('server said no');
    },
    postTrials: async (batch) => {
      order.push(`trials:${batch.length}`);
      trialCalls++;
      if (failTrialsAfter !== undefined && trialCalls > failTrialsAfter) {
        throw new Error('server said no');
      }
    },
    putSettings: async () => {
      order.push('settings');
      if (failSettings) throw new Error('server said no');
    },
    putProgression: async () => void order.push('progression'),
    postDiagnostic: async () => undefined,
    postRecording: async () => 'key',
    postBaseline: async () => ({ key: 'key', transcript: null, wpm: null, durationMs: null }),
    modelAudio: async () => [],
    generateModelAudio: async () => ({ key: 'key', generated: false }),
    baselines: async () => [],
    recordingUrl: (key: string) => `/api/recordings/${key}`,
    scoreAsr: async () => ({ text: '', match: false, reason: 'exact', substitutions: [] }),
    progress: async () => ({ perLevel: [], sessions: [], selfRating: { rated: 0, agreed: 0 } }),
  };

  return { store, client, markedSessions, markedTrials, order };
}

const online = { isOnline: () => true };

describe('syncNow', () => {
  it('does nothing when offline, and says so', async () => {
    const { store, client, markedTrials } = harness();
    const result = await syncNow(store, client, { isOnline: () => false });
    expect(result.ran).toBe(false);
    expect(result.errors).toEqual(['offline']);
    expect(markedTrials).toEqual([]);
    expect(describeSync(result)).toMatch(/Offline/);
  });

  it('pushes sessions before trials, because trials reference them', async () => {
    const { store, client, order } = harness();
    await syncNow(store, client, online);
    expect(order.indexOf('session:ses_1')).toBeLessThan(order.findIndex((o) => o.startsWith('trials:')));
  });

  it('marks everything it managed to push', async () => {
    const { store, client, markedSessions, markedTrials } = harness();
    const result = await syncNow(store, client, online);
    expect(markedSessions).toEqual(['ses_1']);
    expect(markedTrials).toEqual(['trl_1']);
    expect(result).toMatchObject({ ran: true, sessions: 1, trials: 1, settings: true, progression: 1 });
    expect(syncSucceeded(result)).toBe(true);
  });

  it('holds back trials whose session failed to push', async () => {
    // Sending them anyway would just earn a foreign-key rejection.
    const { store, client, markedSessions, markedTrials } = harness({
      sessions: [session('ses_1'), session('ses_2')],
      trials: [trial('trl_1', 'ses_1'), trial('trl_2', 'ses_2')],
      failSession: 'ses_2',
    });
    const result = await syncNow(store, client, online);
    expect(markedSessions).toEqual(['ses_1']);
    expect(markedTrials).toEqual(['trl_1']);
    expect(result.errors[0]).toMatch(/session ses_2/);
  });

  it('never marks a batch synced when the server rejected it', async () => {
    const { store, client, markedTrials } = harness({
      trials: [trial('a', 'ses_1'), trial('b', 'ses_1'), trial('c', 'ses_1'), trial('d', 'ses_1')],
      failTrialsAfter: 1,
    });
    const result = await syncNow(store, client, { ...online, batchSize: 2 });
    // The first batch of two got through; the second did not.
    expect(markedTrials).toEqual(['a', 'b']);
    expect(result.trials).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(syncSucceeded(result)).toBe(false);
  });

  it('stops after the first failed batch rather than hammering the server', async () => {
    const { store, client } = harness({
      trials: Array.from({ length: 10 }, (_, i) => trial(`t${i}`, 'ses_1')),
      failTrialsAfter: 0,
    });
    const postTrials = vi.spyOn(client, 'postTrials');
    await syncNow(store, client, { ...online, batchSize: 2 });
    expect(postTrials).toHaveBeenCalledTimes(1);
  });

  it('batches large flushes', async () => {
    const { store, client, order } = harness({
      trials: Array.from({ length: 120 }, (_, i) => trial(`t${i}`, 'ses_1')),
    });
    const result = await syncNow(store, client, { ...online, batchSize: 50 });
    expect(result.trials).toBe(120);
    expect(order.filter((o) => o.startsWith('trials:'))).toEqual(['trials:50', 'trials:50', 'trials:20']);
  });

  it('still pushes progression when settings fail', async () => {
    // One failure should not strand the other; they are independent rows.
    const { store, client, order } = harness({ failSettings: true });
    const result = await syncNow(store, client, online);
    expect(result.settings).toBe(false);
    expect(result.progression).toBe(1);
    expect(order).toContain('progression');
    expect(result.errors[0]).toMatch(/settings/);
  });

  it('skips the progression call when there is nothing to send', async () => {
    const { store, client, order } = harness({ progression: [] });
    const result = await syncNow(store, client, online);
    expect(result.progression).toBe(0);
    expect(order).not.toContain('progression');
  });

  it('reports an up-to-date device as a no-op, not a failure', async () => {
    const { store, client } = harness({ sessions: [], trials: [] });
    const result = await syncNow(store, client, online);
    expect(syncSucceeded(result)).toBe(true);
    expect(describeSync(result)).toBe('Already up to date.');
  });

  it('summarises what it sent', async () => {
    const { store, client } = harness();
    expect(describeSync(await syncNow(store, client, online))).toBe('Sent 2 records.');
  });
});
