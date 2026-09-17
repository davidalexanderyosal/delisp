# Pronunciation Trainer — Spec v1

Personal PWA for correcting a mild /s/ lisp and improving overall speech clarity. Single user. Runs in a mobile browser (iOS Safari + Android Chrome), installed as a PWA. Everything on Cloudflare.

Evidence base: traditional articulation hierarchy (Van Riper), principles of motor learning for speech (Maas et al., 2008), minimal-pair contrast training, acoustic/visual biofeedback for residual speech errors, and shadowing / high-variability phonetic training for general clarity.

---

## 1. Goals

1. Give real-time, objective feedback on /s/ quality that the ear alone doesn't provide.
2. Drill /s/ up the articulation hierarchy with automatic progression and feedback fading.
3. Track weekly free-speech baselines so improvement is audible over months.
4. Stay usable in a 10-minute daily session on a phone.

Non-goals (v1): multi-user, social features, sounds other than /s/ and /z/, native apps.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + Tailwind, `vite-plugin-pwa` | Deployed on Cloudflare Pages |
| API | Cloudflare Workers + Hono | Pages Functions or a separate Worker with a route on the same domain |
| DB | Cloudflare D1 (SQLite) | Drizzle ORM for schema + migrations |
| Audio blobs | Cloudflare R2 | Recordings only; DB stores keys |
| Speech-to-text | Workers AI — `@cf/openai/whisper` (v1) | Word-level; used for minimal-pair checks |
| Phoneme scoring | Cloudflare Container or external GPU endpoint (v3) | wav2vec2-phoneme + forced alignment → GOP |
| Auth | Cloudflare Access (email OTP) on the whole hostname | No in-app auth |
| Local state | IndexedDB (via `idb`) | Offline-first; sync to D1 when online |

Repo layout (monorepo, pnpm):

```
/apps/web        React PWA
/apps/api        Hono Worker
/packages/dsp    pure-TS audio feature extraction (shared, unit-tested)
/packages/schema Drizzle schema + D1 migrations
/content         exercises as JSON/YAML, seeded into D1
```

---

## 3. Modules

### 3.1 Audio capture

- `getUserMedia({ audio: { sampleRate: 48000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`. Browser DSP smears 4–8 kHz energy; disable it. Verify the actual `AudioContext.sampleRate` and warn if < 32 kHz (Nyquist must cover 8 kHz+).
- `AudioContext` created and `resume()`d only inside a tap handler (iOS requirement).
- `AudioWorklet` computes features on 2048-sample frames with 50% overlap and posts them to the main thread ~20×/s.
- `MediaRecorder` in parallel for the clip. Accept whatever MIME the browser gives (`audio/mp4` on iOS, `audio/webm;codecs=opus` on Android). Store as-is; convert server-side only when needed.
- Foreground-only. Pause session on `visibilitychange`.

### 3.2 DSP features (`/packages/dsp`)

Per frame, after Hann window + FFT:

- `rms` — gate: frames below a noise floor (calibrated at session start, 1 s of silence) are ignored.
- `centroid` — spectral centroid in Hz.
- `bandRatio` — energy 5–8 kHz ÷ energy 1–4 kHz (log scale).
- `spread` — spectral spread (std dev around centroid).
- `zcr` — zero-crossing rate (cheap voiced/voiceless hint; distinguishes /s/ from /z/).
- `peakHz` — frequency of spectral peak.

Per utterance (aggregated over frames flagged as fricative: high `zcr`, `rms` above gate):

- `sDurationMs`, mean/median `centroid`, mean `bandRatio`, mean `spread`.

Interpretation heuristics (tunable constants, calibrated per user in §3.3):

| Pattern | Centroid | Band ratio | Spread |
|---|---|---|---|
| Clear /s/ | high (~5.5–8 kHz on 48 kHz capture) | high | narrow |
| Frontal/interdental (th-like) | low | low | moderate |
| Lateral (slushy) | mid/low | low | wide, no clear peak |
| /ʃ/ (sh) | ~3–4.5 kHz | low | moderate |

These are proxies, not diagnoses. The UI shows a gauge, not a label, during drills.

### 3.3 Calibration

Run once, re-runnable from settings.

1. 1 s silence → noise floor.
2. 3 × sustained "sssss" (3 s each) → user's current baseline distribution.
3. Optional: 3 × reference /s/ from a model clip (bundled TTS or a recording from a clear speaker) played through the phone → establishes target zone. If skipped, use default constants.
4. Target zone = reference median ± tolerance; the gauge is green inside it. Tolerance tightens automatically as accuracy rises (see §5).

### 3.4 Diagnostic module

Runs at onboarding, classifies a *tentative* pattern to select cue copy. Output stored in `settings.lisp_pattern` ∈ {`frontal`, `lateral`, `mixed`, `unknown`}.

