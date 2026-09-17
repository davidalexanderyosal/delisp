import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { modelAudioKey, parseSynthesis, workersAiSynthesiser } from '../src/tts';

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00, 0x01]);

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fakeAi(response: unknown, { fail = false } = {}) {
  return {
    run: vi.fn(async (_model: string, _input: Record<string, unknown>): Promise<unknown> => {
      if (fail) throw new Error('TTS is down');
      return response;
    }),
  };
}

function envWith(ai: ReturnType<typeof fakeAi>): typeof env {
  return { ...env, AI: ai as unknown as Ai };
}

async function post(body: unknown, e: typeof env = env): Promise<Response> {
  return app.fetch(
    new Request('https://api.test/api/model-audio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    e,
  );
}

async function seedExercise(id = 'l6-sentence-01', text = 'Sales solutions start simply.') {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO exercises (id, level, sound, position, text) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, 6, 's', 'sentence', text)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM exercises').run();
  const listed = await env.AUDIO.list();
  for (const object of listed.objects) await env.AUDIO.delete(object.key);
});

describe('parseSynthesis', () => {
  it('decodes a base64 audio field', async () => {
    const result = await parseSynthesis({ audio: toBase64(MP3) });
    expect([...result.bytes]).toEqual([...MP3]);
    expect(result.mime).toBe('audio/mpeg');
  });

  it('accepts raw bytes, which some model versions return instead', async () => {
    const result = await parseSynthesis(MP3.buffer);
    expect([...result.bytes]).toEqual([...MP3]);
  });

  it('accepts a stream', async () => {
    const stream = new Response(MP3).body!;
    const result = await parseSynthesis(stream);
    expect([...result.bytes]).toEqual([...MP3]);
  });

  it('throws a clear error on a shape it does not know', async () => {
    await expect(parseSynthesis({ unexpected: true })).rejects.toThrow(/unrecognised/);
    await expect(parseSynthesis(null)).rejects.toThrow(/unrecognised/);
  });
});

describe('modelAudioKey', () => {
  it('derives the key from the exercise, so regenerating replaces the clip', () => {
    expect(modelAudioKey('l6-sentence-01')).toBe('model/l6-sentence-01.mp3');
    expect(modelAudioKey('l6-sentence-01')).toBe(modelAudioKey('l6-sentence-01'));
  });
});

describe('POST /api/model-audio', () => {
  it('synthesises the prompt, stores it and records the key', async () => {
    await seedExercise();
    const ai = fakeAi({ audio: toBase64(MP3) });
    const response = await post({ exerciseId: 'l6-sentence-01' }, envWith(ai));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ key: 'model/l6-sentence-01.mp3', generated: true });
    expect(ai.run.mock.calls[0]![1]).toMatchObject({ prompt: 'Sales solutions start simply.' });

    const object = await env.AUDIO.get('model/l6-sentence-01.mp3');
    expect(object).not.toBeNull();

    const { results } = await env.DB.prepare(
      'SELECT model_audio_key FROM exercises WHERE id = ?',
    )
      .bind('l6-sentence-01')
      .all();
    expect(results[0]!.model_audio_key).toBe('model/l6-sentence-01.mp3');
  });

  it('does not regenerate a clip that already exists', async () => {
    await seedExercise();
    const ai = fakeAi({ audio: toBase64(MP3) });
    await post({ exerciseId: 'l6-sentence-01' }, envWith(ai));

    const again = fakeAi({ audio: toBase64(MP3) });
    const response = await post({ exerciseId: 'l6-sentence-01' }, envWith(again));
    expect(await response.json()).toMatchObject({ generated: false });
    expect(again.run).not.toHaveBeenCalled();
  });

  it('regenerates when forced', async () => {
    await seedExercise();
    await post({ exerciseId: 'l6-sentence-01' }, envWith(fakeAi({ audio: toBase64(MP3) })));
    const ai = fakeAi({ audio: toBase64(MP3) });
    const response = await post({ exerciseId: 'l6-sentence-01', force: true }, envWith(ai));
    expect(await response.json()).toMatchObject({ generated: true });
    expect(ai.run).toHaveBeenCalled();
  });

  it('404s for an exercise that is not in the curriculum', async () => {
    const response = await post({ exerciseId: 'nope' }, envWith(fakeAi({})));
    expect(response.status).toBe(404);
  });

  it('requires an exercise id', async () => {
    expect((await post({}, envWith(fakeAi({})))).status).toBe(400);
  });

  it('reports a synthesis failure as a bad gateway', async () => {
    await seedExercise();
    const response = await post(
      { exerciseId: 'l6-sentence-01' },
      envWith(fakeAi(null, { fail: true })),
    );
    expect(response.status).toBe(502);
  });
});

describe('GET /api/model-audio', () => {
  it('lists only the exercises that have a clip', async () => {
    await seedExercise('with-audio');
    await seedExercise('without-audio');
    await post({ exerciseId: 'with-audio' }, envWith(fakeAi({ audio: toBase64(MP3) })));

    const rows = (await (
      await app.fetch(new Request('https://api.test/api/model-audio'), env)
    ).json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['with-audio']);
  });
});

describe('workersAiSynthesiser', () => {
  it('passes the language through', async () => {
    const ai = fakeAi({ audio: toBase64(MP3) });
    await workersAiSynthesiser(ai).speak('hello', { lang: 'en' });
    expect(ai.run.mock.calls[0]![1]).toMatchObject({ lang: 'en' });
  });
});
