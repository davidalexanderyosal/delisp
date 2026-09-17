/**
 * Waveform peaks for the shadowing view (spec §3.9: "both waveforms shown").
 *
 * The comparison the picture has to support is timing and shape — did the
 * phrase come out with the same rhythm as the model — so the peaks are
 * normalised to the loudest point in each clip. Absolute levels would make the
 * two impossible to compare, since one is a synthesised clip at a fixed level
 * and the other is whatever a phone microphone happened to capture.
 */

export function peaks(samples: Float32Array, buckets: number): number[] {
  if (buckets <= 0) return [];
  if (samples.length === 0) return new Array<number>(buckets).fill(0);

  const out = new Array<number>(buckets).fill(0);
  const per = samples.length / buckets;

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const value = Math.abs(samples[i]!);
      if (value > peak) peak = value;
    }
    out[b] = peak;
  }

  const loudest = Math.max(...out);
  if (loudest <= 0) return out;
  return out.map((value) => value / loudest);
}

/** Mixes every channel down to mono before measuring. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const first = channels[0]!;
  if (channels.length === 1) return first;

  const out = new Float32Array(first.length);
  for (let i = 0; i < first.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

export interface DecodedClip {
  peaks: number[];
  durationMs: number;
}

/**
 * Decodes a clip and reduces it to peaks. A clip the browser cannot decode
 * returns null rather than throwing — the transcript comparison is the part
 * that carries the feedback, and it should not be lost to a codec.
 */
export async function clipPeaks(
  data: ArrayBuffer,
  buckets: number,
  context: BaseAudioContext,
): Promise<DecodedClip | null> {
  try {
    const buffer = await context.decodeAudioData(data.slice(0));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    return {
      peaks: peaks(toMono(channels), buckets),
      durationMs: buffer.duration * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * How the attempt's length compares with the model's. Rhythm is what shadowing
 * trains, and a clip a third shorter than the model is rushed regardless of
 * whether every word survived.
 */
export function timingComment(modelMs: number, mineMs: number): string | null {
  if (modelMs <= 0 || mineMs <= 0) return null;
  const ratio = mineMs / modelMs;
  if (ratio < 0.75) return `You took ${Math.round((1 - ratio) * 100)}% less time than the model — slow down and let the phrase breathe.`;
  if (ratio > 1.35) return `You took ${Math.round((ratio - 1) * 100)}% longer than the model. Careful is fine in a drill, but shadowing is about matching the rhythm.`;
  return 'Your timing is close to the model.';
}
