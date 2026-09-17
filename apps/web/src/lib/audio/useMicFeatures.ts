import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { MIN_SAMPLE_RATE } from '../config';
import { pickMimeType } from '../recording';
import {
  FEATURE_PROCESSOR,
  FEATURE_WORKLET_PATH,
  type TimedFrame,
  type WorkletMessage,
} from './worklet-protocol';

export type MicStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'denied'
  | 'unsupported'
  | 'error';

export interface MicState {
  status: MicStatus;
  error: string | null;
  /** The rate the browser actually gave us, which is not always what we asked for. */
  sampleRate: number | null;
  deviceLabel: string | null;
  /** True when Nyquist no longer covers the /s/ region (spec §3.1). */
  lowSampleRate: boolean;
}

export interface MicController {
  state: MicState;
  /** Newest frame. A ref, not state: the gauge reads it under rAF. */
  latest: MutableRefObject<TimedFrame | null>;
  /** Must be called from inside a tap handler — iOS will not resume otherwise. */
  start: () => Promise<void>;
  stop: () => void;
  /** Pass `record` to also capture the audio itself, for transcription. */
  beginCapture: (record?: boolean) => void;
  endCapture: () => TimedFrame[];
  /**
   * The clip from the capture that just ended, or null when none was recorded.
   * Resolves once MediaRecorder has flushed, which is not immediate.
   */
  takeRecording: () => Promise<Blob | null>;
  capturing: boolean;
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    // Browser DSP smears the 4–8 kHz energy this app measures (spec §3.1).
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000,
  } as MediaTrackConstraints,
  video: false,
};

function workletUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(`${base}${FEATURE_WORKLET_PATH}`.replace(/\/{2,}/g, '/'), window.location.origin).href;
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function useMicFeatures(): MicController {
  const [state, setState] = useState<MicState>({
    status: 'idle',
    error: null,
    sampleRate: null,
    deviceLabel: null,
    lowSampleRate: false,
  });
  const [capturing, setCapturing] = useState(false);

  const latest = useRef<TimedFrame | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const capturingRef = useRef(false);
  const bufferRef = useRef<TimedFrame[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef<Promise<Blob | null> | null>(null);

  const teardown = useCallback(() => {
    capturingRef.current = false;
    if (recorderRef.current?.state === 'recording') {
      try {
        recorderRef.current.stop();
      } catch {
        // Already stopping; nothing to do.
      }
    }
    recorderRef.current = null;
    recordingRef.current = null;
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    sinkRef.current?.disconnect();
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    void ctxRef.current?.close().catch(() => undefined);
    nodeRef.current = null;
    sourceRef.current = null;
    sinkRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    latest.current = null;
  }, []);

  const stop = useCallback(() => {
    teardown();
    setCapturing(false);
    setState((s) => ({ ...s, status: 'idle', error: null }));
  }, [teardown]);

  const start = useCallback(async () => {
    // Resuming a context suspended by a tab switch is the cheap path.
    const existing = ctxRef.current;
    if (existing && existing.state === 'suspended') {
      await existing.resume();
      setState((s) => ({ ...s, status: 'running' }));
      return;
    }
    if (existing && existing.state === 'running') {
      setState((s) => ({ ...s, status: 'running' }));
      return;
    }

    const Ctor = audioContextCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      setState((s) => ({
        ...s,
        status: 'unsupported',
        error: 'This browser has no AudioWorklet or microphone support.',
      }));
      return;
    }

    setState((s) => ({ ...s, status: 'starting', error: null }));

    try {
      const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      streamRef.current = stream;

      const ctx = new Ctor();
      ctxRef.current = ctx;
      // iOS starts every context suspended; this only works inside a gesture.
      await ctx.resume();

      await ctx.audioWorklet.addModule(workletUrl());

      const node = new AudioWorkletNode(ctx, FEATURE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        const message = event.data;
        if (message.type !== 'frames') return;
        const frames = message.frames;
        const last = frames.at(-1);
        if (last) latest.current = last;
        if (capturingRef.current) bufferRef.current.push(...frames);
      };
      nodeRef.current = node;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Chrome only pulls a worklet that reaches the destination. Route it
      // through a muted gain so nothing is ever played back.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sinkRef.current = sink;

      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      const track = stream.getAudioTracks()[0];
      const label = track?.label || track?.getSettings().deviceId || null;

      setState({
        status: 'running',
        error: null,
        sampleRate: ctx.sampleRate,
        deviceLabel: label,
        lowSampleRate: ctx.sampleRate < MIN_SAMPLE_RATE,
      });
    } catch (err) {
      teardown();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState((s) => ({
          ...s,
          status: 'denied',
          error: 'Microphone access was refused. Allow it in your browser settings and tap again.',
        }));
      } else {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'Could not start the microphone.',
        }));
      }
    }
  }, [teardown]);

  const beginCapture = useCallback((record = false) => {
    bufferRef.current = [];
    capturingRef.current = true;
    setCapturing(true);
    recordingRef.current = null;

    const stream = streamRef.current;
    if (!record || !stream || typeof MediaRecorder === 'undefined') return;

    // MediaRecorder runs alongside the worklet on the same stream (spec §3.1):
    // the features are computed regardless, and the clip is only for the levels
    // that need transcribing.
    try {
      const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recordingRef.current = new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => {
          const type = recorder.mimeType || mimeType || 'audio/webm';
          resolve(chunksRef.current.length === 0 ? null : new Blob(chunksRef.current, { type }));
        };
        recorder.onerror = () => resolve(null);
      });
      recorder.start();
      recorderRef.current = recorder;
    } catch {
      // A browser that refuses to record still gets the gauge; the level that
      // needed the clip will report that it could not be scored.
      recordingRef.current = null;
    }
  }, []);

  const endCapture = useCallback((): TimedFrame[] => {
    capturingRef.current = false;
    setCapturing(false);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    const frames = bufferRef.current;
    bufferRef.current = [];
    return frames;
  }, []);

  const takeRecording = useCallback((): Promise<Blob | null> => {
    const pending = recordingRef.current;
    recordingRef.current = null;
    return pending ?? Promise.resolve(null);
  }, []);

  // Foreground only (spec §3.1): a backgrounded tab gets throttled or killed
  // mid-recording, which would silently truncate a trial.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      const ctx = ctxRef.current;
      if (!ctx || ctx.state === 'closed') return;
      capturingRef.current = false;
      bufferRef.current = [];
      setCapturing(false);
      void ctx.suspend().catch(() => undefined);
      setState((s) => (s.status === 'running' ? { ...s, status: 'paused' } : s));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => teardown, [teardown]);

  return { state, latest, start, stop, beginCapture, endCapture, takeRecording, capturing };
}
