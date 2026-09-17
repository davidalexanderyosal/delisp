import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import {
  diagnostics,
  exercises,
  progression,
  sessions,
  settings,
  trials,
} from '@delisp/schema';
import { AccessError, type AccessIdentity, verifyAccessJwt } from './access';
import type { Env } from './env';

type Variables = { identity: AccessIdentity | null };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Every route sits behind Cloudflare Access (spec §5). When ACCESS_AUD is unset
 * the check is skipped, which is how `wrangler dev` and the tests run — the
 * binding is absent locally, and refusing to start would make the API
 * undevelopable. A deployed Worker with no AUD configured is a misconfiguration,
 * so it says so in the response rather than failing open silently.
 */
app.use('/api/*', async (c, next) => {
  const aud = c.env.ACCESS_AUD;
  const team = c.env.ACCESS_TEAM_DOMAIN;

  if (!aud || !team) {
    c.set('identity', null);
    return next();
  }

  const token =
    c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c.req.header('Cookie'), 'CF_Authorization');
  if (!token) return c.json({ error: 'missing Access assertion' }, 401);

  try {
    c.set('identity', await verifyAccessJwt(token, { teamDomain: team, aud }));
  } catch (err) {
    const reason = err instanceof AccessError ? err.message : 'verification failed';
    return c.json({ error: `Access: ${reason}` }, 401);
  }
  return next();
});

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

const db = (env: Env) => drizzle(env.DB);

const now = () => new Date().toISOString();

app.get('/api/health', (c) => c.json({ ok: true }));

/* ---------------------------------------------------------------- settings */

app.get('/api/settings', async (c) => {
  const [row] = await db(c.env).select().from(settings).where(eq(settings.id, 1)).limit(1);
  return c.json(row ?? null);
});

app.put('/api/settings', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const patch = {
    lispPattern: str(body.lispPattern) ?? 'unknown',
    noiseFloor: num(body.noiseFloor),
    targetCentroid: num(body.targetCentroid),
    targetRatio: num(body.targetRatio),
    tolerance: num(body.tolerance),
    feedbackRate: num(body.feedbackRate) ?? 1,
    sampleRate: num(body.sampleRate),
    deviceLabel: str(body.deviceLabel),
    calibratedAt: str(body.calibratedAt),
    diagnosedAt: str(body.diagnosedAt),
    updatedAt: now(),
  };
  await db(c.env)
    .insert(settings)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: settings.id, set: patch });
  const [row] = await db(c.env).select().from(settings).where(eq(settings.id, 1)).limit(1);
  return c.json(row ?? null);
});

/* --------------------------------------------------------------- exercises */

app.get('/api/exercises', async (c) => {
  const levelParam = c.req.query('level');
  const query = db(c.env).select().from(exercises);
  const rows =
    levelParam === undefined
      ? await query
      : await query.where(eq(exercises.level, Number(levelParam)));
  return c.json(rows);
});

/* ---------------------------------------------------------------- sessions */

app.post('/api/sessions', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const id = str(body.id);
  const level = num(body.level);
  if (!id || level === null) return c.json({ error: 'id and level are required' }, 400);

  const row = {
    id,
    startedAt: str(body.startedAt) ?? now(),
    endedAt: str(body.endedAt),
    level,
    trialCount: num(body.trialCount) ?? 0,
  };
  await db(c.env)
    .insert(sessions)
    .values(row)
    .onConflictDoUpdate({
      target: sessions.id,
      set: { endedAt: row.endedAt, trialCount: row.trialCount },
    });
  return c.json(row, 201);
});

/* ------------------------------------------------------------------ trials */

/**
 * Batch insert. The client computes the features offline and flushes when it
 * reconnects, so this has to be idempotent: a flush that half-succeeded will be
 * retried with the same ids.
 */
