# Pronunciation Trainer (`delisp`)

A single-user PWA for correcting a mild /s/ lisp and improving speech clarity.
Real-time acoustic feedback on a phone, ten minutes a day.

The full design is in [`pronunciation-app-spec.md`](./pronunciation-app-spec.md);
decisions the spec left open are recorded in [`DECISIONS.md`](./DECISIONS.md).

## Status

**Phase 2 — Curriculum (still no backend).** On top of the Phase 1 gauge: the
full exercise set, the drill engine, levels 0–4 with automatic progression and
spaced re-tests, feedback fading, the cue library and the diagnostic module.
Everything is local — no API, no D1, no R2, no Whisper.

Levels 5–8 are written and waiting: their scoring needs word-level
transcription, which arrives with the Phase 3 backend.

## Layout

```
apps/web         React + Vite + Tailwind PWA          (Cloudflare Pages)
packages/dsp     pure-TS audio feature extraction     (unit-tested, no DOM)
content/         exercises.yaml + the generator that compiles it
```

`apps/api` and `packages/schema` arrive with Phase 3.

## Getting started

Requires Node 20+ and pnpm 10.

```bash
pnpm install
pnpm dev             # web app on http://localhost:5173
pnpm test            # vitest: packages/dsp + apps/web
pnpm typecheck
pnpm build
pnpm content:build   # regenerate the exercise module from content/exercises.yaml
```

The mic needs a secure context. `localhost` counts; testing from a phone on the
same network does not, so use a tunnel (or the deployed Pages URL) for on-device
testing.

## Deployment

Pushes to `main` build `apps/web` and deploy it to Cloudflare Pages via
`.github/workflows/ci.yml`. The deploy step is skipped unless these repository
secrets exist:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token with the *Cloudflare Pages: Edit* permission |
| `CLOUDFLARE_ACCOUNT_ID` | the account the Pages project belongs to |

The Pages project name is `delisp` (override with the `CF_PAGES_PROJECT`
repository variable).
