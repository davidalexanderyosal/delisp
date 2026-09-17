# Pronunciation Trainer (`delisp`)

A single-user PWA for correcting a mild /s/ lisp and improving speech clarity.
Real-time acoustic feedback on a phone, ten minutes a day.

The full design is in [`pronunciation-app-spec.md`](./pronunciation-app-spec.md);
decisions the spec left open are recorded in [`DECISIONS.md`](./DECISIONS.md).

## Status

**Phases 1–2 are complete.** The app works standalone: mic capture, calibration,
the diagnostic, levels 0–4 with automatic progression, spaced re-tests, feedback
fading and the cue library, all stored locally in IndexedDB.

**Phase 3 is complete.** Backend: D1 schema and migrations, the Hono Worker,
Cloudflare Access verification, R2 audio storage, Whisper scoring with a
sibilant-aware transcript matcher, weekly baselines and a nightly retention
sweep. Client: the API client, the IndexedDB → D1 sync worker, browser recording,
the progress dashboard and the weekly baseline flow.

Scoring by level (spec §3.6): 0–2 by the gauge alone, 3–5 by the gauge *and* what
was heard, 6–7 by the transcript alone, 8 an unscored baseline. Levels 0–5 work
with no server at all — the hybrid levels simply fall back to the gauge — so the
app is fully usable offline. Levels 6–8 need the Worker deployed.

**Phase 4 is nearly done.** HVPT-style contrast drilling built from your own
substitution log, the speaking-rate band on baselines, and shadowing with both
waveforms and a timing comparison. Model audio is generated once with
`pnpm content:voices --base <your app url>`. Still to come: per-phoneme GOP
scoring, which needs a Cloudflare Container running wav2vec2.

**Phase 5 is partly done.** Practice streaks, and a full export — the JSON record
plus the baseline audio, as a ZIP. Session reminders via Web Push are not
started.

## Layout

```
apps/web         React + Vite + Tailwind PWA          (Cloudflare Pages)
apps/api         Hono Worker                          (Cloudflare Workers)
packages/dsp     pure-TS audio feature extraction     (unit-tested, no DOM)
packages/schema  Drizzle schema + D1 migrations
content/         exercises.yaml, its compiler and the D1 seed generator
```

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

## Provisioning the backend

None of this is needed to run the app locally; it is what Phase 3 will deploy
against.

```bash
cd apps/api
pnpm exec wrangler d1 create delisp          # paste database_id into wrangler.toml
pnpm exec wrangler r2 bucket create delisp-audio
pnpm run migrate:remote                       # applies packages/schema/migrations
cd ../.. && pnpm content:seed                 # regenerate the seed SQL
pnpm --filter @delisp/api exec wrangler d1 execute delisp \
  --file=../../packages/schema/seed/exercises.sql --remote
```

Then put the Access application's team domain and AUD tag into `[vars]` in
`apps/api/wrangler.toml`. Leaving `ACCESS_AUD` empty disables the check, which is
how local development runs — do not deploy it that way.

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