Inputs:
- Sustained /s/ features from calibration (centroid, spread, peak presence).
- Minimal-pair test: user reads 12 words (6 /s/–/θ/ pairs, 6 /s/–/ʃ/ pairs). Whisper transcript compared to targets. /s/→"th" substitutions suggest frontal; /s/→"sh" or unrecognised suggest lateral.
- Two self-report questions with illustrations: "Tongue visible between teeth in the mirror?" and "Straw test: air mostly through the centre, or at the corners?"

Decision: majority vote across the three signals; ties → `mixed`. Always show the line: "This is a guess from acoustics and your answers. One session with a speech-language pathologist will confirm placement."

### 3.5 Cue library

Selected by `lisp_pattern`, shown before drills and on demand.

**Frontal / interdental**
- "Teeth lightly together, lips slightly apart, tongue tip *behind* the teeth."
- Exploding-T: hold "t…", release into a long "s". The tongue is already in the right place for /t/.
- Tip-down option (often easier with an overbite): tongue tip tucked behind the *lower* front teeth, blade raised toward the ridge, air over the centre.
- "Smile slightly" — spreads lips, sharpens the /s/.

**Lateral**
- Butterfly position: sides of the tongue pressed up against the upper back teeth (the "wings"), a narrow groove down the middle.
- Straw target: aim the airstream through a straw held at the centre of the lips; feel it on your finger.
- Shape from a long /t/: "tttt…" then let the air leak through the groove.
- Try /s/ from an "ee" position — the high tongue sides are already in place.

**Both**
- Volume stays normal; a louder /s/ is not a clearer one.
- Self-rate before looking at the gauge.

### 3.6 Drill engine

Session = warm-up + main block + optional free speech, targeting ~100 scored trials in ≤10 minutes.

Trial flow:
1. Show prompt (text + optional model audio; model audio is hidden by default from Level 3 up to force self-generation).
2. User taps to record; gauge visible or hidden per feedback schedule.
3. User self-rates (good / not sure / off) — required before score reveal.
4. App shows score + feedback (see §5 for frequency).
5. Next.

Scoring per trial:
- Levels 0–2: acoustic only. `score = zone hit rate` over fricative frames (0–100).
- Levels 3–5: acoustic score + Whisper match (target word/phrase transcribed correctly, /s/ words not replaced by th/sh forms). `pass = acoustic ≥ threshold AND asr_match`.
- Level 6+: Whisper only + weekly baselines (no gauge).

### 3.7 Progression

| Level | Content | Advance when |
|---|---|---|
| 0 | Sustained /s/ | 80% of trials in zone over last 20 |
| 1 | CV / VC syllables: sa se si so su, as es is os us | 80% over last 30 |
| 2 | /s/ initial words (sun, sit, soap…) | 85% over last 40 |
| 3 | /s/ final words (bus, yes, house…) | 85% over last 40 |
| 4 | /s/ medial + clusters (basket, missing; st-, sp-, sk-, sl-, sm-, sn-, sw-) | 85% over last 50 |
| 5 | Phrases + minimal pairs in context | 85% over last 50 |
| 6 | Sentences (loaded: 3–5 /s/ each) | 90% over last 50 |
| 7 | Reading passages (Rainbow Passage, work-relevant text: sales-call phrases, product names) | 90% |
| 8 | Free speech: 60 s prompts, weekly baseline | maintenance |

Rules:
- Accuracy is a rolling window, not lifetime.
- Blocked practice (same word repeated) in the first half of a level; random practice (mixed words/positions) in the second half — motor-learning research favours variable practice for retention once the sound is established.
- Passed levels enter a spaced re-test queue (1, 3, 7, 14, 30 days). A failed re-test (< 75%) reinserts 10 trials of that level into the next session.
- /z/ is added at Level 2 as the voiced twin (same placement, voice on); the app checks `zcr` and low-band energy to confirm voicing.

### 3.8 Feedback fading (motor learning)

- `feedbackRate` starts at 100% (gauge live + score every trial).
- When level accuracy ≥ 70%: gauge hidden during recording, shown after; score every trial.
- ≥ 80%: score on every 2nd trial (summary after each block instead).
- ≥ 85%: score on every 3rd trial; self-rating vs actual score agreement shown weekly.
- Feedback type shifts from *knowledge of performance* ("centroid low — tongue likely too far forward; try the exploding-T") to *knowledge of results* ("7/10 in zone").

### 3.9 General clarity (Phase 4)

- Shadowing: play a 5–10 s model clip, user repeats immediately, both waveforms shown; Whisper compares transcripts.
- HVPT-style contrast sets across multiple speakers for the pairs the user confuses most (from Whisper substitution logs).
- Rate control: words-per-minute readout on free speech; target a band, not a maximum.

