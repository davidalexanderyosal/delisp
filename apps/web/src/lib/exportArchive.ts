import type { ApiClient, BaselineRow } from './api';
import { exportAll } from './db';
import { type ZipEntry, createZip, safeEntryName } from './zip';

/**
 * "Export of all data as JSON + zip of baselines" (spec §8, Phase 5).
 *
 * The JSON is the record; the baseline audio is the thing that cannot be
 * regenerated. A baseline that fails to download is noted in the manifest rather
 * than aborting the export — a partial archive is worth far more than none, and
 * the manifest says exactly what is missing.
 */

export interface ExportResult {
  blob: Blob;
  baselinesIncluded: number;
  baselinesFailed: string[];
}

export interface ExportOptions {
  /** Fetches one baseline's bytes. Injected so the assembly can be tested. */
  fetchAudio: (row: BaselineRow) => Promise<Uint8Array>;
  listBaselines: () => Promise<BaselineRow[]>;
  /** Defaults to the IndexedDB dump; injected so assembly can be tested. */
  loadData?: () => Promise<Record<string, unknown>>;
  onProgress?: (done: number, total: number) => void;
  now?: () => Date;
}

const encoder = new TextEncoder();

export async function buildExportArchive(options: ExportOptions): Promise<ExportResult> {
  const now = options.now?.() ?? new Date();
  const data = await (options.loadData ?? exportAll)();

  let baselines: BaselineRow[] = [];
  let listFailed: string | null = null;
  try {
    baselines = await options.listBaselines();
  } catch (err) {
    // No server, or no baselines endpoint: the local data still exports.
    listFailed = err instanceof Error ? err.message : String(err);
  }

  const entries: ZipEntry[] = [];
  const failed: string[] = [];

  options.onProgress?.(0, baselines.length);
  for (const [index, row] of baselines.entries()) {
    try {
      const bytes = await options.fetchAudio(row);
      entries.push({
        name: `baselines/${safeEntryName(row.key)}`,
        data: bytes,
        date: new Date(row.createdAt),
      });
    } catch {
      failed.push(row.key);
    }
    options.onProgress?.(index + 1, baselines.length);
  }

  const manifest = {
    exportedAt: now.toISOString(),
    contents: {
      'data.json': 'Every session, trial, calibration, diagnostic and progression row.',
      'baselines/': 'Weekly free-speech recordings, under their storage keys.',
    },
    baselines: {
      listed: baselines.length,
      included: entries.length,
      missing: failed,
      ...(listFailed ? { listError: listFailed } : {}),
    },
  };

  entries.unshift(
    { name: 'data.json', data: encoder.encode(JSON.stringify(data, null, 2)), date: now },
    { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)), date: now },
  );

  return {
    blob: new Blob([createZip(entries)], { type: 'application/zip' }),
    baselinesIncluded: entries.length - 2,
    baselinesFailed: failed,
  };
}

/** The download filename, dated so successive exports do not overwrite. */
export function archiveName(now: Date = new Date()): string {
  return `delisp-export-${now.toISOString().slice(0, 10)}.zip`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Wires the archive builder to the real API client. */
export function apiExportOptions(client: ApiClient): Omit<ExportOptions, 'onProgress'> {
  return {
    listBaselines: () => client.baselines(),
    fetchAudio: async (row) => {
      const response = await fetch(client.recordingUrl(row.key), { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`could not fetch ${row.key}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
