import { describe, expect, it, vi } from 'vitest';
import type { BaselineRow } from '../src/lib/api';
import { archiveName, buildExportArchive } from '../src/lib/exportArchive';

const encoder = new TextEncoder();

function baseline(key: string, createdAt = '2026-03-09T10:00:00.000Z'): BaselineRow {
  return {
    key,
    kind: 'baseline',
    mime: 'audio/webm',
    durationMs: 60000,
    createdAt,
    transcript: 'a transcript',
    wpm: 130,
  };
}

const loadData = async () => ({ sessions: [{ id: 'ses_1' }], trials: [] });

/** Reads the entry names straight out of the archive's central directory. */
async function entryNames(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const names: string[] = [];
  for (let i = 0; i < bytes.length - 4; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    names.push(new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLength)));
  }
  return names;
}

describe('buildExportArchive', () => {
  it('always includes the data dump and a manifest', async () => {
    const result = await buildExportArchive({
      loadData,
      listBaselines: async () => [],
      fetchAudio: async () => new Uint8Array(0),
    });
    expect(await entryNames(result.blob)).toEqual(['data.json', 'manifest.json']);
    expect(result.baselinesIncluded).toBe(0);
    expect(result.blob.type).toBe('application/zip');
  });

  it('includes each baseline under its storage key', async () => {
    const result = await buildExportArchive({
      loadData,
      listBaselines: async () => [baseline('baseline/2026/01/a.webm'), baseline('baseline/2026/03/b.webm')],
      fetchAudio: async () => encoder.encode('audio'),
    });
    expect(await entryNames(result.blob)).toEqual([
      'data.json',
      'manifest.json',
      'baselines/baseline/2026/01/a.webm',
      'baselines/baseline/2026/03/b.webm',
    ]);
    expect(result.baselinesIncluded).toBe(2);
  });

  it('keeps going when one baseline cannot be fetched', async () => {
    // A partial archive is worth far more than none; the manifest says which.
    const result = await buildExportArchive({
      loadData,
      listBaselines: async () => [baseline('good.webm'), baseline('bad.webm'), baseline('also-good.webm')],
      fetchAudio: async (row) => {
        if (row.key === 'bad.webm') throw new Error('gone');
        return encoder.encode('audio');
      },
    });
    expect(result.baselinesIncluded).toBe(2);
    expect(result.baselinesFailed).toEqual(['bad.webm']);
    expect(await entryNames(result.blob)).toContain('baselines/good.webm');
    expect(await entryNames(result.blob)).not.toContain('baselines/bad.webm');
  });

  it('still exports the local data when the server cannot be reached at all', async () => {
    const result = await buildExportArchive({
      loadData,
      listBaselines: async () => {
        throw new Error('offline');
      },
      fetchAudio: async () => new Uint8Array(0),
    });
    expect(await entryNames(result.blob)).toEqual(['data.json', 'manifest.json']);
    expect(result.baselinesIncluded).toBe(0);
  });

  it('reports progress so a slow export can show it', async () => {
    const onProgress = vi.fn();
    await buildExportArchive({
      loadData,
      listBaselines: async () => [baseline('a.webm'), baseline('b.webm')],
      fetchAudio: async () => encoder.encode('audio'),
      onProgress,
    });
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe('archiveName', () => {
  it('is dated, so successive exports do not overwrite each other', () => {
    expect(archiveName(new Date('2026-03-09T10:00:00.000Z'))).toBe('delisp-export-2026-03-09.zip');
  });
});