### 3.10 Progress

- Per-level accuracy over time (line).
- Centroid distribution of sustained /s/, week over week (histogram overlay).
- Weekly baseline recordings side by side with a "play A / play B" toggle.
- Self-rating calibration: % agreement between self-rating and score.

---

## 4. Data model (D1 / Drizzle)

```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lisp_pattern TEXT NOT NULL DEFAULT 'unknown',
  noise_floor REAL, target_centroid REAL, target_ratio REAL, tolerance REAL,
  feedback_rate REAL NOT NULL DEFAULT 1.0,
  updated_at TEXT NOT NULL
);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  sound TEXT NOT NULL,            -- 's' | 'z'
  position TEXT,                  -- 'isolation'|'initial'|'medial'|'final'|'cluster'|'phrase'|'sentence'|'passage'|'free'
  text TEXT NOT NULL,
  minimal_pair TEXT,              -- e.g. 'think' for 'sink'
  model_audio_key TEXT,           -- R2 key, nullable
  tags TEXT                       -- JSON array
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL, ended_at TEXT,
  level INTEGER NOT NULL, trial_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE trials (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  created_at TEXT NOT NULL,
  centroid REAL, band_ratio REAL, spread REAL, s_duration_ms INTEGER,
  acoustic_score REAL,
  asr_text TEXT, asr_match INTEGER,        -- bool
  self_rating TEXT,                        -- 'good'|'unsure'|'off'
  score REAL, passed INTEGER,
  feedback_shown INTEGER,                  -- bool
  recording_key TEXT                       -- R2 key, nullable (not every trial is stored)
);

CREATE TABLE recordings (
  key TEXT PRIMARY KEY,                    -- R2 key
  kind TEXT NOT NULL,                      -- 'trial'|'baseline'|'calibration'
  mime TEXT NOT NULL, duration_ms INTEGER,
  created_at TEXT NOT NULL,
  transcript TEXT, wpm REAL
);

CREATE TABLE progression (
  level INTEGER PRIMARY KEY,
  status TEXT NOT NULL,                    -- 'locked'|'active'|'passed'
  accuracy_window TEXT,                    -- JSON array of last N pass/fail
  passed_at TEXT, next_retest_at TEXT, retest_stage INTEGER DEFAULT 0
);
```

Client keeps a mirror of `trials`/`sessions` in IndexedDB with a `synced` flag; a sync worker flushes to the API when online. Server is source of truth after sync.

Retention: store audio for every 5th trial plus all failed trials (capped at 20/session), all baselines, all calibrations. Delete trial audio after 90 days via a scheduled Worker; keep baselines forever.

---

## 5. API (Hono Worker)

All routes behind Cloudflare Access; the Worker verifies the `Cf-Access-Jwt-Assertion` header.

```
GET  /api/settings                  → settings row
PUT  /api/settings                  → update calibration / pattern
GET  /api/exercises?level=N         → exercise list
GET  /api/session/next              → { level, exercises[], feedbackRate, retests[] }  (drill engine decides)
POST /api/sessions                  → create
POST /api/trials                    → batch insert (client sends features already computed)
POST /api/recordings/upload-url     → { key, url } presigned PUT to R2  (or stream via Worker if presign is awkward)
POST /api/score/asr                 → { key, target } → Whisper → { text, match, substitutions[] }
POST /api/score/phoneme             → (Phase 3) { key, target } → GOP per phoneme
GET  /api/progress                  → aggregates for the dashboard
POST /api/baseline                  → weekly free-speech recording → stores + Whisper + WPM
```

Whisper call: Workers AI `@cf/openai/whisper` with the audio bytes; pass a `prompt`/vocabulary list of target words to bias recognition. Compare with a phoneme-aware fuzzy match (target → CMUdict phonemes; substitution table for s/θ/ʃ/z).

---

## 6. Content

`/content/exercises.yaml`, seeded by a script. Minimum viable set:

- Level 1: 10 CV + 10 VC syllables.
- Level 2: 30 initial-/s/ words, varied vowel contexts (see, sit, set, sat, sun, soup, saw, so…).
- Level 3: 30 final-/s/ words.
- Level 4: 20 medial + 30 cluster words.
- Level 5: 20 phrases; 20 minimal pairs (sink/think, sum/thumb, sick/thick, mouse/mouth, face/faith, pass/path; sip/ship, sue/shoe, sock/shock, seat/sheet, mass/mash, class/clash).
- Level 6: 30 sentences, 3–5 /s/ each, including work vocabulary (sales, solutions, security, process, subscription, Salesforce, Cisco, Singapore, Indonesia).
- Level 7: Rainbow Passage + 3 self-authored call-opening scripts.
- Level 8: 10 free-speech prompts (describe your day, pitch a product, explain a process).

