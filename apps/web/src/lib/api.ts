import type { DiagnosticRow, Settings, TrialRow } from './db';
import type { ProgressionRow } from './progression';

/**
 * Client for the Hono Worker (spec §5).
 *
 * Same-origin by design: the Worker is routed on the app's own hostname so
 * Cloudflare Access covers both with one policy and the browser never makes a
 * cross-origin request. That also means the Access cookie rides along without
 * anything here handling a token.
 */

export interface SessionPayload {
  id: string;
  startedAt: string;
  endedAt: string | null;
  level: number;
  trialCount: number;
}

export interface AsrRequest {
  key: string;
  target: string;
  minimalPair?: string | null;
  trialId?: string;
}

export interface AsrResponse {
  text: string;
  match: boolean;
  reason: string;
  substitutions: { expected: string; heard: string; position: number }[];
}

export interface ProgressResponse {
  perLevel: {
    level: number;
    trials: number;
    passed: number;
    meanCentroid: number | null;
    meanScore: number | null;
  }[];
  sessions: SessionPayload[];
  selfRating: { rated: number; agreed: number };
}

export interface BaselineRow {
  key: string;
  kind: string;
  mime: string;
  durationMs: number | null;
  createdAt: string;
  transcript: string | null;
  wpm: number | null;
}

export interface BaselineResponse {
  key: string;
  transcript: string | null;
  wpm: number | null;
  durationMs: number | null;
}

export interface ModelAudioRow {
  id: string;
  level: number;
  sound: string;
  position: string | null;
  text: string;
  minimalPair: string | null;
  modelAudioKey: string | null;
  tags: string | null;
}

export interface ApiClient {
  health(): Promise<boolean>;
  /** Exercises that have a synthesised model clip, for shadowing. */
  modelAudio(): Promise<ModelAudioRow[]>;
  generateModelAudio(exerciseId: string, force?: boolean): Promise<{ key: string; generated: boolean }>;
  postBaseline(id: string, blob: Blob, durationMs: number): Promise<BaselineResponse>;
  baselines(): Promise<BaselineRow[]>;
  /** Same-origin URL a browser audio element can play. */
  recordingUrl(key: string): string;
  putSettings(settings: Settings): Promise<void>;
  postSession(session: SessionPayload): Promise<void>;
  postTrials(trials: readonly TrialRow[]): Promise<void>;
  putProgression(rows: readonly ProgressionRow[]): Promise<void>;
  postDiagnostic(row: DiagnosticRow): Promise<void>;
  postRecording(
    kind: 'trial' | 'baseline' | 'calibration',
    id: string,
    blob: Blob,
    durationMs: number,
  ): Promise<string>;
  scoreAsr(request: AsrRequest): Promise<AsrResponse>;
  progress(): Promise<ProgressResponse>;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function unwrap(response: Response): Promise<unknown> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // A non-JSON error body is no less of an error.
    }
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? null : response.json();
}

export function httpClient(baseUrl = ''): ApiClient {
  const url = (path: string) => `${baseUrl}${path}`;
  const send = (path: string, method: string, body: unknown) =>
    fetch(url(path), {
      method,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    }).then(unwrap);

  return {
    async health() {
      try {
        const response = await fetch(url('/api/health'), { credentials: 'same-origin' });
        return response.ok;
      } catch {
        return false;
      }
    },
    async putSettings(settings) {
      await send('/api/settings', 'PUT', settings);
    },
    async postSession(session) {
      await send('/api/sessions', 'POST', session);
    },
    async postTrials(trials) {
      await send('/api/trials', 'POST', { trials });
    },
    async putProgression(rows) {
      await send('/api/progression', 'PUT', { rows });
    },
    async postDiagnostic(row) {
      await send('/api/diagnostics', 'POST', row);
    },
    async postBaseline(id, blob, durationMs) {
      const query = new URLSearchParams({ id, durationMs: String(Math.round(durationMs)) });
      const response = await fetch(url(`/api/baseline?${query.toString()}`), {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        credentials: 'same-origin',
        body: blob,
      });
      return (await unwrap(response)) as BaselineResponse;
    },
    async modelAudio() {
      const response = await fetch(url('/api/model-audio'), { credentials: 'same-origin' });
      return (await unwrap(response)) as ModelAudioRow[];
    },
    async generateModelAudio(exerciseId, force = false) {
      return (await send('/api/model-audio', 'POST', { exerciseId, force })) as {
        key: string;
        generated: boolean;
      };
    },
    async baselines() {
      const response = await fetch(url('/api/baselines'), { credentials: 'same-origin' });
      return (await unwrap(response)) as BaselineRow[];
    },
    recordingUrl(key) {
      return url(`/api/recordings/${key}`);
    },
    async postRecording(kind, id, blob, durationMs) {
      const query = new URLSearchParams({ kind, id, durationMs: String(Math.round(durationMs)) });
      const response = await fetch(url(`/api/recordings?${query.toString()}`), {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        credentials: 'same-origin',
        body: blob,
      });
      const body = (await unwrap(response)) as { key: string };
      return body.key;
    },
    async scoreAsr(request) {
      return (await send('/api/score/asr', 'POST', request)) as AsrResponse;
    },
    async progress() {
      const response = await fetch(url('/api/progress'), { credentials: 'same-origin' });
      return (await unwrap(response)) as ProgressResponse;
    },
  };
}
