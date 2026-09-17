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

None of this is needed to run the app locally — levels 0–5 work with no server
at all. It is what the transcription-scored levels, baselines and sync need.

```bash
pnpm install
cd apps/api && pnpm exec wrangler login && cd ../..
./scripts/setup-cloudflare.sh --deploy
```

The script creates the D1 database and R2 bucket if they do not exist, writes
the database id into `apps/api/wrangler.toml`, applies the migrations, seeds the
curriculum, creates the Pages project, and (with `--deploy`) publishes the
Worker. It is safe to re-run; nothing in it deletes data.

Four things it deliberately leaves to you, because each needs a decision it
cannot make:

1. **Cloudflare Access.** Create a self-hosted application covering the app's
   hostname, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `[vars]` and
   redeploy. **While `ACCESS_AUD` is empty the Worker skips verification
   entirely** — that is deliberate so `wrangler dev` and the tests can run, but a
   deployed Worker with it empty is wide open.
2. **The Worker route.** Uncomment `routes` in `apps/api/wrangler.toml` so the
   API sits on the same hostname as the Pages app: one Access policy covers
   both, and the browser never makes a cross-origin request.
3. **The two GitHub secrets** below, so CI can deploy the front end.
4. **Model audio**, once: `pnpm content:voices --base https://<your hostname>`.

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
