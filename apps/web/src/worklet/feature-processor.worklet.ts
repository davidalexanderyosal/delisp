import { DEFAULT_FFT_SIZE, FeatureExtractor, featureConfig } from '@delisp/dsp';
import {
  FEATURE_PROCESSOR,
  type FramesMessage,
  type ReadyMessage,
  type TimedFrame,
} from '../lib/audio/worklet-protocol.js';

// Minimal declarations for the AudioWorklet global scope. Declared here rather
// than pulled in as a types package so the worklet build stays dependency-free.
declare const sampleRate: number;
declare const currentTime: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  },
): void;

const FFT_SIZE = DEFAULT_FFT_SIZE;
const HOP_SIZE = FFT_SIZE / 2;

/**
 * Frames are computed at sampleRate/HOP ≈ 47 Hz but posted in batches every
 * POST_INTERVAL seconds, giving the ~20 posts/s the spec asks for (§3.1) while
 * still handing the main thread every frame. Dropping frames would corrupt
 * `sDurationMs` and the zone hit rate, which count frames.
 */
const POST_INTERVAL = 0.05;

class FeatureProcessor extends AudioWorkletProcessor {
  private readonly extractor = new FeatureExtractor(featureConfig(sampleRate));
  private readonly buffer = new Float32Array(FFT_SIZE);
  private filled = 0;
  private pending: TimedFrame[] = [];
  private lastPost = 0;

  constructor() {
    super();
    const ready: ReadyMessage = {
      type: 'ready',
      sampleRate,
      fftSize: FFT_SIZE,
      hopSize: HOP_SIZE,
    };
    this.port.postMessage(ready);
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      this.ingest(channel);
    }

    if (this.pending.length > 0 && currentTime - this.lastPost >= POST_INTERVAL) {
      const message: FramesMessage = { type: 'frames', frames: this.pending };
      this.port.postMessage(message);
      this.pending = [];
      this.lastPost = currentTime;
    }

    // Stay alive even through silence: the node is torn down from the main
    // thread when the session ends.
    return true;
  }

  private ingest(channel: Float32Array): void {
    let offset = 0;
    while (offset < channel.length) {
      const room = FFT_SIZE - this.filled;
      const take = Math.min(room, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === FFT_SIZE) {
        const features = this.extractor.compute(this.buffer);
        this.pending.push({ ...features, t: currentTime });
        // Slide by one hop: 50% overlap.
        this.buffer.copyWithin(0, HOP_SIZE);
        this.filled = HOP_SIZE;
      }
    }
  }
}

registerProcessor(FEATURE_PROCESSOR, FeatureProcessor);
