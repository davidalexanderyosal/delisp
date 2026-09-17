/**
 * Generates the PWA icons as PNGs with no image dependencies: the app's own
 * gauge, drawn with a little trigonometry and written out through zlib.
 *
 * Run with `pnpm --filter @delisp/web icons`. The output is committed, so a
 * normal build never needs this script.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const BG = [0x08, 0x0c, 0x17];
const TRACK = [0x1d, 0x29, 0x42];
const GREEN = [0x34, 0xd3, 0x99];
const NEEDLE = [0xe2, 0xe8, 0xf0];
const HUB = [0x2b, 0x3a, 0x58];

// Geometry in normalised icon coordinates.
const CX = 0.5;
const CY = 0.66;
const R = 0.36;
const THICK = 0.1;
const NEEDLE_DEG = 104;
const NEEDLE_LEN = 0.3;
const NEEDLE_HALF = 0.024;
const HUB_R = 0.048;

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function shade(x, y) {
  const dx = x - CX;
  const dy = y - CY;
  const d = Math.hypot(dx, dy);
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;

  const tipX = CX + NEEDLE_LEN * Math.cos((NEEDLE_DEG * Math.PI) / 180);
  const tipY = CY - NEEDLE_LEN * Math.sin((NEEDLE_DEG * Math.PI) / 180);
  if (distanceToSegment(x, y, CX, CY, tipX, tipY) <= NEEDLE_HALF) return NEEDLE;
  if (d <= HUB_R) return HUB;

  if (Math.abs(d - R) <= THICK / 2 && deg >= 6 && deg <= 174) {
    return deg >= 62 && deg <= 118 ? GREEN : TRACK;
  }
  return BG;
}

function render(size, pad) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) / samples) / size;
          const v = (py + (sy + 0.5) / samples) / size;
          const c = shade((u - 0.5) / pad + 0.5, (v - 0.5) / pad + 0.5);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = samples * samples;
      const i = (py * size + px) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  // Maskable icons are cropped to a circle inset by 10%, so the dial shrinks.
  ['icon-maskable-512.png', 512, 0.74],
  ['apple-touch-icon-180.png', 180, 0.9],
  ['favicon-32.png', 32, 1],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, pad] of ICONS) {
  writeFileSync(resolve(OUT, name), png(size, render(size, pad)));
  process.stdout.write(`${name} ${size}×${size}\n`);
}
