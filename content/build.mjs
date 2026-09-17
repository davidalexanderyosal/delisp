/**
 * Generates the typed exercise module the web app imports, from exercises.yaml.
 *
 * The app ships the curriculum in its bundle rather than parsing YAML at
 * runtime: Phase 2 has no backend to fetch it from, and the service worker has
 * to precache it anyway. Phase 3 will seed D1 from the same YAML.
 *
 *   node content/build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, 'exercises.yaml');
const TARGET = resolve(here, '../apps/web/src/content/exercises.generated.ts');

const POSITIONS = new Set([
  'isolation',
  'initial',
  'medial',
  'final',
  'cluster',
  'phrase',
  'sentence',
  'passage',
  'free',
]);

const doc = parse(readFileSync(SOURCE, 'utf8'));
const rows = doc?.exercises;
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error('exercises.yaml has no `exercises` list');
}

const ids = new Set();
for (const row of rows) {
  const where = `exercise ${row?.id ?? '(missing id)'}`;
  if (typeof row.id !== 'string' || row.id.length === 0) throw new Error(`${where}: bad id`);
  if (ids.has(row.id)) throw new Error(`${where}: duplicate id`);
  ids.add(row.id);
  if (!Number.isInteger(row.level) || row.level < 0 || row.level > 8) {
    throw new Error(`${where}: level must be 0–8`);
  }
  if (row.sound !== 's' && row.sound !== 'z') throw new Error(`${where}: sound must be s or z`);
  if (!POSITIONS.has(row.position)) throw new Error(`${where}: unknown position ${row.position}`);
  if (typeof row.text !== 'string' || row.text.trim() === '') throw new Error(`${where}: empty text`);
  if (row.minimal_pair !== undefined && typeof row.minimal_pair !== 'string') {
    throw new Error(`${where}: minimal_pair must be a string`);
  }
  if (row.tags !== undefined && !Array.isArray(row.tags)) throw new Error(`${where}: tags must be a list`);
}

const exercises = rows.map((row) => ({
  id: row.id,
  level: row.level,
  sound: row.sound,
  position: row.position,
  text: row.text,
  ...(row.minimal_pair ? { minimalPair: row.minimal_pair } : {}),
  tags: row.tags ?? [],
}));

const counts = new Map();
for (const e of exercises) counts.set(e.level, (counts.get(e.level) ?? 0) + 1);
const summary = [...counts.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([level, n]) => ` *   level ${level}: ${n}`)
  .join('\n');

const banner = `// GENERATED FILE — do not edit.
// Source: content/exercises.yaml. Regenerate with \`pnpm content:build\`.
/**
 * ${exercises.length} exercises:
${summary}
 */
`;

writeFileSync(
  TARGET,
  `${banner}
import type { Exercise } from '../lib/exercises';

export const EXERCISES: readonly Exercise[] = ${JSON.stringify(exercises, null, 2)} as const;
`,
);

process.stdout.write(`${exercises.length} exercises -> ${TARGET}\n`);
