import type { FrameFeatures } from '@delisp/dsp';

/** Registered name of the AudioWorkletProcessor. */
export const FEATURE_PROCESSOR = 'feature-processor';

/** Path the worklet is served from. Registered with an absolute URL (spec §7). */
export const FEATURE_WORKLET_PATH = 'worklets/feature-processor.js';

/** One analysis frame, with the audio-thread timestamp of its last sample. */
export interface TimedFrame extends FrameFeatures {
  /** AudioContext time at the end of the frame, in seconds. */
  t: number;
}

/** Batch of frames posted from the audio thread to the main thread. */
export interface FramesMessage {
  type: 'frames';
  frames: TimedFrame[];
}

/** Sent once on start so the main thread can confirm the real capture rate. */
export interface ReadyMessage {
  type: 'ready';
  sampleRate: number;
  fftSize: number;
  hopSize: number;
}

export type WorkletMessage = FramesMessage | ReadyMessage;
