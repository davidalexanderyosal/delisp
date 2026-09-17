# Decisions

Choices the spec left open, and the reasoning. Newest last.

## Phase 1

**Monorepo scope.** `apps/api`, `packages/schema` and `content/` are not in the
tree yet. Phase 1 has no backend and one hard-coded exercise, so empty
placeholder packages would only add install and CI weight. They arrive with the
phases that need them.

**`bandRatio` is in decibels.** The spec says "energy 5–8 kHz ÷ energy 1–4 kHz
(log scale)". It is computed as `10·log10(E_high / E_low)`, clamped to ±40 dB, so
0 dB means the two bands carry equal energy and the sign reads naturally: a clear
/s/ is positive, a th-like one strongly negative.

**Centroid is measured over 300 Hz – 11 kHz, not the full spectrum.** Room rumble
and voicing fundamentals below 300 Hz would drag the centroid of a fricative
down, and mic self-noise above 11 kHz would push it up; neither carries
information about /s/ placement. Centroid and spread are magnitude-weighted, band
energies are power-weighted.

**`zcr` is normalised to crossings per sample (0–1),** computed after DC removal.
The absolute rate in Hz would be sample-rate dependent, and every threshold in
the app is a comparison rather than a physical quantity.

**Fricative gate threshold is `zcr ≥ 0.10`, not 0.15.** At 0.15 a frontal,
th-like attempt with its energy near 3 kHz falls *below* the gate, so it is
discarded as "no /s/ heard" instead of being scored badly — exactly backwards for
an app whose job is to catch that error. Vowels sit below 0.06, so 0.10 still
separates cleanly. This was caught by a unit test that expected a half-good
utterance to score near 50% and got 79%.

**The noise floor is the 95th percentile of the silent frames,** not the mean: a
fan should not be averaged away, and one cough should not set the floor for the
session. It is clamped to [0.0008, 0.05]; above the ceiling the app refuses the
calibration and asks for a quieter room rather than handing back a gate no /s/
can clear.

**`sDurationMs` is the longest *contiguous* run of fricative frames,** not the
total count. A false start followed by the real attempt should report the
attempt's length, not the sum of both.

**The target zone comes from the spec's reference constants, not from the user's
baseline.** Spec §3.3 step 3 makes the reference-clip step optional and says to
fall back to default constants, which is what Phase 1 does (no TTS assets are
bundled yet). This matters more than it looks: calibrating the target to the
user's own sustained /s/ would aim the drill at the lisp it is meant to correct.
The baseline is still recorded, as the thing progress is measured against.

