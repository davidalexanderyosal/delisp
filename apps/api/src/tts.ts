import type { AiLike } from './asr';

/**
 * Model audio for the shadowing drill (spec §6: "generate with a TTS voice for
 * v1 (batch script → R2), replace selectively with human clips later").
 *
 * Generation lives in the Worker rather than a standalone script because the AI
 * and R2 bindings are already here: a script would otherwise need its own
 * Cloudflare credentials and an S3-compatible R2 client, for a job that runs
 * once per exercise.
 */

export const TTS_MODEL = '@cf/myshell-ai/melotts';

export interface SynthesisResult {
  bytes: Uint8Array;
  mime: string;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads whatever the model returned. Like the Whisper parser, this is
 * deliberately tolerant: the response shape has moved between model versions,
 * and the failure mode should be a clear error rather than a crash.
 */
export async function parseSynthesis(raw: unknown): Promise<SynthesisResult> {
  if (raw instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(raw), mime: 'audio/mpeg' };
  }
  if (raw instanceof ReadableStream) {
    return { bytes: new Uint8Array(await new Response(raw).arrayBuffer()), mime: 'audio/mpeg' };
  }
  if (raw && typeof raw === 'object') {
    const body = raw as Record<string, unknown>;
    if (typeof body.audio === 'string') {
      return { bytes: base64ToBytes(body.audio), mime: 'audio/mpeg' };
    }
    if (body.audio instanceof ArrayBuffer) {
      return { bytes: new Uint8Array(body.audio), mime: 'audio/mpeg' };
    }
  }
  throw new Error('unrecognised text-to-speech response');
}

export interface Synthesiser {
  speak(text: string, options?: { lang?: string }): Promise<SynthesisResult>;
}

export function workersAiSynthesiser(ai: AiLike, model: string = TTS_MODEL): Synthesiser {
  return {
    async speak(text, options) {
      const raw = await ai.run(model, { prompt: text, lang: options?.lang ?? 'en' });
      return parseSynthesis(raw);
    },
  };
}

/** Deterministic key, so regenerating a clip replaces it rather than piling up. */
export function modelAudioKey(exerciseId: string): string {
  return `model/${exerciseId}.mp3`;
}
