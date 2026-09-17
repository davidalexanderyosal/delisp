import { and, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { recordings } from '@delisp/schema';
import type { Env } from './env';

export type RecordingKind = 'trial' | 'baseline' | 'calibration';

/**
 * Retention, spec §4: trial audio is deleted after 90 days; baselines and
 * calibrations are kept, because the whole point of a baseline is comparing this
 * month to six months ago.
 */
export const TRIAL_RETENTION_DAYS = 90;

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

/** The browser gives whatever MIME it likes; store it as-is (spec §3.1). */
export function extensionFor(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS[base] ?? 'bin';
}

/**
 * Keys are date-partitioned so the retention sweep can be reasoned about by
 * looking at the bucket, and so one prefix never accumulates every object.
 */
export function recordingKey(kind: RecordingKind, id: string, mime: string, at = new Date()): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${year}/${month}/${id}.${extensionFor(mime)}`;
}

export interface StoreOptions {
  kind: RecordingKind;
  id: string;
  mime: string;
  durationMs: number | null;
  body: ArrayBuffer;
  at?: Date;
}

export async function storeRecording(env: Env, options: StoreOptions): Promise<string> {
  const at = options.at ?? new Date();
  const key = recordingKey(options.kind, options.id, options.mime, at);

  await env.AUDIO.put(key, options.body, {
    httpMetadata: { contentType: options.mime },
  });

  await drizzle(env.DB)
    .insert(recordings)
    .values({
      key,
      kind: options.kind,
      mime: options.mime,
      durationMs: options.durationMs,
      createdAt: at.toISOString(),
    })
    .onConflictDoNothing({ target: recordings.key });

  return key;
}

export interface PurgeResult {
  deleted: number;
  keys: string[];
}

/**
 * Deletes trial audio older than the retention window, from R2 and from the
 * index. Run on a schedule; safe to run repeatedly.
 *
 * The R2 delete happens first: an object with no row is invisible and will never
 * be cleaned up, whereas a row with no object is detected the next time anything
 * tries to read it.
 */
export async function purgeExpiredTrialAudio(
  env: Env,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - TRIAL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const database = drizzle(env.DB);

  const expired = await database
    .select({ key: recordings.key })
    .from(recordings)
    .where(and(eq(recordings.kind, 'trial'), lt(recordings.createdAt, cutoff)));

  if (expired.length === 0) return { deleted: 0, keys: [] };

  const keys = expired.map((row) => row.key);
  await env.AUDIO.delete(keys);
  for (const key of keys) {
    await database.delete(recordings).where(eq(recordings.key, key));
  }

  return { deleted: keys.length, keys };
}
