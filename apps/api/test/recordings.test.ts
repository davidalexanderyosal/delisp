import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { parseTranscription, workersAiTranscriber } from '../src/asr';
import {
  TRIAL_RETENTION_DAYS,
  extensionFor,
  purgeExpiredTrialAudio,
  recordingKey,
} from '../src/recordings';

const NOW = new Date('2026-06-01T00:00:00.000Z');

/** A fake Workers AI binding: the real one cannot run in the test runtime. */
function fakeAi(text: string, { fail = false } = {}) {
  return {
    run: vi.fn(async (_model: string, _input: Record<string, unknown>): Promise<unknown> => {
      if (fail) throw new Error('AI is down');
      return { text };
    }),
  };
}

type FakeAi = ReturnType<typeof fakeAi>;

function envWith(ai: FakeAi): typeof env {
  return { ...env, AI: ai as unknown as Ai };
}

function audio(bytes = 32): ArrayBuffer {
  return new Uint8Array(Array.from({ length: bytes }, (_, i) => i % 256)).buffer;
}

async function post(
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
  e: typeof env = env,
) {
  return app.fetch(new Request(`https://api.test${path}`, { method: 'POST', body, headers }), e);
}

beforeEach(async () => {
  for (const table of ['recordings', 'trials', 'sessions', 'exercises']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const listed = await env.AUDIO.list();
  for (const object of listed.objects) await env.AUDIO.delete(object.key);
});

describe('recording keys', () => {
  it('uses the extension the browser MIME implies', () => {
    // iOS gives audio/mp4, Android gives audio/webm — both are stored as-is.
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/wav')).toBe('wav');
  });

  it('falls back rather than throwing on a MIME it does not know', () => {
    expect(extensionFor('audio/something-new')).toBe('bin');
    expect(extensionFor('')).toBe('bin');
  });

  it('partitions by kind and month', () => {
    expect(recordingKey('trial', 'trl_1', 'audio/webm', NOW)).toBe('trial/2026/06/trl_1.webm');
    expect(recordingKey('baseline', 'b_1', 'audio/mp4', NOW)).toBe('baseline/2026/06/b_1.m4a');
  });
});

describe('POST /api/recordings', () => {
  it('stores the bytes in R2 and indexes them in D1', async () => {
    const response = await post('/api/recordings?kind=trial&id=trl_1&durationMs=1800', audio(), {
      'Content-Type': 'audio/webm',
    });
    expect(response.status).toBe(201);
    const { key } = (await response.json()) as { key: string };
    expect(key).toMatch(/^trial\/\d{4}\/\d{2}\/trl_1\.webm$/);

    const object = await env.AUDIO.get(key);
    expect(object).not.toBeNull();
    expect((await object!.arrayBuffer()).byteLength).toBe(32);

    const { results } = await env.DB.prepare('SELECT * FROM recordings WHERE key = ?').bind(key).all();
    expect(results[0]!.kind).toBe('trial');
    expect(results[0]!.mime).toBe('audio/webm');
    expect(results[0]!.duration_ms).toBe(1800);
  });

  it('refuses an unknown kind', async () => {
    const response = await post('/api/recordings?kind=nonsense&id=x', audio());
    expect(response.status).toBe(400);
  });

  it('refuses an empty body rather than storing a zero-byte clip', async () => {
    const response = await post('/api/recordings?kind=trial&id=trl_1', new ArrayBuffer(0));
    expect(response.status).toBe(400);
  });

  it('serves a stored recording back', async () => {
    const stored = await post('/api/recordings?kind=baseline&id=b_1', audio(), {
      'Content-Type': 'audio/webm',
    });
    const { key } = (await stored.json()) as { key: string };
    const response = await app.fetch(new Request(`https://api.test/api/recordings/${key}`), env);
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(32);
  });

  it('404s for a key that is not there', async () => {
    const response = await app.fetch(
      new Request('https://api.test/api/recordings/trial/2020/01/nope.webm'),
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('POST /api/score/asr', () => {
  async function store(id = 'trl_1'): Promise<string> {
    const response = await post(`/api/recordings?kind=trial&id=${id}`, audio(), {
      'Content-Type': 'audio/webm',
    });
    return ((await response.json()) as { key: string }).key;
  }

  it('passes a clip transcribed as the target', async () => {
    const key = await store();
    const response = await app.fetch(
      new Request('https://api.test/api/score/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, target: 'sink', minimalPair: 'think' }),
      }),
      envWith(fakeAi('Sink.')),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ match: true, reason: 'exact' });
  });

  it('fails a clip transcribed as the minimal pair, and says which', async () => {
    const key = await store();
    const response = await app.fetch(
      new Request('https://api.test/api/score/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, target: 'sink', minimalPair: 'think' }),
      }),
      envWith(fakeAi('think')),
    );
    const body = (await response.json()) as {
      match: boolean;
      reason: string;
      substitutions: { expected: string; heard: string }[];
    };
    expect(body.match).toBe(false);
    expect(body.reason).toBe('minimal-pair');
    expect(body.substitutions[0]).toMatchObject({ expected: 'sink', heard: 'think' });
  });

  it('biases recognition toward the target and its contrast', async () => {
    const key = await store();
    const ai = fakeAi('sink');
    await app.fetch(
      new Request('https://api.test/api/score/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, target: 'sink', minimalPair: 'think' }),
      }),
      envWith(ai),
    );
    const input = ai.run.mock.calls[0]![1] as unknown as { prompt?: string; audio: number[] };
    expect(input.prompt).toContain('sink');
    expect(input.prompt).toContain('think');
    expect(input.audio.length).toBe(32);
  });

  it('writes the result back onto the trial when one is named', async () => {
    await env.DB.prepare(
      'INSERT INTO exercises (id, level, sound, text) VALUES (?, ?, ?, ?)',
    )
      .bind('l5-sink', 5, 's', 'sink')
      .run();
    await env.DB.prepare(
      'INSERT INTO sessions (id, started_at, level, trial_count) VALUES (?, ?, ?, ?)',
    )
      .bind('ses_1', NOW.toISOString(), 5, 0)
      .run();
    await env.DB.prepare(
      'INSERT INTO trials (id, session_id, exercise_id, level, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('trl_1', 'ses_1', 'l5-sink', 5, NOW.toISOString())
      .run();

    const key = await store();
    await app.fetch(
      new Request('https://api.test/api/score/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, target: 'sink', minimalPair: 'think', trialId: 'trl_1' }),
      }),
      envWith(fakeAi('think')),
    );

    const { results } = await env.DB.prepare(
      'SELECT asr_text, asr_match, recording_key FROM trials WHERE id = ?',
    )
      .bind('trl_1')
      .all();
    expect(results[0]!.asr_text).toBe('think');
    expect(results[0]!.asr_match).toBe(0);
    expect(results[0]!.recording_key).toBe(key);
  });

  it('404s when the key names no stored recording', async () => {
    const response = await app.fetch(
      new Request('https://api.test/api/score/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'trial/2020/01/nope.webm', target: 'sink' }),
      }),
      envWith(fakeAi('sink')),
    );
    expect(response.status).toBe(404);
  });

  it('reports a transcription failure as a bad gateway, not a 500', async () => {
    const key = await store();
    const response = await app.fetch(
      new Request('https://api.test/api/score/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, target: 'sink' }),
      }),
      envWith(fakeAi('', { fail: true })),
    );
    expect(response.status).toBe(502);
  });
});

