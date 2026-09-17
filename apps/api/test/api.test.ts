import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';

const NOW = '2026-01-01T00:00:00.000Z';

/** Calls the Worker the way the browser would. */
async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(`https://api.test${path}`, init), env);
}

function json(path: string, method: string, body: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedExercise(id = 'l2-sun', level = 2): Promise<void> {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO exercises (id, level, sound, position, text) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, level, 's', 'initial', 'sun')
    .run();
}

async function seedSession(id = 'ses_1', level = 2): Promise<void> {
  await json('/api/sessions', 'POST', { id, level, startedAt: NOW });
}

function trial(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'trl_1',
    sessionId: 'ses_1',
    exerciseId: 'l2-sun',
    level: 2,
    createdAt: NOW,
    centroid: 6400,
    bandRatio: 12,
    spread: 900,
    sDurationMs: 180,
    voicing: 0.02,
    acousticScore: 82,
    selfRating: 'good',
    score: 82,
    passed: true,
    feedbackShown: true,
    kind: 'main',
    practice: 'blocked',
    ...overrides,
  };
}

beforeEach(async () => {
  for (const table of ['trials', 'sessions', 'exercises', 'settings', 'progression', 'diagnostics']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('access middleware', () => {
  it('lets requests through when no Access audience is configured', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
  });

  it('refuses a request with no assertion once Access is configured', async () => {
    const guarded = await app.fetch(new Request('https://api.test/api/settings'), {
      ...env,
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      ACCESS_AUD: 'aud-tag',
    });
    expect(guarded.status).toBe(401);
    expect(await guarded.json()).toEqual({ error: 'missing Access assertion' });
  });

  it('refuses a malformed assertion', async () => {
    const guarded = await app.fetch(
      new Request('https://api.test/api/settings', {
        headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' },
      }),
      { ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-tag' },
    );
    expect(guarded.status).toBe(401);
    expect((await guarded.json() as { error: string }).error).toMatch(/malformed token/);
  });
});

describe('settings', () => {
  it('returns null before anything is stored', async () => {
    const response = await call('/api/settings');
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it('stores and returns the single settings row', async () => {
    const response = await json('/api/settings', 'PUT', {
      lispPattern: 'lateral',
      noiseFloor: 0.004,
      targetCentroid: 7000,
      tolerance: 1500,
      feedbackRate: 0.5,
      calibratedAt: NOW,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
    expect(body.lispPattern).toBe('lateral');
    expect(body.targetCentroid).toBe(7000);
  });

  it('updates in place rather than accumulating rows', async () => {
    await json('/api/settings', 'PUT', { lispPattern: 'frontal', tolerance: 1500 });
    await json('/api/settings', 'PUT', { lispPattern: 'lateral', tolerance: 1200 });
    const { results } = await env.DB.prepare('SELECT * FROM settings').all();
    expect(results.length).toBe(1);
    expect(results[0]!.lisp_pattern).toBe('lateral');
    expect(results[0]!.tolerance).toBe(1200);
  });
});

describe('exercises', () => {
  it('filters by level', async () => {
    await seedExercise('l2-sun', 2);
    await seedExercise('l3-bus', 3);
    const all = (await (await call('/api/exercises')).json()) as unknown[];
    expect(all.length).toBe(2);
    const level3 = (await (await call('/api/exercises?level=3')).json()) as { id: string }[];
    expect(level3.map((e) => e.id)).toEqual(['l3-bus']);
  });
});

describe('trials', () => {
  beforeEach(async () => {
    await seedExercise();
    await seedSession();
  });

  it('inserts a batch and keeps the session trial count honest', async () => {
    const response = await json('/api/trials', 'POST', {
      trials: [trial(), trial({ id: 'trl_2', passed: false, score: 20 })],
    });
    expect(await response.json()).toEqual({ inserted: 2 });

    const { results } = await env.DB.prepare('SELECT trial_count FROM sessions WHERE id = ?')
      .bind('ses_1')
      .all();
    expect(results[0]!.trial_count).toBe(2);
  });

  it('is idempotent, so a half-failed flush can be retried safely', async () => {
    await json('/api/trials', 'POST', { trials: [trial(), trial({ id: 'trl_2' })] });
    // The client retries the whole batch, including the two it already sent.
    await json('/api/trials', 'POST', {
      trials: [trial(), trial({ id: 'trl_2' }), trial({ id: 'trl_3' })],
    });

    const { results } = await env.DB.prepare('SELECT COUNT(*) as n FROM trials').all();
    expect(results[0]!.n).toBe(3);
    const session = await env.DB.prepare('SELECT trial_count FROM sessions WHERE id = ?')
      .bind('ses_1')
      .all();
    expect(session.results[0]!.trial_count).toBe(3);
  });

  it('stores booleans as the integers the schema declares', async () => {
    await json('/api/trials', 'POST', { trials: [trial({ passed: true, feedbackShown: false })] });
    const { results } = await env.DB.prepare('SELECT passed, feedback_shown FROM trials').all();
    expect(results[0]!.passed).toBe(1);
    expect(results[0]!.feedback_shown).toBe(0);
  });

  it('rejects a batch with nothing usable in it', async () => {
    const response = await json('/api/trials', 'POST', { trials: [{ nonsense: true }] });
    expect(response.status).toBe(400);
  });

  it('accepts an empty batch without touching the database', async () => {
    const response = await json('/api/trials', 'POST', { trials: [] });
    expect(await response.json()).toEqual({ inserted: 0 });
  });
});

describe('progression', () => {
  it('round-trips rows and serialises the accuracy window as JSON', async () => {
    await json('/api/progression', 'PUT', {
      rows: [
        { level: 0, status: 'passed', accuracyWindow: [1, 1, 0, 1], retestStage: 1, passedAt: NOW },
        { level: 1, status: 'active', accuracyWindow: [], retestStage: 0 },
      ],
    });
    const rows = (await (await call('/api/progression')).json()) as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    expect(rows[0]!.level).toBe(0);
    expect(JSON.parse(rows[0]!.accuracyWindow as string)).toEqual([1, 1, 0, 1]);
  });

  it('updates a level in place on the next sync', async () => {
    await json('/api/progression', 'PUT', { rows: [{ level: 2, status: 'active', accuracyWindow: [1] }] });
    await json('/api/progression', 'PUT', { rows: [{ level: 2, status: 'passed', accuracyWindow: [1, 1] }] });
    const rows = (await (await call('/api/progression')).json()) as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('passed');
  });
});

describe('progress', () => {
  beforeEach(async () => {
    await seedExercise();
    await seedSession();
  });

  it('aggregates per level and reports self-rating agreement', async () => {
    await json('/api/trials', 'POST', {
      trials: [
        trial({ id: 'a', passed: true, selfRating: 'good', centroid: 6000, score: 90 }),
        trial({ id: 'b', passed: false, selfRating: 'good', centroid: 4000, score: 20 }),
        trial({ id: 'c', passed: false, selfRating: 'off', centroid: 4400, score: 10 }),
      ],
    });

    const body = (await (await call('/api/progress')).json()) as {
      perLevel: { level: number; trials: number; passed: number; meanCentroid: number }[];
      selfRating: { rated: number; agreed: number };
    };

    expect(body.perLevel.length).toBe(1);
    expect(body.perLevel[0]!.level).toBe(2);
    expect(body.perLevel[0]!.trials).toBe(3);
    expect(body.perLevel[0]!.passed).toBe(1);
    expect(body.perLevel[0]!.meanCentroid).toBeCloseTo(4800, 0);
    // 'good'+passed agrees, 'good'+failed does not, 'off'+failed agrees.
    expect(body.selfRating).toEqual({ rated: 3, agreed: 2 });
  });

  it('honours the since filter', async () => {
    await json('/api/trials', 'POST', {
      trials: [
        trial({ id: 'old', createdAt: '2025-01-01T00:00:00.000Z' }),
        trial({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' }),
      ],
    });
    const body = (await (await call('/api/progress?since=2026-01-01T00:00:00.000Z')).json()) as {
      perLevel: { trials: number }[];
    };
    expect(body.perLevel[0]!.trials).toBe(1);
  });
});

describe('phase 4 endpoints', () => {
  it('says plainly that phoneme scoring is not built yet', async () => {
    const response = await json('/api/score/phoneme', 'POST', { key: 'x', target: 'sun' });
    expect(response.status).toBe(501);
  });
});
