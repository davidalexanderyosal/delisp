/**
 * Speech-to-text via Workers AI (spec §5).
 *
 * Wrapped behind an interface for two reasons: the AI binding is a proxy to a
 * remote service and cannot be instantiated in the test runtime, and the spec's
 * own open question — whether `@cf/openai/whisper` is accurate enough on 2–3
 * second clips, or whether a vocabulary-biased prompt is required — can only be
 * answered against the real thing. Keeping the call in one place means the
 * answer changes one function rather than three routes.
 */

export interface Transcription {
  text: string;
  /** Present only when the model returns it. */
  wordCount: number | null;
}

export interface Transcriber {
  transcribe(audio: Uint8Array, options?: { vocabulary?: readonly string[] }): Promise<Transcription>;
}

export const WHISPER_MODEL = '@cf/openai/whisper';

/** Minimal shape of the AI binding, so tests can supply a fake. */
export interface AiLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export function workersAiTranscriber(ai: AiLike, model: string = WHISPER_MODEL): Transcriber {
  return {
    async transcribe(audio, options) {
      const input: Record<string, unknown> = {
        // The binding takes the bytes as a plain array of octets.
        audio: Array.from(audio),
      };
      // Biasing recognition toward the words we are expecting. Ignored by models
      // that do not support it, which is why it is sent rather than branched on.
      if (options?.vocabulary && options.vocabulary.length > 0) {
        input.prompt = options.vocabulary.join(', ');
      }

      const raw = await ai.run(model, input);
      return parseTranscription(raw);
    },
  };
}

/**
 * Whisper responses have varied across model versions, so this reads the shape
 * defensively rather than trusting one. Anything unrecognisable becomes an empty
 * transcript, which the matcher reports as 'nothing-heard' — a wrong answer the
 * user can act on, rather than a crash.
 */
export function parseTranscription(raw: unknown): Transcription {
  if (typeof raw === 'string') return { text: raw, wordCount: null };
  if (raw && typeof raw === 'object') {
    const body = raw as Record<string, unknown>;
    const text =
      typeof body.text === 'string'
        ? body.text
        : typeof body.transcription === 'string'
          ? body.transcription
          : '';
    const wordCount = typeof body.word_count === 'number' ? body.word_count : null;
    return { text, wordCount };
  }
  return { text: '', wordCount: null };
}