describe('POST /api/baseline', () => {
  it('stores the clip, transcribes it and computes words per minute', async () => {
    const response = await post(
      '/api/baseline?id=base_1&durationMs=60000',
      audio(),
      { 'Content-Type': 'audio/webm' },
      envWith(fakeAi('one two three four five six')),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { key: string; transcript: string; wpm: number };
    expect(body.transcript).toBe('one two three four five six');
    expect(body.wpm).toBe(6);

    const { results } = await env.DB.prepare('SELECT * FROM recordings WHERE key = ?')
      .bind(body.key)
      .all();
    expect(results[0]!.kind).toBe('baseline');
    expect(results[0]!.wpm).toBe(6);
  });

  it('keeps the audio even when transcription fails', async () => {
    // A baseline cannot be recorded again; losing it to an AI outage would be
    // the worst possible failure mode here.
    const response = await post(
      '/api/baseline?id=base_2&durationMs=60000',
      audio(),
      { 'Content-Type': 'audio/webm' },
      envWith(fakeAi('', { fail: true })),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { key: string; transcript: string | null };
    expect(body.transcript).toBeNull();
    expect(await env.AUDIO.get(body.key)).not.toBeNull();
  });

  it('lists baselines newest first', async () => {
    await post('/api/baseline?id=b1&durationMs=1000', audio(), {}, envWith(fakeAi('a')));
    await post('/api/baseline?id=b2&durationMs=1000', audio(), {}, envWith(fakeAi('b')));
    const rows = (await (await app.fetch(new Request('https://api.test/api/baselines'), env)).json()) as {
      key: string;
    }[];
    expect(rows.length).toBe(2);
  });
});

describe('retention sweep', () => {
  async function storeAt(kind: string, id: string, createdAt: string): Promise<string> {
    const key = `${kind}/2026/01/${id}.webm`;
    await env.AUDIO.put(key, audio());
    await env.DB.prepare(
      'INSERT INTO recordings (key, kind, mime, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(key, kind, 'audio/webm', createdAt)
      .run();
    return key;
  }

  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it('deletes trial audio past the retention window, from R2 and the index', async () => {
    const old = await storeAt('trial', 'old', daysAgo(TRIAL_RETENTION_DAYS + 1));
    const recent = await storeAt('trial', 'recent', daysAgo(1));

    const result = await purgeExpiredTrialAudio(env, NOW);
    expect(result.deleted).toBe(1);
    expect(result.keys).toEqual([old]);
    expect(await env.AUDIO.get(old)).toBeNull();
    expect(await env.AUDIO.get(recent)).not.toBeNull();

    const { results } = await env.DB.prepare('SELECT key FROM recordings ORDER BY key').all();
    expect(results.map((r) => r.key)).toEqual([recent]);
  });

  it('never deletes a baseline, however old', async () => {
    const baseline = await storeAt('baseline', 'ancient', daysAgo(1000));
    const calibration = await storeAt('calibration', 'ancient', daysAgo(1000));
    const result = await purgeExpiredTrialAudio(env, NOW);
    expect(result.deleted).toBe(0);
    expect(await env.AUDIO.get(baseline)).not.toBeNull();
    expect(await env.AUDIO.get(calibration)).not.toBeNull();
  });

  it('is safe to run twice', async () => {
    await storeAt('trial', 'old', daysAgo(TRIAL_RETENTION_DAYS + 1));
    expect((await purgeExpiredTrialAudio(env, NOW)).deleted).toBe(1);
    expect((await purgeExpiredTrialAudio(env, NOW)).deleted).toBe(0);
  });

  it('does nothing when there is nothing to delete', async () => {
    expect(await purgeExpiredTrialAudio(env, NOW)).toEqual({ deleted: 0, keys: [] });
  });
});

describe('parseTranscription', () => {
  it('reads the documented shape', () => {
    expect(parseTranscription({ text: 'sun', word_count: 1 })).toEqual({
      text: 'sun',
      wordCount: 1,
    });
  });

  it('accepts a bare string, as some model versions return', () => {
    expect(parseTranscription('sun')).toEqual({ text: 'sun', wordCount: null });
  });

  it('degrades to an empty transcript rather than throwing on a shape it does not know', () => {
    expect(parseTranscription(null).text).toBe('');
    expect(parseTranscription({ unexpected: true }).text).toBe('');
    expect(parseTranscription(42).text).toBe('');
  });
});

describe('workersAiTranscriber', () => {
  it('omits the prompt when there is no vocabulary to bias toward', async () => {
    const ai = fakeAi('sun');
    await workersAiTranscriber(ai).transcribe(new Uint8Array([1, 2, 3]));
    const input = ai.run.mock.calls[0]![1] as unknown as { prompt?: string };
    expect(input.prompt).toBeUndefined();
  });
});