app.post('/api/trials', async (c) => {
  const body = (await c.req.json()) as { trials?: unknown };
  const incoming = Array.isArray(body.trials) ? body.trials : [];
  if (incoming.length === 0) return c.json({ inserted: 0 });

  const rows = incoming
    .map((raw) => raw as Record<string, unknown>)
    .filter((raw) => str(raw.id) && str(raw.sessionId) && str(raw.exerciseId))
    .map((raw) => ({
      id: str(raw.id)!,
      sessionId: str(raw.sessionId)!,
      exerciseId: str(raw.exerciseId)!,
      level: num(raw.level) ?? 0,
      createdAt: str(raw.createdAt) ?? now(),
      centroid: num(raw.centroid),
      bandRatio: num(raw.bandRatio),
      spread: num(raw.spread),
      sDurationMs: num(raw.sDurationMs),
      voicing: num(raw.voicing),
      acousticScore: num(raw.acousticScore),
      asrText: str(raw.asrText),
      asrMatch: bool(raw.asrMatch),
      selfRating: str(raw.selfRating),
      score: num(raw.score),
      passed: bool(raw.passed),
      feedbackShown: bool(raw.feedbackShown),
      practice: str(raw.practice),
      kind: str(raw.kind),
      deviceLabel: str(raw.deviceLabel),
      recordingKey: str(raw.recordingKey),
    }));

  if (rows.length === 0) return c.json({ error: 'no valid trials' }, 400);

  for (const row of rows) {
    await db(c.env).insert(trials).values(row).onConflictDoNothing({ target: trials.id });
  }

  // Keep the denormalised counter honest rather than trusting the client's.
  const touched = [...new Set(rows.map((r) => r.sessionId))];
  for (const sessionId of touched) {
    await c.env.DB.prepare(
      'UPDATE sessions SET trial_count = (SELECT COUNT(*) FROM trials WHERE session_id = ?) WHERE id = ?',
    )
      .bind(sessionId, sessionId)
      .run();
  }

  return c.json({ inserted: rows.length });
});

/* ------------------------------------------------------------- progression */

app.get('/api/progression', async (c) => {
  return c.json(await db(c.env).select().from(progression).orderBy(progression.level));
});

app.put('/api/progression', async (c) => {
  const body = (await c.req.json()) as { rows?: unknown };
  const incoming = Array.isArray(body.rows) ? body.rows : [];
  for (const raw of incoming.map((r) => r as Record<string, unknown>)) {
    const level = num(raw.level);
    if (level === null) continue;
    const row = {
      level,
      status: str(raw.status) ?? 'locked',
      accuracyWindow: Array.isArray(raw.accuracyWindow)
        ? JSON.stringify(raw.accuracyWindow)
        : str(raw.accuracyWindow),
      passedAt: str(raw.passedAt),
      nextRetestAt: str(raw.nextRetestAt),
      retestStage: num(raw.retestStage) ?? 0,
    };
    await db(c.env)
      .insert(progression)
      .values(row)
      .onConflictDoUpdate({ target: progression.level, set: row });
  }
  return c.json(await db(c.env).select().from(progression).orderBy(progression.level));
});

/* -------------------------------------------------------------- diagnostic */

app.post('/api/diagnostics', async (c) => {
  const raw = (await c.req.json()) as Record<string, unknown>;
  const id = str(raw.id);
  if (!id) return c.json({ error: 'id is required' }, 400);
  const row = {
    id,
    createdAt: str(raw.createdAt) ?? now(),
    acoustic: str(raw.acoustic) ?? 'unknown',
    tongueVisible: bool(raw.tongueVisible),
    airAtCorners: bool(raw.airAtCorners),
    pattern: str(raw.pattern) ?? 'unknown',
    signalCount: num(raw.signalCount) ?? 0,
  };
  await db(c.env).insert(diagnostics).values(row).onConflictDoNothing({ target: diagnostics.id });
  return c.json(row, 201);
});

/* ---------------------------------------------------------------- progress */

app.get('/api/progress', async (c) => {
  const since = c.req.query('since');
  const database = db(c.env);

  const perLevel = await database
    .select({
      level: trials.level,
      trials: sql<number>`count(*)`,
      passed: sql<number>`sum(case when ${trials.passed} = 1 then 1 else 0 end)`,
      meanCentroid: sql<number>`avg(${trials.centroid})`,
      meanScore: sql<number>`avg(${trials.score})`,
    })
    .from(trials)
    .where(since ? gte(trials.createdAt, since) : undefined)
    .groupBy(trials.level)
    .orderBy(trials.level);

  const recentSessions = await database
    .select()
    .from(sessions)
    .orderBy(desc(sessions.startedAt))
    .limit(20);

  const [agreement] = await database
    .select({
      rated: sql<number>`count(*)`,
      agreed: sql<number>`sum(case when (${trials.selfRating} = 'good') = (${trials.passed} = 1) then 1 else 0 end)`,
    })
    .from(trials)
    .where(sql`${trials.selfRating} is not null`);

  return c.json({
    perLevel,
    sessions: recentSessions,
    selfRating: {
      rated: agreement?.rated ?? 0,
      agreed: agreement?.agreed ?? 0,
    },
  });
});

/* --------------------------------------------------------- not yet built */

app.post('/api/score/phoneme', (c) =>
  c.json({ error: 'Phoneme scoring arrives in Phase 4.' }, 501),
);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return null;
}

export default app;
