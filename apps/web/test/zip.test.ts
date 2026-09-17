import { describe, expect, it } from 'vitest';
import { createZip, crc32, dosDateTime, safeEntryName } from '../src/lib/zip';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

function u16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint16(offset, true);
}
function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint32(offset, true);
}

describe('crc32', () => {
  it('matches the published check value', () => {
    // The standard CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('dosDateTime', () => {
  it('packs a date into the MS-DOS fields the format still uses', () => {
    const { time, date } = dosDateTime(new Date(2026, 2, 9, 14, 30, 20));
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(3);
    expect(date & 0x1f).toBe(9);
    expect(time >> 11).toBe(14);
    expect((time >> 5) & 0x3f).toBe(30);
    expect((time & 0x1f) * 2).toBe(20);
  });

  it('clamps a pre-1980 date rather than writing a negative year', () => {
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});

describe('createZip', () => {
  it('writes a local header, the data, a central directory and an EOCD', () => {
    const zip = createZip([{ name: 'a.txt', data: bytes('hello'), date: new Date(2026, 2, 9) }]);

    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(u16(zip, 8)).toBe(0); // stored, not deflated
    expect(u32(zip, 14)).toBe(crc32(bytes('hello')));
    expect(u32(zip, 18)).toBe(5); // compressed size
    expect(u32(zip, 22)).toBe(5); // uncompressed size

    const eocdOffset = zip.length - 22;
    expect(u32(zip, eocdOffset)).toBe(0x06054b50);
    expect(u16(zip, eocdOffset + 8)).toBe(1); // entries on this disk
    expect(u16(zip, eocdOffset + 10)).toBe(1); // entries total

    const centralOffset = u32(zip, eocdOffset + 16);
    expect(u32(zip, centralOffset)).toBe(0x02014b50);
  });

  it('records each entry offset so a reader can seek to it', () => {
    const zip = createZip([
      { name: 'a.txt', data: bytes('first') },
      { name: 'b.txt', data: bytes('second') },
    ]);
    const eocdOffset = zip.length - 22;
    const centralOffset = u32(zip, eocdOffset + 16);

    expect(u16(zip, eocdOffset + 10)).toBe(2);
    // First central entry points at offset 0; the second points past the first.
    expect(u32(zip, centralOffset + 42)).toBe(0);
    const firstNameLen = u16(zip, centralOffset + 28);
    const secondEntry = centralOffset + 46 + firstNameLen;
    expect(u32(zip, secondEntry)).toBe(0x02014b50);
    expect(u32(zip, secondEntry + 42)).toBeGreaterThan(0);
  });

  it('marks names as UTF-8 so non-ASCII paths survive', () => {
    const zip = createZip([{ name: 'ssss.webm', data: bytes('x') }]);
    expect(u16(zip, 6) & 0x0800).toBe(0x0800);
  });

  it('writes a valid empty archive', () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(0x06054b50);
    expect(u16(zip, 10)).toBe(0);
  });

  it('handles binary data with no text assumptions', () => {
    const data = new Uint8Array([0, 255, 127, 128, 0, 10, 13]);
    const zip = createZip([{ name: 'clip.webm', data }]);
    expect(u32(zip, 14)).toBe(crc32(data));
    expect(u32(zip, 18)).toBe(data.length);
  });
});

describe('safeEntryName', () => {
  it('strips path traversal', () => {
    expect(safeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('/leading/slash')).toBe('leading/slash');
  });

  it('normalises backslashes and removes characters that break archivers', () => {
    expect(safeEntryName('a\\b')).toBe('a/b');
    expect(safeEntryName('bad:name?.webm')).toBe('bad_name_.webm');
  });

  it('keeps an ordinary R2 key intact', () => {
    expect(safeEntryName('baseline/2026/03/base_1.webm')).toBe('baseline/2026/03/base_1.webm');
  });
});
