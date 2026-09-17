# Pronunciation Trainer (`delisp`)

A single-user PWA for correcting a mild /s/ lisp and improving speech clarity.
Real-time acoustic feedback on a phone, ten minutes a day.

The full design is in [`pronunciation-app-spec.md`](./pronunciation-app-spec.md);
decisions the spec left open are recorded in [`DECISIONS.md`](./DECISIONS.md).

## Status

**Phase 1 — Gauge (no backend).** Mic capture, DSP worklet, calibration,
sustained-/s/ drill with a live gauge, trial log in IndexedDB. No API, no D1,
no R2, no Whisper yet — those land in Phase 3.

## Layout

```
apps/web         React + Vite + Tailwind PWA          (Cloudflare Pages)
packages/dsp     pure-TS audio feature extraction     (unit-tested, no DOM)
```

`apps/api`, `packages/schema` and `content/` arrive with Phases 2–3.

## Getting started

Requires Node 20+ and pnpm 10.

```bash
pnpm install
pnpm dev          # web app on http://localhost:5173
pnpm test         # vitest, packages/dsp
pnpm typecheck
pnpm build
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