Model audio: generate with a TTS voice for v1 (batch script → R2), replace selectively with human clips later.

---

## 7. PWA / mobile constraints

- Manifest with `display: standalone`, icons, `start_url: /`.
- Service worker precaches the shell + `/content`; audio and API are network-first.
- Mic permission on iOS installed PWAs is not always persisted; show a one-tap "enable mic" screen at session start rather than failing silently.
- Keep the AudioWorklet file in `public/` and register it with an absolute URL; Vite bundling of worklets is finicky.
- Test matrix: iOS Safari (installed + tab), Android Chrome (installed + tab). Wired earphones vs built-in mic changes the centroid — record `deviceLabel` in trials and calibrate per device.

---

## 8. Phases

**Phase 1 — Gauge (no backend)**
Mic capture, DSP worklet, calibration, sustained-/s/ drill with live gauge, IndexedDB trial log. Ship to Pages. Exit criterion: the gauge visibly and repeatably moves when you change placement using the cues. If it doesn't, tune the features before writing anything else.

**Phase 2 — Curriculum**
Exercise content, drill engine, levels 0–4, progression + fading, cue library, diagnostic module (acoustic + self-report parts). Still local-only.

**Phase 3 — Backend**
D1 + Drizzle migrations, Hono API, R2 uploads, IndexedDB sync, Cloudflare Access. Whisper scoring → levels 5–7, diagnostic minimal-pair test, weekly baselines, progress dashboard.

**Phase 4 — Clarity + phoneme scoring**
Shadowing, HVPT contrast sets, WPM. Phoneme GOP via a Cloudflare Container (Python: `torchaudio` forced alignment + wav2vec2-phoneme) called from the Worker; per-phoneme colouring in the sentence view.

**Phase 5 — Polish**
Streaks, session reminders (Web Push where supported), export of all data as JSON + zip of baselines.

---

## 9. Open questions

- Presigned R2 PUTs from the browser vs streaming through the Worker (simpler CORS story; 100 MB Worker request limit is fine for short clips).
- Whether `@cf/openai/whisper` word accuracy on 2–3 s clips is good enough for minimal pairs, or whether the vocabulary-biased prompt is required. Test in Phase 3 before building the diagnostic on it.
- Cloudflare Containers pricing/availability for the Phase 4 GPU-less inference (wav2vec2-base runs on CPU at ~1× real time; acceptable for async scoring).

---

## 10. Claude Code kickoff prompt

```
You are building "Pronunciation Trainer", a single-user PWA for correcting a mild /s/ lisp, deployed entirely on Cloudflare. The full spec is in ./pronunciation-app-spec.md — read it completely before writing code.

Constraints:
- pnpm monorepo: apps/web (React + Vite + Tailwind + vite-plugin-pwa), apps/api (Hono on Workers), packages/dsp (pure TypeScript, no DOM dependencies, unit-tested with vitest), packages/schema (Drizzle + D1 migrations), content/ (exercise YAML + seed script).
- Target iOS Safari and Android Chrome. AudioContext must be created/resumed inside a tap handler. Disable echoCancellation/noiseSuppression/autoGainControl on getUserMedia. AudioWorklet lives in apps/web/public/worklets/.
- No external UI kits; Tailwind only. Mobile-first, one-hand usable, large tap targets.
- No backend until Phase 3. Phases 1–2 persist to IndexedDB via `idb`.

Start with Phase 1 only:
1. Scaffold the monorepo and CI (typecheck + vitest) with a GitHub Actions workflow that deploys apps/web to Cloudflare Pages on main.
2. Implement packages/dsp: Hann window, FFT (use a small dependency-free radix-2 implementation), and the per-frame features in spec §3.2 (rms, centroid, bandRatio, spread, zcr, peakHz) plus the per-utterance aggregation. Write unit tests using synthetic signals: white noise band-limited to 5–8 kHz must yield a high centroid; a 3 kHz band must yield ~3 kHz; silence must be gated.
3. Implement the AudioWorklet that runs the frame features and posts them at ~20 Hz, and a React hook `useMicFeatures()` that manages permission, AudioContext lifecycle, and visibility pausing.
4. Build the calibration flow (spec §3.3) and the sustained-/s/ drill with a live gauge (green target zone, needle for current centroid, secondary bar for bandRatio), self-rating step, and trial logging to IndexedDB.
5. Add a minimal "history" screen listing sessions and mean centroid per session.

After Phase 1 is deployed and I confirm the gauge responds to placement changes, stop and ask before starting Phase 2. Do not implement any API, D1, R2, or Whisper code yet. When a decision is not covered by the spec, choose the simplest option and note it in DECISIONS.md.
```
