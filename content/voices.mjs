/**
 * Generates the model audio the shadowing drill needs (spec §6: "generate with
 * a TTS voice for v1 (batch script → R2), replace selectively with human clips
 * later").
 *
 *   pnpm content:voices --base https://your-app.example.com
 *
 * The synthesis itself happens in the Worker, where the Workers AI and R2
 * bindings already are — this script only walks the curriculum and asks. That
 * keeps Cloudflare credentials out of it entirely.
 *
 * Behind Cloudflare Access, pass a service token:
 *   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... pnpm content:voices --base ...
 *
 * Re-running is safe: an exercise that already has a clip is skipped unless
 * --force is given.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const base = arg('base', process.env.DELISP_BASE_URL);
if (!base) {
  process.stderr.write(
    'Usage: pnpm content:voices --base https://your-app.example.com [--force] [--levels 1,2,3]\n',
  );
  process.exit(1);
}

const force = arg('force', false) !== false;
const levelFilter = arg('levels');
const levels = levelFilter
  ? new Set(String(levelFilter).split(',').map(Number))
  : // Level 0 is a sustained sound and level 8 a speaking prompt; neither is a
    // phrase to copy, so neither gets a model clip.
    new Set([1, 2, 3, 4, 5, 6, 7]);

const headers = { 'content-type': 'application/json' };
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const doc = parse(readFileSync(resolve(here, 'exercises.yaml'), 'utf8'));
const targets = (doc?.exercises ?? []).filter((e) => levels.has(e.level));

if (targets.length === 0) {
  process.stderr.write('No exercises matched those levels.\n');
  process.exit(1);
}

process.stdout.write(`Generating model audio for ${targets.length} exercises via ${base}\n`);

let generated = 0;
let skipped = 0;
const failures = [];

for (const [index, exercise] of targets.entries()) {
  const progress = `[${index + 1}/${targets.length}]`;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/model-audio`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ exerciseId: exercise.id, force }),
    });

    if (!response.ok) {
      const detail = await response.text();
      failures.push({ id: exercise.id, status: response.status, detail: detail.slice(0, 200) });
      process.stdout.write(`${progress} ${exercise.id}: FAILED (${response.status})\n`);
      continue;
    }

    const body = await response.json();
    if (body.generated) {
      generated++;
      process.stdout.write(`${progress} ${exercise.id}: ${body.key}\n`);
    } else {
      skipped++;
      process.stdout.write(`${progress} ${exercise.id}: already present\n`);
    }
  } catch (err) {
    failures.push({ id: exercise.id, detail: String(err) });
    process.stdout.write(`${progress} ${exercise.id}: FAILED (${err})\n`);
  }

  // One request at a time, with a breath between them: this is a background job
  // that runs once, and there is nothing to gain from hammering the endpoint.
  await new Promise((r) => setTimeout(r, 200));
}

process.stdout.write(`\nGenerated ${generated}, skipped ${skipped}, failed ${failures.length}\n`);
if (failures.length > 0) {
  for (const failure of failures) {
    process.stdout.write(`  ${failure.id}: ${failure.status ?? ''} ${failure.detail}\n`);
  }
  process.exit(1);
}