**Trial pass threshold is 60% of fricative frames in zone** (`DRILL.passScore`),
with a minimum of 4 fricative frames for a trial to count as heard at all. The
spec fixes the level-0 advance criterion ("80% of trials in zone over the last
20") but not what makes one trial a hit; 60% tolerates the onset and offset of a
real /s/, which are never in zone.

**The AudioWorklet is bundled from TypeScript into `public/worklets/`, not
hand-written.** `vite.worklet.config.ts` builds `src/worklet/*.ts` into one
self-contained IIFE. Worklets cannot reliably use `import` on iOS Safari, and the
alternative — a hand-maintained copy of the FFT living in `public/` — would be
code that the unit tests do not cover. The generated file is gitignored and built
by `pnpm dev` / `pnpm build`.

**Frames are computed at ~47 Hz but posted in batches every 50 ms.** The spec asks
for ~20 posts/s. Dropping frames to hit that rate would corrupt `sDurationMs` and
the zone hit rate, both of which count frames, so every frame is kept and the
batch is what is throttled.

**The gauge reads the latest frame under `requestAnimationFrame` from a ref.**
Putting 20 updates/s through React state would re-render the drill screen 20×/s
for a needle that only needs to move at display rate.

**Hash routing.** No server rewrite rules, and the phone's back button works
inside an installed PWA.

**Hold-to-record, capped at 5 s.** One thumb, no aiming, and a pointer that gets
stuck cannot run the capture forever. Anything under 400 ms is discarded rather
than scored.

**Feedback fading (spec §3.8) is only partly implemented.** The
knowledge-of-performance → knowledge-of-results shift is in: the coaching line
drops away above 80% rolling accuracy. The rest of the schedule (gauge hidden
during recording, scores on every 2nd/3rd trial) belongs with the Phase 2 drill
engine, and `settings.feedback_rate` is already in the data model for it. The
gauge *is* hidden during the self-rating step, which is the spec's own
requirement that the user commits before the score is revealed.

**No `MediaRecorder` in Phase 1.** The spec runs it in parallel with the worklet,
but audio blobs only have a consumer once R2 and Whisper exist in Phase 3.
Nothing is stored that could not be replayed from the features.

**/z/ is not implemented.** It enters at level 2 (Phase 2); Phase 1 is level 0
only.

**Icons are generated, not drawn.** `apps/web/scripts/make-icons.mjs` renders the
app's own gauge to PNG through `node:zlib` — no image dependency, and the output
is committed so a normal build never runs it.

**Deploy is guarded on secrets.** The Cloudflare Pages job checks for
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in a step rather than a job-level
`if` (the `secrets` context is not available there), so a clone without
credentials gets a skipped deploy instead of a red build.

## Phase 2

**Content lives in YAML and is compiled into the bundle.** `content/exercises.yaml`
is the source of truth, per spec §6; `pnpm content:build` generates
`apps/web/src/content/exercises.generated.ts` from it, validating ids, levels,
positions and minimal pairs on the way through. The app ships the curriculum in
its bundle rather than fetching it: there is no backend in Phase 2, and the
service worker would have to precache it anyway. Phase 3 seeds D1 from the same
file.

**Levels 5–8 are content-complete but not playable.** Their scoring depends on
which word was actually heard, which needs the Whisper endpoint. The exercises
are written and the level definitions carry `scoring: 'asr'`, so Phase 3 turns
them on rather than building them.

**Warm-up trials are scored into no progression window.** The warm-up is
sustained /s/ from level 0 whatever level is being drilled, so counting it toward
the current level's advance criterion would promote on a different exercise. Made
explicit in `progressionTarget()` and unit-tested, because it is the kind of rule
that breaks silently.

**Advance requires a *full* rolling window.** 85% of six trials is not 85% over
the last forty. Without this, a short lucky streak promotes.

**Blocked practice for the first window's worth of trials at a level, random
after.** The spec says "first half"/"second half" of a level without defining the
boundary; a full rolling window is the point at which the level can first be
assessed, which is the most defensible reading available.

**A failed re-test drops back to the *shortest* interval, not the previous one.**
If a level lapsed, the schedule's assumption about how secure it was is wrong, so
it should come round again tomorrow rather than in a fortnight. Re-tests are 10
trials, matching the number the spec reinserts after a failure.

**Voicing is measured over the frication, not over everything audible.** The
first implementation counted every frame above the gate, which in a word like
"sun" is mostly vowel — so every word read as voiced. It now counts only frames
where the 5–8 kHz band leads the 1–4 kHz band, which isolates the fricative
without needing word boundaries.

**Voicing is detected from the voice bar (80–400 Hz), not from `zcr` or the 1–4
kHz band.** `zcr` follows the loudest component of the whole frame, so for a /z/
whose voicing outweighs its frication it collapses toward the fundamental and
reads as a vowel. The 1–4 kHz band sits above the fundamental and below the
frication, and is quiet for /s/ and /z/ alike. The check is a *margin*
(voice bar vs frication energy) rather than an absolute level, so it holds at any
recording volume.

**An /s/ prompt fails if it comes out voiced, not just if the placement is off.**
The spec only asks for a voicing check on /z/, but the check is symmetric and a
voiced /s/ is a different sound, so reporting placement feedback on it would be
misleading. A voicing error is reported whatever the fading schedule says, for
the same reason.

**The lateral threshold is a spectral spread of 1800 Hz.** The first value, 2200,
was set by eye and in practice never fired — a uniform 6 kHz-wide band has a
spread of only ~1790 Hz. Caught by a test that expected a broad, peakless
spectrum to classify as lateral and got `postalveolar`.

**The diagnostic abstains rather than guessing.** A clear /s/ has no lisp pattern
to report, and a /ʃ/-like centroid says the sound drifted backwards rather than
which pattern caused it — both return a null vote. With the minimal-pair test
still to come in Phase 3, two signals can tie, which reports `mixed`; that is the
spec's own tie-breaking rule.

**Feedback fading is now fully implemented** (spec §3.8): live gauge below 70%
accuracy, hidden during recording from 70%, scored every 2nd trial from 80% and
every 3rd from 85%, with a block summary in between and the knowledge-of-
performance coaching line dropping away at 80%. `settings.feedback_rate` is kept
in step for Phase 3 sync.
